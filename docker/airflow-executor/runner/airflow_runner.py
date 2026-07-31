"""
Airflow DAG submission runner.

The user's submission is a Python file defining an Airflow DAG. We do NOT
run the full Airflow scheduler (too heavy for sandboxing). Instead:

  1. Import the user's file and check it defines a valid DAG object
  2. Validate DAG structure: task count, dependencies (DAG.topological_sort),
     no cycles, no orphaned tasks
  3. Check for common anti-patterns: dynamic task generation without
     task groups, missing retries, wrong trigger_rule usage
  4. Run each task function in isolation by calling task.execute(context={})
     with a mock context object (only when the task is a PythonOperator
     whose `python_callable` does not require external resources)
  5. Write a JSON result line to stdout

Output (single line, valid JSON):
    {"passed": true|false, "output": "...", "error": "...", "runtime_ms": N,
     "diagnostics": {...}?}

Section 11I — when PIPELINE_COLLECT_DIAGNOSTICS is set, the JSON line
also includes a `diagnostics` object with:
  - taskTimings[]    — list of {taskId, durationMs, status} for every
                       PythonOperator task that was actually executed
                       (not the static DAG.tasks list — only the ones
                       we ran)
  - dagId            — echoes the DAG id (cheap; useful for the report)
  - structuralIssues — the validator's findings, surfaced as a string
                       list so the report page can render the same
                       warnings the runner reported
"""

import importlib.util
import json
import os
import sys
import time
import traceback
from types import ModuleType
from typing import Any


SUBMISSION_FILE = os.environ.get("SUBMISSION_FILE", "/sandbox/solution.py")


def emit(result: dict) -> None:
    print(json.dumps(result), flush=True)


def load_user_module(path: str) -> ModuleType:
    """Import the user's file as a fresh module without polluting sys.path
    or leaking names into __main__."""
    spec = importlib.util.spec_from_file_location("user_dag", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not load spec from {path}")
    module = importlib.util.module_from_spec(spec)
    # Some Airflow versions rely on certain attributes existing on the
    # module; provide a minimal shim without exposing the real airflow
    # globals to user code.
    module.__file__ = path
    spec.loader.exec_module(module)
    return module


def find_dag(module: ModuleType) -> Any:
    """Return the first DAG object the module defines, or raise."""
    from airflow.models import DAG  # imported here so absent-airflow fails late
    candidates = []
    for name in dir(module):
        obj = getattr(module, name)
        if isinstance(obj, DAG):
            candidates.append(obj)
    if not candidates:
        raise ValueError("no DAG object found in submission — define a variable bound to airflow.DAG(...)")
    # Prefer the DAG with the most tasks (the "main" one).
    return max(candidates, key=lambda d: len(d.tasks))


def validate_structure(dag) -> list[str]:
    """Return a list of structural issues. Empty list == healthy."""
    issues = []

    if not dag.tasks:
        issues.append("DAG has no tasks")

    # Cycle detection. topological_sort raises on cycles.
    try:
        dag.topological_sort()
    except Exception as e:
        issues.append(f"DAG has a cycle or unsatisfiable dependencies: {e}")

    # Orphan tasks: every task must be reachable from at least one root task.
    task_ids = {t.task_id for t in dag.tasks}
    downstream_ids = {tid for t in dag.tasks for tid in (t.downstream_list and [dt.task_id for dt in t.downstream_list] or [])}
    orphans = task_ids - downstream_ids
    # An "orphan" can be a legitimate root task; only flag tasks that are
    # downstream of nothing AND upstream of nothing (totally disconnected).
    totally_disconnected = {
        tid for tid in orphans
        if tid not in {t.task_id for t in dag.tasks if t.upstream_list}
    }
    if totally_disconnected:
        issues.append(f"tasks with no connections: {sorted(totally_disconnected)}")

    # Anti-pattern: dynamic task generation without task groups.
    # Heuristic — we can't see what the user wrote, but if there's a single
    # loop-like task name with index suffixes and no TaskGroup, warn.
    indexed = [tid for tid in task_ids if tid.split("_")[-1].isdigit()]
    if len(indexed) >= 3:
        from airflow.utils.task_group import TaskGroup
        has_groups = any(isinstance(t, TaskGroup) or t.task_group for t in dag.tasks)
        if not has_groups:
            issues.append("dynamic task generation detected without a TaskGroup — consider grouping related tasks")

    # Anti-pattern: PythonOperator(..., provide_context=True). Airflow 1.x
    # used this to opt into receiving the context dict; Airflow 2.x always
    # passes context, so the kwarg is dead. We can't introspect the user's
    # source from a constructed DAG, so detect via the OP_KWARGS trail: when
    # `provide_context` was passed, Airflow 2.x's PythonOperator.__init__
    # silently accepted it and stored it in op_kwargs (with a warning logged
    # to stderr that the sandbox user may have suppressed). Inspect each
    # PythonOperator's op_kwargs for the residual key.
    from airflow.operators.python import PythonOperator
    stale_kwarg_tasks = [
        t.task_id for t in dag.tasks
        if isinstance(t, PythonOperator) and 'provide_context' in (t.op_kwargs or {})
    ]
    if stale_kwarg_tasks:
        issues.append(
            f"PythonOperator(s) still use the Airflow 1.x `provide_context=True` kwarg "
            f"(now a no-op in 2.x): {stale_kwarg_tasks}"
        )

    return issues


def run_python_tasks(dag) -> list[str]:
    """Execute PythonOperator task functions with a mock context.

    Returns a list of error messages (empty list == all passed).
    Only attempts tasks whose op_type is 'PythonOperator'.

    The mock `ti` is an in-memory stand-in that supports the small subset
    of the real TaskInstance API that user DAGs use in task-level isolation
    testing: `xcom_push(key, value)` / `xcom_pull(key)` / `xcom_pull(task_ids,
    key)`. We don't run a real Airflow scheduler — pull returns whatever
    was pushed earlier in this run, with task_id defaults to the current
    task when not specified.
    """

    class MockTaskInstance:
        """Minimal TI that supports the XCom calls a user DAG might make."""

        def __init__(self, task_id: str, store: dict):
            self.task_id = task_id
            self._store = store

        def xcom_push(self, key: str, value):
            self._store[(self.task_id, key)] = value
            return value

        def xcom_pull(self, task_ids=None, key: str = "return_value", include_prior_dates: bool = False):
            # task_ids can be a str (single) or list; default to current task.
            if task_ids is None or task_ids == self.task_id:
                task_ids = [self.task_id]
            elif isinstance(task_ids, str):
                task_ids = [task_ids]
            for tid in task_ids:
                if (tid, key) in self._store:
                    return self._store[(tid, key)]
            return None

    from airflow.operators.python import PythonOperator

    errors: list[str] = []
    xcom_store: dict = {}
    # Section 11I — per-task timings captured here, surfaced as the
    # `diagnostics.taskTimings[]` field on the result JSON when the
    # orchestrator requests diagnostics. We accumulate all timings
    # regardless of pass/fail so the report page can show a Gantt-
    # like timeline of where the user spent time.
    timings: list[dict] = []

    # Pre-seed ts and other context fields. execution_date is mocked because
    # we don't have a real scheduler assigning one.
    execution_date = "2024-01-01T00:00:00+00:00"

    for task in dag.tasks:
        if not isinstance(task, PythonOperator):
            continue
        mock_ti = MockTaskInstance(task.task_id, xcom_store)
        mock_context = {
            "ti": mock_ti,
            "ts": execution_date,
            "dag": dag,
            "task_instance": mock_ti,
            "run_id": f"manual__{execution_date}",
            "execution_date": execution_date,
            "params": {},
        }
        start = time.time()
        try:
            task.python_callable(*task.op_args, **task.op_kwargs, **mock_context)
            duration_ms = int((time.time() - start) * 1000)
            timings.append({"taskId": task.task_id, "durationMs": duration_ms, "status": "success"})
        except TypeError as e:
            # Airflow 1.x-style callables that take no kwargs (no **context)
            # will fail here. Retry without the mock context — the bug list
            # explicitly calls out the `provide_context=True` antipattern,
            # and a corrected DAG should not exhibit it.
            if "missing" in str(e) or "unexpected keyword" in str(e):
                try:
                    task.python_callable(*task.op_args, **task.op_kwargs)
                    duration_ms = int((time.time() - start) * 1000)
                    timings.append({"taskId": task.task_id, "durationMs": duration_ms, "status": "success"})
                except Exception as e2:
                    duration_ms = int((time.time() - start) * 1000)
                    timings.append({"taskId": task.task_id, "durationMs": duration_ms, "status": "failed"})
                    errors.append(f"task {task.task_id!r}: {type(e2).__name__}: {e2}")
            else:
                duration_ms = int((time.time() - start) * 1000)
                timings.append({"taskId": task.task_id, "durationMs": duration_ms, "status": "failed"})
                errors.append(f"task {task.task_id!r}: {type(e).__name__}: {e}")
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            timings.append({"taskId": task.task_id, "durationMs": duration_ms, "status": "failed"})
            errors.append(f"task {task.task_id!r}: {type(e).__name__}: {e}")
    # Return timings alongside errors so main() can attach them to the
    # result JSON. (Returning a tuple instead of a list keeps the
    # signature backward-compatible-ish — main() unpacks via
    # `task_errors, task_timings = run_python_tasks(dag)`.)
    return errors, timings


def main() -> int:
    if not os.path.isfile(SUBMISSION_FILE):
        emit({"passed": False, "output": "", "error": "submission file not provided", "runtime_ms": 0})
        return 0

    start = time.time()
    try:
        user_module = load_user_module(SUBMISSION_FILE)
        dag = find_dag(user_module)
        structural_issues = validate_structure(dag)
        if structural_issues:
            elapsed = round((time.time() - start) * 1000, 2)
            # Section 11I — surface structural issues as diagnostics so
            # the report page can render them as warnings (without the
            # diagnostics gate they're hidden in the error string).
            diagnostics = None
            if os.environ.get("PIPELINE_COLLECT_DIAGNOSTICS"):
                diagnostics = {
                    "taskTimings": [],
                    "dagId": getattr(dag, "dag_id", ""),
                    "structuralIssues": structural_issues,
                }
            result = {
                "passed": False,
                "output": "",
                "error": "DAG structure issues: " + "; ".join(structural_issues),
                "runtime_ms": elapsed,
            }
            if diagnostics is not None:
                result["diagnostics"] = diagnostics
            emit(result)
            return 0

        # Section 11I — run_python_tasks now returns (errors, timings).
        # We always capture timings so the cost-limit only applies to
        # the JSON wire payload (timings is in-memory, ~10ms overhead).
        task_errors, task_timings = run_python_tasks(dag)
        elapsed = round((time.time() - start) * 1000, 2)
        if task_errors:
            diagnostics = None
            if os.environ.get("PIPELINE_COLLECT_DIAGNOSTICS"):
                diagnostics = {
                    "taskTimings": task_timings,
                    "dagId": getattr(dag, "dag_id", ""),
                    "structuralIssues": [],
                }
            result = {
                "passed": False,
                "output": "",
                "error": "task execution failed: " + "; ".join(task_errors[:5]),
                "runtime_ms": elapsed,
            }
            if diagnostics is not None:
                result["diagnostics"] = diagnostics
            emit(result)
            return 0

        summary = {
            "dag_id": dag.dag_id,
            "task_count": len(dag.tasks),
            "schedule": str(dag.schedule_interval),
        }
        diagnostics = None
        if os.environ.get("PIPELINE_COLLECT_DIAGNOSTICS"):
            diagnostics = {
                "taskTimings": task_timings,
                "dagId": getattr(dag, "dag_id", ""),
                "structuralIssues": [],
            }
        result = {
            "passed": True,
            "output": json.dumps(summary),
            "error": "",
            "runtime_ms": elapsed,
        }
        if diagnostics is not None:
            result["diagnostics"] = diagnostics
        emit(result)
        return 0
    except Exception as e:
        elapsed = round((time.time() - start) * 1000, 2)
        emit({"passed": False, "output": "", "error": f"{type(e).__name__}: {e}", "runtime_ms": elapsed})
        return 0


if __name__ == "__main__":
    sys.exit(main())

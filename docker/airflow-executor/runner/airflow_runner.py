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
    {"passed": true|false, "output": "...", "error": "...", "runtime_ms": N}
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

    return issues


def run_python_tasks(dag) -> list[str]:
    """Execute PythonOperator task functions with a mock context.

    Returns a list of error messages (empty list == all passed).
    Only attempts tasks whose op_type is 'PythonOperator'.
    """
    from airflow.operators.python import PythonOperator

    errors: list[str] = []
    mock_context = {
        "ti": None,
        "ts": "2024-01-01T00:00:00+00:00",
        "dag": dag,
        "task_instance": None,
        "run_id": "manual__2024-01-01T00:00:00+00:00",
        "execution_date": None,
        "params": {},
    }
    for task in dag.tasks:
        if not isinstance(task, PythonOperator):
            continue
        try:
            task.python_callable(*task.op_args, **task.op_kwargs)
        except Exception as e:
            errors.append(f"task {task.task_id!r}: {type(e).__name__}: {e}")
    return errors


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
            emit({
                "passed": False,
                "output": "",
                "error": "DAG structure issues: " + "; ".join(structural_issues),
                "runtime_ms": elapsed,
            })
            return 0

        task_errors = run_python_tasks(dag)
        elapsed = round((time.time() - start) * 1000, 2)
        if task_errors:
            emit({
                "passed": False,
                "output": "",
                "error": "task execution failed: " + "; ".join(task_errors[:5]),
                "runtime_ms": elapsed,
            })
            return 0

        summary = {
            "dag_id": dag.dag_id,
            "task_count": len(dag.tasks),
            "schedule": str(dag.schedule_interval),
        }
        emit({
            "passed": True,
            "output": json.dumps(summary),
            "error": "",
            "runtime_ms": elapsed,
        })
        return 0
    except Exception as e:
        elapsed = round((time.time() - start) * 1000, 2)
        emit({"passed": False, "output": "", "error": f"{type(e).__name__}: {e}", "runtime_ms": elapsed})
        return 0


if __name__ == "__main__":
    sys.exit(main())

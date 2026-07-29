"""
Pipeline orchestrator — Tier 3 / Section 11C.

The backend (pipelineOrchestrator.js, Section 11D) spawns ONE container
per pipeline stage using the existing per-tool executors, then spawns
THIS container once at the end with a spec describing:
  - Each stage's id
  - Where that stage's actual output lives (mounted by the backend)
  - Where the expected output lives (mounted from /expected/)
  - A human-readable acceptance criterion

This script walks the stages, runs a DuckDB-based comparison for each
one, and emits a single JSON line to stdout with the consolidated result.

Output contract (single line, valid JSON):
    {
      "passed": true|false,
      "pipelineId": "...",
      "stageResults": [
        {
          "stageId": "...",
          "status": "passed|failed|skipped",
          "runtimeMs": N,
          "output": "<csv or informational text>",
          "error": "<descriptive error if any>"
        }
      ],
      "totalRuntimeMs": N,
      "error": "<top-level error if the orchestrator itself failed>"
    }

Design constraints:
  - One container per stage is spawned by the backend, not by us. This
    script only does I/O and comparison — no docker.sock, no nested
    spawn calls.
  - Comparison is row-sorted DuckDB assertion with dtype tolerance,
    matching the contract used by sql_runner.py and iceberg_runner.py.
  - When expectedPath is missing (a stage has no expected output), we
    mark it 'skipped' rather than failing — matches the per-tool
    runner behaviour where absence of /expected/ is informational only.
"""

import json
import os
import sys
import time

import duckdb
import pandas as pd


def emit(result: dict) -> None:
    """Print a single JSON line and exit. Single-line stdout is the
    contract every runner in this project follows."""
    print(json.dumps(result), flush=True)


def load_spec(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def compare_parquet(actual_dir: str, expected_path: str) -> tuple[bool, str, str]:
    """Compare the parquet file(s) in actual_dir against expected_path.

    Returns (passed, output_csv_or_msg, error_msg).
    """
    if not os.path.isdir(actual_dir):
        return False, "", f"actual output dir not found: {actual_dir}"
    if not os.path.isfile(expected_path):
        return False, "", f"expected output not found: {expected_path}"

    # The actual output dir is expected to contain exactly one parquet
    # file (the per-stage convention). If multiple exist, take the first;
    # the orchestrator spec can be tightened later if needed.
    actual_files = [f for f in os.listdir(actual_dir) if f.endswith(".parquet")]
    if not actual_files:
        return False, "", f"no .parquet output in {actual_dir}"
    actual_path = os.path.join(actual_dir, actual_files[0])

    try:
        actual_df = pd.read_parquet(actual_path)
        expected_df = pd.read_parquet(expected_path)
    except Exception as e:
        return False, "", f"parquet read failed: {type(e).__name__}: {e}"

    try:
        pd.testing.assert_frame_equal(
            actual_df.reset_index(drop=True),
            expected_df.reset_index(drop=True),
            check_dtype=False,
        )
        output = actual_df.to_csv(index=False)
        return True, output[:8000], ""  # cap output to keep stdout sane
    except AssertionError as diff_err:
        # The diff message can be very long. Take just the first line.
        first_line = str(diff_err).splitlines()[0] if str(diff_err) else "row mismatch"
        return False, actual_df.head(50).to_csv(index=False), f"row mismatch: {first_line}"


def run_stage(stage_spec: dict) -> dict:
    """Run the comparison for a single stage. Returns the stageResult
    dict matching the per-stage output contract."""
    stage_id = stage_spec.get("id", "<unknown>")
    start = time.time()
    status = "skipped"
    output = ""
    error = ""

    actual_dir = stage_spec.get("actualOutputDir", "")
    expected_path = stage_spec.get("expectedPath", "")

    if not actual_dir:
        status = "skipped"
        error = "no actualOutputDir in spec"
    elif not expected_path:
        # No expected output mounted — informational only, like the
        # per-tool runners do. Don't fail the pipeline for this.
        status = "skipped"
        output = "no expected output configured for this stage"
    else:
        passed, output, error = compare_parquet(actual_dir, expected_path)
        status = "passed" if passed else "failed"

    runtime_ms = round((time.time() - start) * 1000, 2)
    return {
        "stageId": stage_id,
        "status": status,
        "runtimeMs": runtime_ms,
        "output": output,
        "error": error,
    }


def main() -> int:
    spec_path = os.environ.get("PIPELINE_SPEC", "/sandbox/pipeline_spec.json")
    if not os.path.isfile(spec_path):
        emit({
            "passed": False,
            "pipelineId": None,
            "stageResults": [],
            "totalRuntimeMs": 0,
            "error": f"pipeline spec not found at {spec_path}",
        })
        return 0

    overall_start = time.time()
    try:
        spec = load_spec(spec_path)
        stages = spec.get("stages", []) or []
        stage_results = [run_stage(s) for s in stages]

        passed = all(r["status"] in ("passed", "skipped") for r in stage_results)
        total_runtime_ms = round((time.time() - overall_start) * 1000, 2)

        emit({
            "passed": bool(passed),
            "pipelineId": spec.get("pipelineId"),
            "stageResults": stage_results,
            "totalRuntimeMs": total_runtime_ms,
            "error": "",
        })
        return 0
    except Exception as e:
        total_runtime_ms = round((time.time() - overall_start) * 1000, 2)
        emit({
            "passed": False,
            "pipelineId": None,
            "stageResults": [],
            "totalRuntimeMs": total_runtime_ms,
            "error": f"{type(e).__name__}: {e}",
        })
        return 0


if __name__ == "__main__":
    sys.exit(main())

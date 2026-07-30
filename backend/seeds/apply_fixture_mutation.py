"""
apply_fixture_mutation.py — Tier 3 / Section 11F.

Helper script invoked by the pipeline orchestrator to mutate per-run
fixture files for scenario-driven failure injection. Mutates a single
fixture file in-place based on the failure type and parameters.

Usage:
  python3 apply_fixture_mutation.py <fixture_path> <failure_type> [--key value]...

Supported failure types:

  late_data <path> <parquet>
      --fixtureName <name>
      --delayHours <hours>
      Mutates every event_ts column row to be `delayHours` in the past
      relative to the original timestamp. Creates an `event_hour_late`
      column so downstream code that has a watermark can react.

  schema_drift <path> <parquet>
      --driftType rename|drop
      --column <name>
      --newName <name>     (only for driftType=rename)
      Renames or drops the named column in the parquet file.

Poison message (JSON, not parquet) is handled in JS — see
pipelineOrchestrator.applyFixtureMutation.
"""
import json
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq


def emit_error(msg: str) -> None:
    """Errors are emitted as JSON to stdout so the JS caller can
    distinguish success from failure."""
    print(json.dumps({"ok": False, "error": msg}))


def emit_ok(extra: dict | None = None) -> None:
    payload = {"ok": True}
    if extra:
        payload.update(extra)
    print(json.dumps(payload))


def apply_late_data(path: Path, params: dict) -> None:
    delay_hours = float(params.get("delayHours", 0) or 0)
    if delay_hours <= 0:
        emit_ok({"note": "delayHours <= 0; no mutation"})
        return
    table = pq.read_table(path)
    cols = table.column_names
    if "event_ts" not in cols:
        emit_error("parquet has no event_ts column; cannot apply late_data")
        sys.exit(1)
    # Build a new column with delayed timestamps. We use pyarrow's
    # compute if available, else string-slice + offset.
    ts_col = table.column("event_ts").to_pylist()
    new_ts = []
    for ts in ts_col:
        if not ts:
            new_ts.append(ts)
            continue
        # Parse the ISO string, offset by delay_hours, reformat. We
        # keep the format simple — slice the first 13 chars (YYYY-MM-DDTHH)
        # and don't try to be clever across month boundaries. The MVP
        # tests all use within-month timestamps.
        try:
            # Use datetime arithmetic; assumes the timestamp is ISO 8601.
            from datetime import datetime, timedelta, timezone
            parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            delayed = parsed - timedelta(hours=delay_hours)
            new_ts.append(delayed.isoformat().replace("+00:00", "Z"))
        except Exception:
            new_ts.append(ts)
    # Add a marker column so the report can show what happened.
    new_col = pa.array(new_ts, type=pa.string())
    old_idx = cols.index("event_ts")
    new_table = table.set_column(old_idx, "event_ts", new_col)
    # Add a parallel column with the original timestamp for diffing.
    if "event_ts_original" not in cols:
        orig_col = pa.array(ts_col, type=pa.string())
        new_table = new_table.append_column("event_ts_original", orig_col)
    pq.write_table(new_table, path)
    emit_ok({"mutated": "event_ts", "delay_hours": delay_hours, "rows": new_table.num_rows})


def apply_schema_drift(path: Path, params: dict) -> None:
    drift_type = params.get("driftType", "")
    column = params.get("column", "")
    if not drift_type or not column:
        emit_error("driftType and column are required for schema_drift")
        sys.exit(1)
    table = pq.read_table(path)
    cols = table.column_names
    if column not in cols:
        emit_error(f"column '{column}' not found in parquet (have: {cols})")
        sys.exit(1)
    if drift_type == "drop":
        new_table = table.drop([column])
    elif drift_type == "rename":
        new_name = params.get("newName", "")
        if not new_name:
            emit_error("driftType=rename requires newName")
            sys.exit(1)
        if new_name in cols:
            emit_error(f"newName '{new_name}' already exists in parquet")
            sys.exit(1)
        # Rename by reconstructing the schema.
        new_names = [new_name if c == column else c for c in cols]
        new_table = table.rename_columns(new_names)
    else:
        emit_error(f"unknown driftType '{drift_type}'")
        sys.exit(1)
    pq.write_table(new_table, path)
    emit_ok({"mutated": column, "drift_type": drift_type, "rows": new_table.num_rows})


def main() -> int:
    if len(sys.argv) < 3:
        emit_error("usage: apply_fixture_mutation.py <path> <type> [--k v]...")
        return 1
    path = Path(sys.argv[1])
    failure_type = sys.argv[2]
    params: dict = {}
    i = 3
    while i + 1 < len(sys.argv):
        key = sys.argv[i].lstrip("-")
        params[key] = sys.argv[i + 1]
        i += 2

    if not path.exists():
        emit_error(f"fixture not found: {path}")
        return 1

    try:
        if failure_type == "late_data":
            apply_late_data(path, params)
        elif failure_type == "schema_drift":
            apply_schema_drift(path, params)
        else:
            emit_error(f"unknown failure type: {failure_type}")
            return 1
    except Exception as e:
        emit_error(f"{type(e).__name__}: {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

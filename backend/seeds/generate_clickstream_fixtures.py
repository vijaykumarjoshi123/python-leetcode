"""
generate_clickstream_fixtures.py — Tier 3 / Section 11F.

Generates the parquet fixture files for the clickstream pipeline
problem. Run once during seed setup; not part of the runtime path.

Outputs:
  docker/pipeline-runner/fixtures/real-time-clickstream-analytics/
    clickstream/raw_events.parquet             (input to pyspark stage)
    clickstream_enriched.parquet               (input to iceberg stage)
    schema.json                                (iceberg table definitions)
    expected/raw_events.parquet                (expected output of ingest? — n/a)
    expected/clickstream_enriched.parquet      (expected output of pyspark stage)
    expected/iceberg_table_metadata.json       (expected output of iceberg stage)
"""
import json
import os
import sys
from pathlib import Path

import pyarrow as pa
from pyarrow import parquet as pq


FIXTURES_ROOT = Path(__file__).resolve().parents[2] / "docker" / "pipeline-runner" / "fixtures" / "real-time-clickstream-analytics"
SEED_PATH = FIXTURES_ROOT / "seed_messages.json"


def load_seed():
    with open(SEED_PATH) as f:
        return json.load(f)["clickstream"]


def add_derived_columns(records):
    """Same transformations the user's pyspark code is supposed to do.
    The expected enriched parquet is computed here so we have a
    ground-truth reference for the pipeline-runner comparison."""
    out = []
    for r in records:
        ua = r["user_agent"].lower()
        if "ipad" in ua:
            device_class = "tablet"
        elif "iphone" in ua or "android" in ua or "mobile" in ua:
            device_class = "mobile"
        else:
            device_class = "desktop"
        # Truncate to the hour
        event_hour = r["event_ts"][:13]  # "2026-07-29T10"
        out.append({
            "event_id": r["event_id"],
            "user_id": r["user_id"],
            "session_id": r["session_id"],
            "url": r["url"],
            "user_agent": r["user_agent"],
            "event_ts": r["event_ts"],
            "event_hour": event_hour,
            "device_class": device_class,
        })
    return out


def write_parquet(records, path):
    """Write a list of dicts as parquet using pyarrow."""
    if not records:
        return
    table = pa.Table.from_pylist(records)
    pq.write_table(table, path)


def main():
    if not SEED_PATH.exists():
        print(f"ERROR: seed messages not found at {SEED_PATH}", file=sys.stderr)
        sys.exit(1)

    FIXTURES_ROOT.mkdir(parents=True, exist_ok=True)
    (FIXTURES_ROOT / "clickstream").mkdir(exist_ok=True)
    (FIXTURES_ROOT / "expected").mkdir(exist_ok=True)

    seed = load_seed()
    enriched = add_derived_columns(seed)

    # 1. raw_events.parquet — the input to the pyspark stage. This is
    # what the kafka stage produces (a JSON list); the orchestrator
    # mounts the equivalent parquet for the pyspark stage to read.
    raw_path = FIXTURES_ROOT / "clickstream" / "raw_events.parquet"
    write_parquet(seed, raw_path)
    print(f"wrote {raw_path} ({len(seed)} rows)")

    # 2. clickstream_enriched.parquet — input to the iceberg stage.
    # This is what the pyspark stage should produce (raw + derived cols).
    enriched_input_path = FIXTURES_ROOT / "clickstream_enriched.parquet"
    write_parquet(enriched, enriched_input_path)
    print(f"wrote {enriched_input_path} ({len(enriched)} rows)")

    # 3. expected/clickstream_enriched.parquet — what the pyspark stage
    # SHOULD produce. The pipeline-runner compares against this.
    expected_enriched_path = FIXTURES_ROOT / "expected" / "clickstream_enriched.parquet"
    write_parquet(enriched, expected_enriched_path)
    print(f"wrote {expected_enriched_path} ({len(enriched)} rows)")

    # 4. schema.json — Iceberg table definitions for the load stage.
    schema_path = FIXTURES_ROOT / "schema.json"
    schema = [
        {
            "table": "clickstream_enriched",
            "file": "clickstream_enriched.parquet",
        },
    ]
    with open(schema_path, "w") as f:
        json.dump(schema, f, indent=2)
    print(f"wrote {schema_path}")

    # 5. expected/iceberg_table_metadata.json — a marker the iceberg stage
    # should produce. Real metadata would be Iceberg's manifest list;
    # for the MVP we just expect a non-empty JSON object.
    metadata_path = FIXTURES_ROOT / "expected" / "iceberg_table_metadata.json"
    with open(metadata_path, "w") as f:
        json.dump({"table": "default.clickstream_enriched", "row_count": len(enriched)}, f, indent=2)
    print(f"wrote {metadata_path}")

    print("\nAll clickstream fixtures generated.")


if __name__ == "__main__":
    main()

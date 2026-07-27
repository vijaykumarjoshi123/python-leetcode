"""
PyIceberg submission runner.

Lifecycle:
  1. Initialise a local filesystem Iceberg catalog at /tmp/warehouse
  2. Create fixture tables defined in /fixtures/schema.json and load
     parquet data from /fixtures/*.parquet
  3. Run the user's submitted script (which uses PyIceberg API to
     query/transform/evolve schema)
  4. Read the resulting table (or any table the user writes to
     /tmp/warehouse/default/<name>)
  5. Compare against /expected/expected.parquet (if mounted)
  6. Write a JSON result line to stdout

Output (single line, valid JSON):
    {"passed": true|false, "output": "...", "error": "...", "runtime_ms": N}

Notes:
  - Covers both Databricks-style Delta patterns and pure Iceberg. UI labels
    as "Databricks / Iceberg".
  - Schema evolution + time-travel are tested via the PyIceberg API only;
    Spark is intentionally absent.
"""

import importlib.util
import json
import os
import shutil
import sys
import time
import traceback
from pathlib import Path


SUBMISSION_FILE = os.environ.get("SUBMISSION_FILE", "/sandbox/solution.py")
WAREHOUSE = os.environ.get("ICEBERG_WAREHOUSE", "/tmp/warehouse")
FIXTURES_DIR = os.environ.get("FIXTURES_DIR", "/fixtures")
EXPECTED_PATH = os.environ.get("EXPECTED_PATH", "/expected/expected.parquet")


def emit(result: dict) -> None:
    print(json.dumps(result), flush=True)


def init_warehouse():
    """Wipe the warehouse so previous attempts don't leak state."""
    if os.path.exists(WAREHOUSE):
        shutil.rmtree(WAREHOUSE)
    Path(WAREHOUSE).mkdir(parents=True, exist_ok=True)


def load_fixtures():
    """Initialise the catalog and load parquet fixtures as Iceberg tables.

    Returns the catalog object so user code can access it. Fixture
    configuration comes from /fixtures/schema.json — a list of
    {table_name, file} entries. If schema.json is absent, this is a
    no-op (the user's code is responsible for creating tables itself).
    """
    from pyiceberg.catalog.sql import SqlCatalog

    schema_path = os.path.join(FIXTURES_DIR, "schema.json")
    catalog = SqlCatalog(
        "sandbox",
        **{
            "type": "sql",
            "uri": f"sqlite:///{WAREHOUSE}/catalog.db",
            "warehouse": f"file://{WAREHOUSE}",
        },
    )

    if not os.path.isfile(schema_path):
        return catalog

    import duckdb

    with open(schema_path) as f:
        schema = json.load(f)

    for entry in schema:
        name = entry["table"]
        file = os.path.join(FIXTURES_DIR, entry["file"])
        if not os.path.isfile(file):
            continue
        # Ingest parquet into DuckDB, register as a view, then create the
        # Iceberg table from it. PyIceberg's create-from-pandas path is
        # the simplest portable way to land arbitrary fixture data.
        con = duckdb.connect()
        df = con.execute(f"SELECT * FROM read_parquet(?)", [file]).fetchdf()
        try:
            tbl = catalog.create_table(
                f"default.{name}",
                schema=df_to_schema(df),
            )
            tbl.append(df)
        except Exception:
            # Table may already exist from a previous fixture — overwrite.
            catalog.drop_table(f"default.{name}")
            tbl = catalog.create_table(
                f"default.{name}",
                schema=df_to_schema(df),
            )
            tbl.append(df)

    return catalog


def df_to_schema(df):
    """Map a pandas DataFrame's columns to a PyIceberg Schema."""
    from pyiceberg.schema import Schema
    from pyiceberg.types import (
        DoubleType,
        IntegerType,
        LongType,
        NestedField,
        StringType,
        TimestampType,
        BooleanType,
    )

    type_map = {
        "int64": LongType(),
        "int32": IntegerType(),
        "float64": DoubleType(),
        "float32": DoubleType(),
        "bool": BooleanType(),
        "datetime64[ns]": TimestampType(),
        "object": StringType(),
    }
    fields = []
    for i, (col, dtype) in enumerate(zip(df.columns, df.dtypes)):
        iceberg_type = type_map.get(str(dtype), StringType())
        fields.append(NestedField(field_id=i + 1, name=col, field_type=iceberg_type, required=False))
    return Schema(*fields)


def run_user_script(catalog):
    """Execute the user's submitted Python file with the catalog in scope."""
    spec = importlib.util.spec_from_file_location("user_iceberg", SUBMISSION_FILE)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not load spec from {SUBMISSION_FILE}")
    module = importlib.util.module_from_spec(spec)
    module.catalog = catalog
    module.warehouse = WAREHOUSE
    spec.loader.exec_module(module)


def read_output_table(table_name="solution"):
    """Read the user's final table as a pandas DataFrame for comparison."""
    from pyiceberg.catalog.sql import SqlCatalog
    catalog = SqlCatalog(
        "sandbox",
        **{
            "type": "sql",
            "uri": f"sqlite:///{WAREHOUSE}/catalog.db",
            "warehouse": f"file://{WAREHOUSE}",
        },
    )
    return catalog.load_table(f"default.{table_name}").to_pandas()


def main() -> int:
    if not os.path.isfile(SUBMISSION_FILE):
        emit({"passed": False, "output": "", "error": "submission file not provided", "runtime_ms": 0})
        return 0

    init_warehouse()
    start = time.time()
    try:
        catalog = load_fixtures()
        run_user_script(catalog)

        if not os.path.isfile(EXPECTED_PATH):
            elapsed = round((time.time() - start) * 1000, 2)
            emit({
                "passed": True,
                "output": "(no expected output configured)",
                "error": "no expected output for this problem",
                "runtime_ms": elapsed,
            })
            return 0

        actual_df = read_output_table()
        import pandas as pd
        expected_df = pd.read_parquet(EXPECTED_PATH)

        try:
            pd.testing.assert_frame_equal(
                actual_df.reset_index(drop=True),
                expected_df.reset_index(drop=True),
                check_dtype=False,
            )
            elapsed = round((time.time() - start) * 1000, 2)
            emit({"passed": True, "output": actual_df.to_csv(index=False), "error": "", "runtime_ms": elapsed})
            return 0
        except AssertionError as diff_err:
            elapsed = round((time.time() - start) * 1000, 2)
            emit({
                "passed": False,
                "output": actual_df.to_csv(index=False),
                "error": f"result does not match expected: {str(diff_err).splitlines()[0]}",
                "runtime_ms": elapsed,
            })
            return 0
    except Exception as e:
        elapsed = round((time.time() - start) * 1000, 2)
        emit({"passed": False, "output": "", "error": f"{type(e).__name__}: {e}", "runtime_ms": elapsed})
        return 0


if __name__ == "__main__":
    sys.exit(main())

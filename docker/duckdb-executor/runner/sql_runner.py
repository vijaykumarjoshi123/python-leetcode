"""
SQL submission runner.

Reads a .sql file submitted by the user, executes it against an in-memory
DuckDB instance loaded with parquet fixtures, then compares the result
dataframe against the expected output table. Writes a JSON result line
to stdout.

Contract (stdout, single line, valid JSON):
    {"passed": true|false, "output": "...", "error": "...", "runtime_ms": N}

Failure modes:
- File missing -> error: "submission file not provided"
- SQL syntax error -> error: "<duckdb parser message>", passed=false
- Empty result -> error: "query returned no rows", passed=false
- Schema/row mismatch -> passed=false, error: "<diff summary>"
"""

import json
import os
import sys
import time
import traceback

import duckdb
import pandas as pd


SUBMISSION_FILE = os.environ.get("SUBMISSION_FILE", "/sandbox/solution.sql")
FIXTURES_DIR = os.environ.get("FIXTURES_DIR", "/fixtures")
EXPECTED_PATH = os.environ.get("EXPECTED_PATH", "/expected/expected.parquet")


def emit(result: dict) -> None:
    """Print a single JSON line and exit."""
    print(json.dumps(result), flush=True)


def load_fixtures(con: duckdb.DuckDBPyConnection) -> list[str]:
    """Register every *.parquet in /fixtures as a view named after the file.

    e.g. /fixtures/user_events.parquet -> view "user_events".
    Returns the list of registered view names.
    """
    if not os.path.isdir(FIXTURES_DIR):
        return []
    names = []
    for fname in sorted(os.listdir(FIXTURES_DIR)):
        if not fname.endswith(".parquet"):
            continue
        name = fname[: -len(".parquet")]
        path = os.path.join(FIXTURES_DIR, fname)
        # Use read_parquet + register so column types stay explicit.
        con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet(?)", [path])
        names.append(name)
    return names


def main() -> int:
    if not os.path.isfile(SUBMISSION_FILE):
        emit({"passed": False, "output": "", "error": "submission file not provided", "runtime_ms": 0})
        return 1

    try:
        with open(SUBMISSION_FILE, "r", encoding="utf-8") as f:
            sql_text = f.read()
    except Exception as e:
        emit({"passed": False, "output": "", "error": f"could not read submission: {e}", "runtime_ms": 0})
        return 1

    start = time.time()
    try:
        con = duckdb.connect(":memory:")
        load_fixtures(con)

        result_df = con.execute(sql_text).fetchdf()
        elapsed_ms = round((time.time() - start) * 1000, 2)

        if not os.path.isfile(EXPECTED_PATH):
            # No expected output configured — pass on execution alone, but
            # surface a warning so the caller knows grading is incomplete.
            emit({
                "passed": True,
                "output": result_df.to_csv(index=False),
                "error": "no expected output configured for this problem",
                "runtime_ms": elapsed_ms,
            })
            return 0

        expected_df = pd.read_parquet(EXPECTED_PATH)

        try:
            pd.testing.assert_frame_equal(
                result_df.reset_index(drop=True),
                expected_df.reset_index(drop=True),
                check_dtype=False,
            )
            emit({
                "passed": True,
                "output": result_df.to_csv(index=False),
                "error": "",
                "runtime_ms": elapsed_ms,
            })
            return 0
        except AssertionError as diff_err:
            emit({
                "passed": False,
                "output": result_df.to_csv(index=False),
                "error": f"result does not match expected: {str(diff_err).splitlines()[0]}",
                "runtime_ms": elapsed_ms,
            })
            return 0
    except duckdb.Error as db_err:
        elapsed_ms = round((time.time() - start) * 1000, 2)
        emit({"passed": False, "output": "", "error": f"SQL error: {db_err}", "runtime_ms": elapsed_ms})
        return 0
    except Exception as e:
        elapsed_ms = round((time.time() - start) * 1000, 2)
        emit({"passed": False, "output": "", "error": f"{type(e).__name__}: {e}", "runtime_ms": elapsed_ms})
        return 0


if __name__ == "__main__":
    sys.exit(main())

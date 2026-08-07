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


def _contains_question_mark(sql: str) -> bool:
    """Return True if `sql` has a `?` outside of string literals and
    line comments.

    DuckDB always parses user SQL through its prepared-statement
    machinery, so a literal `?` is treated as a positional parameter
    marker and the executor raises an opaque error when no params are
    supplied. We want to catch user-written placeholder `?`s before
    they hit DuckDB so we can return a useful error.

    We intentionally allow `?` inside single-quoted string literals
    (e.g. `'score: 50? amazing'`) and inside `--` line comments —
    those don't conflict with prepared-statement parsing. We do not
    support block comments (`/* ... */`) or dollar-quoted strings
    (`$tag$ ... $tag$`) here because the rest of the runner doesn't
    either; add support if/when those features appear in test SQL.
    """
    i = 0
    n = len(sql)
    while i < n:
        c = sql[i]
        # Line comment: skip to end of line.
        if c == "-" and i + 1 < n and sql[i + 1] == "-":
            i += 2
            while i < n and sql[i] != "\n":
                i += 1
            continue
        # Single-quoted string literal: handle the doubled '' escape.
        if c == "'":
            i += 1
            while i < n:
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        # Doubled single-quote inside literal — skip both.
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            continue
        if c == "?":
            return True
        i += 1
    return False


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
        # Create a view named after the file that reads the parquet. We
        # previously used a bound parameter (`read_parquet(?)`), but this
        # DuckDB version rejects a prepared `?` inside read_parquet() with
        # a Binder Error, breaking every SQL submission. Interpolating the
        # path is safe here because `path` is a trusted, image-controlled
        # fixture filename (not user input); the filename is also
        # single-quote escaped defensively in case a future fixture name
        # ever contains one.
        safe_path = path.replace("'", "''")
        con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{safe_path}')")
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

        # DuckDB always parses user SQL through its prepared-statement
        # machinery, so any literal `?` in the SQL is treated as a
        # positional parameter marker. Submissions are not parameterized,
        # so we pre-check for stray `?` and surface a clear error before
        # DuckDB does. Without this guard the user sees "Binder Error:
        # Unexpected prepared parameter. This type of statement can't be
        # prepared!" (or "Values were not provided for the following
        # prepared statement parameters: 1"), which is opaque. We do not
        # silently strip the `?` — it's almost certainly a TODO
        # placeholder the user forgot to replace, and silent rewriting
        # would mask real bugs in their query.
        #
        # Substring search would false-positive on `?` inside string
        # literals (e.g. `'score: 50? amazing'`), so we walk the SQL and
        # skip single-quoted strings and `--` line comments.
        if _contains_question_mark(sql_text):
            elapsed_ms = round((time.time() - start) * 1000, 2)
            emit({
                "passed": False,
                "output": "",
                "error": (
                    "SQL error: your query contains a `?` character. "
                    "DuckDB treats `?` as a parameter placeholder, but "
                    "this runner does not accept parameterized queries. "
                    "Remove the `?` (it is usually a TODO placeholder "
                    "you forgot to replace) and resubmit."
                ),
                "runtime_ms": elapsed_ms,
            })
            return 0

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

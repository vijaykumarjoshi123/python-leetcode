#!/bin/bash
# dbt submission runner.
#
# Args:
#   $1 — absolute in-container path to the user's submitted .sql model
#        (mounted read-only by the executor).
#
# Lifecycle:
#   1. Copy user's SQL into models/staging/solution.sql (overwriting template)
#   2. dbt seed       — load CSVs from seeds/ as dbt-managed tables
#   3. dbt run --select solution — build the user's model
#   4. dbt test --select solution — execute tests declared by the user
#      (or by dbt_project.yml defaults if they didn't add a schema.yml)
#   5. Parse run_results.json + a fresh `dbt show` for output preview
#   6. Write a single JSON line to stdout
#
# Output contract (single line, valid JSON):
#   {"passed": true|false, "output": "...", "error": "...", "runtime_ms": N}
#
# Pass criteria: every dbt run + test for the `solution` model passes AND
# the model query returns the expected rows when compared against
# /expected/expected.parquet (if mounted).
set -u

USER_FILE="${1:-/sandbox/solution.sql}"
SOLUTION_PATH="/project/models/staging/solution.sql"
EXPECTED_PATH="${EXPECTED_PATH:-/expected/expected.parquet}"
START=$(date +%s%N)

emit() {
  local passed="$1" output="$2" error="$3" runtime_ms="$4"
  printf '{"passed": %s, "output": %s, "error": %s, "runtime_ms": %s}\n' \
    "$passed" \
    "$(printf '%s' "$output" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$error" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$runtime_ms"
}

if ! cp "$USER_FILE" "$SOLUTION_PATH"; then
  emit false "" "could not copy submission to $SOLUTION_PATH" 0
  exit 0
fi

# Reset the warehouse so a previous failed attempt doesn't pollute state.
rm -f /project/dev.duckdb /project/target/run_results.json /project/target/manifest.json
mkdir -p /project/target

# dbt seed (best-effort: seeds are optional). We tolerate failure here
# because a problem might not use seeds; the user's model will fail in
# `dbt run` if it depends on a missing seed and that's where we surface it.
dbt seed --profiles-dir /profiles --no-version-check >/tmp/dbt_seed.log 2>&1 || true

# Build the model. Treat a non-zero exit as a hard failure with the log tail.
if ! dbt run --select solution --profiles-dir /profiles --no-version-check >/tmp/dbt_run.log 2>&1; then
  TAIL=$(tail -c 4000 /tmp/dbt_run.log)
  ELAPSED_MS=$(( ( $(date +%s%N) - START ) / 1000000 ))
  emit false "" "dbt run failed: $TAIL" "$ELAPSED_MS"
  exit 0
fi

# Run tests. A test failure here means the model compiled but produced
# something that violates a declared test (e.g. uniqueness, not-null).
if ! dbt test --select solution --profiles-dir /profiles --no-version-check >/tmp/dbt_test.log 2>&1; then
  TAIL=$(tail -c 4000 /tmp/dbt_test.log)
  ELAPSED_MS=$(( ( $(date +%s%N) - START ) / 1000000 ))
  emit false "" "dbt tests failed: $TAIL" "$ELAPSED_MS"
  exit 0
fi

# Preview the model's output for the caller.
USER_OUTPUT=$(dbt show --select solution --profiles-dir /profiles --no-version-check --limit 100 2>/dev/null || echo "(no preview available)")

# If expected output is mounted, do a row-level diff against it.
if [ -f "$EXPECTED_PATH" ]; then
  DIFF=$(python3 - <<PYEOF
import duckdb, json, os
expected = "$EXPECTED_PATH"
try:
    con = duckdb.connect()
    a = con.execute("SELECT * FROM read_parquet(?) ORDER BY 1,2", [expected]).fetchall()
    b = con.execute("SELECT * FROM dev.duckdb.main.staging.solution ORDER BY 1,2").fetchall()
    if a != b:
        print(json.dumps({"error": f"row mismatch: expected {len(a)} rows, got {len(b)}"}))
    else:
        print(json.dumps({"error": ""}))
except Exception as e:
    print(json.dumps({"error": f"diff failed: {e}"}))
PYEOF
)
  ERROR_MSG=$(printf '%s' "$DIFF" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("error",""))')
  ELAPSED_MS=$(( ( $(date +%s%N) - START ) / 1000000 ))
  if [ -n "$ERROR_MSG" ]; then
    emit false "$USER_OUTPUT" "$ERROR_MSG" "$ELAPSED_MS"
    exit 0
  fi
fi

ELAPSED_MS=$(( ( $(date +%s%N) - START ) / 1000000 ))
emit true "$USER_OUTPUT" "" "$ELAPSED_MS"
exit 0

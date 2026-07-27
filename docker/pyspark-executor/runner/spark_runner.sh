#!/bin/bash
# PySpark submission runner.
#
# Args:
#   $1 — absolute in-container path to the user's submitted .py file
#        (mounted read-only by the executor; copied to /tmp/solution.py
#        to give spark-submit a writable working file).
#
# Contract:
#   - User's script is expected to write any output DataFrames to
#     /tmp/output/<name>.parquet (any filename)
#   - Expected outputs are parquet files under /expected/
#   - This script compares /tmp/output/ against /expected/ using duckdb's
#     parquet diff and writes a single JSON line to stdout
#
# Output (single line, valid JSON):
#   {"passed": true|false, "output": "...", "error": "...", "runtime_ms": N}
#
# PySpark startup adds ~8-15s; the router's per-executor timeout (60s) is
# what bounds the run wall-clock here. SIGKILL at timeout means we lose
# any in-flight spark job — acceptable since the user can resubmit.
set -u

USER_FILE="${1:-/sandbox/solution.py}"
SOLUTION_FILE="/tmp/solution.py"
OUTPUT_DIR="/tmp/output"
EXPECTED_DIR="/expected"
START=$(date +%s%N)

emit() {
  local passed="$1" output="$2" error="$3" runtime_ms="$4"
  printf '{"passed": %s, "output": %s, "error": %s, "runtime_ms": %s}\n' \
    "$passed" \
    "$(printf '%s' "$output" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$error" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$runtime_ms"
}

mkdir -p "$OUTPUT_DIR"

# Copy the user's file to a writable location so user code that creates
# helper files (e.g. checkpoints) can do so without tripping the :ro mount.
if ! cp "$USER_FILE" "$SOLUTION_FILE"; then
  emit false "" "could not copy submission to /tmp/solution.py" 0
  exit 0
fi
chmod 644 "$SOLUTION_FILE"

# Run spark-submit. Stdout and stderr are captured separately so we can
# surface the user's print() output in `output` and put tracebacks in
# `error`. The runner returns exit code 0 even on test failure so the
# JSON contract is preserved.
SPARK_STDOUT=$(mktemp)
SPARK_STderr=$(mktemp)
spark-submit \
  --master 'local[2]' \
  --driver-memory 512m \
  --conf spark.sql.shuffle.partitions=4 \
  "$SOLUTION_FILE" \
  >"$SPARK_STDOUT" 2>"$SPARK_STderr"
SPARK_EXIT=$?
ELAPSED_MS=$(( ( $(date +%s%N) - START ) / 1000000 ))

if [ "$SPARK_EXIT" -ne 0 ]; then
  ERROR_MSG=$(head -c 4000 "$SPARK_STderr")
  emit false "" "spark-submit failed (exit=$SPARK_EXIT): $ERROR_MSG" "$ELAPSED_MS"
  exit 0
fi

# If /expected/ isn't mounted, the problem doesn't have a grading script
# configured — treat successful execution alone as a pass with a warning.
if [ ! -d "$EXPECTED_DIR" ] || [ -z "$(ls -A "$EXPECTED_DIR" 2>/dev/null)" ]; then
  USER_OUTPUT=$(head -c 4000 "$SPARK_STDOUT")
  emit true "$USER_OUTPUT" "no expected output configured for this problem" "$ELAPSED_MS"
  exit 0
fi

# Compare outputs using duckdb's parquet reader. For every file in
# /expected/, the user should have produced /tmp/output/<same-name>.parquet.
# Any mismatch -> passed=false with a diff summary.
DIFF=$(python3 - <<PYEOF 2>&1
import os, sys, json
import duckdb

expected_dir = "$EXPECTED_DIR"
output_dir = "$OUTPUT_DIR"

if not os.path.isdir(output_dir):
    print(json.dumps({"error": "user script did not write anything to /tmp/output/"}))
    sys.exit(0)

mismatches = []
for fname in sorted(os.listdir(expected_dir)):
    if not fname.endswith(".parquet"):
        continue
    expected_path = os.path.join(expected_dir, fname)
    user_path = os.path.join(output_dir, fname)
    if not os.path.isfile(user_path):
        mismatches.append(f"missing output file: {fname}")
        continue
    try:
        con = duckdb.connect()
        a = con.execute(f"SELECT * FROM read_parquet(?) ORDER BY 1,2", [expected_path]).fetchall()
        b = con.execute(f"SELECT * FROM read_parquet(?) ORDER BY 1,2", [user_path]).fetchall()
        if a != b:
            mismatches.append(f"row mismatch in {fname} (expected {len(a)} rows, got {len(b)})")
    except Exception as e:
        mismatches.append(f"error reading {fname}: {e}")

if mismatches:
    print(json.dumps({"error": "; ".join(mismatches)}))
else:
    print(json.dumps({"error": ""}))
PYEOF
)

USER_OUTPUT=$(head -c 4000 "$SPARK_STDOUT")
ERROR_MSG=$(printf '%s' "$DIFF" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("error",""))')

if [ -n "$ERROR_MSG" ]; then
  emit false "$USER_OUTPUT" "$ERROR_MSG" "$ELAPSED_MS"
else
  emit true "$USER_OUTPUT" "" "$ELAPSED_MS"
fi
exit 0

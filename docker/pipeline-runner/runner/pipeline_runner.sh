#!/bin/bash
# Pipeline runner entry point. Tier 3 / Section 11C.
#
# Args (from the executorRouter buildCmd):
#   $1 — path to the pipeline spec JSON, mounted at /sandbox/pipeline_spec.json
#        by the backend (Section 11D's pipelineOrchestrator.js)
#
# Contract:
#   - This script does NOT spawn other containers. The backend owns
#     per-stage container spawning (via pythonExecutor.js's spawn pattern).
#   - The backend mounts each stage's actual output at the path the
#     spec references (e.g. /tmp/stages/<id>/output).
#   - The backend mounts expected outputs at /expected/<id>.parquet if
#     the spec asks for that stage to be compared.
#   - This script runs the comparison logic in pipeline_runner.py and
#     emits a single JSON line to stdout.
#
# Output (single line, valid JSON):
#   {
#     "passed": true|false,
#     "pipelineId": "...",
#     "stageResults": [{"stageId","status","runtimeMs","output","error"}, ...],
#     "totalRuntimeMs": N,
#     "error": "..."
#   }
#
# Timeout: 5 minutes (per the router config). Realistic for a pipeline
# with 4-6 stages plus final comparison.

set -u

SPEC_FILE="${1:-/sandbox/pipeline_spec.json}"
export PIPELINE_SPEC="$SPEC_FILE"

exec python3 /runner/pipeline_runner.py

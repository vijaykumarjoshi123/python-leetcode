# Pipeline orchestrator image. Tier 3 / Section 11C.
#
# This image does NOT execute any user code directly. It is the parent
# orchestrator that:
#   1. Reads the pipeline spec from /sandbox/pipeline_spec.json
#   2. For each stage in topological order, calls the existing
#      single-tool runner containers (python/sql/pyspark/dbt/airflow/
#      kafka/iceberg) and parses their JSON output
#   3. Aggregates per-stage results into a single consolidated result
#
# The orchestrator itself only needs Python for JSON I/O and DuckDB for
# fixture comparisons — same dependency footprint as the duckdb-executor.

FROM python:3.11-slim

# numpy 1.x is required because pandas 2.1.x and pyarrow 14.x were
# built against the numpy 1.x ABI. The python:3.11-slim base image
# has been updated to ship numpy 2.x by default, which causes
# "numpy.dtype size changed, may indicate binary incompatibility"
# errors at import time. Pin numpy<2 to keep the wheels compatible.
# (Same latent issue exists in duckdb-executor, pyspark-executor, and
# iceberg-executor Dockerfiles; Section 11C fix here only.)
RUN pip install --no-cache-dir 'numpy<2' duckdb==0.10.0 pandas==2.1.0 pyarrow==14.0.1

# Mount points:
#   /sandbox/pipeline_spec.json   the orchestrator reads this on startup
#   /fixtures/                    input fixtures mounted by the backend
#   /tmp/stages/<stage_id>/       output dir for each stage
#   /expected/<stage_id>.parquet  expected output per stage (if mounted)
#   /runner/                      the orchestrator shell + Python helpers
RUN mkdir -p /sandbox /fixtures /tmp/stages /expected
COPY runner/ /runner/

# Sandbox user — non-root so a Python escape can't trivially escalate.
RUN useradd -m sandbox && chown -R sandbox /runner /sandbox /fixtures /tmp/stages /expected
USER sandbox

WORKDIR /runner

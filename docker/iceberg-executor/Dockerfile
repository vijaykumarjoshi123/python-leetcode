FROM python:3.11-slim

# PyIceberg + DuckDB. The DuckDB adapter is the workhorse for query and
# comparison; PyIceberg handles schema evolution, time-travel reads, and
# partition pruning via the API. Covers both Databricks-Delta patterns and
# pure Iceberg.

# Pin numpy<2: pandas==2.1.0 / duckdb==0.10.0 built against NumPy 1.x.
RUN pip install --no-cache-dir "numpy<2" pyiceberg==0.7.0 duckdb==0.10.0 pandas==2.1.0 pyarrow==14.0.1 sqlalchemy==2.0.19

COPY runner/ /runner/

# Sandbox user.
RUN useradd -m sandbox

# Writable warehouse location for the sandbox catalog.
RUN mkdir -p /tmp/warehouse && chown -R sandbox /tmp/warehouse /runner

USER sandbox

ENV ICEBERG_WAREHOUSE=/tmp/warehouse
ENV EXPECTED_PATH=/expected/expected.parquet

WORKDIR /runner

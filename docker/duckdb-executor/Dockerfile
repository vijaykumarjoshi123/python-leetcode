FROM python:3.11-slim

# DuckDB is the SQL sandbox engine. It is Snowflake-compatible in syntax
# (window functions, CTEs, QUALIFY, FLATTEN, PIVOT all work), runs in-process
# with no credentials, and is fast. UI labels these problems as
# "Snowflake-style SQL", not "DuckDB".

# Pin numpy<2: pandas==2.1.0 was built against NumPy 1.x, and an unpinned
# install pulls NumPy 2.x, which crashes at import with
# "A module that was compiled using NumPy 1.x cannot be run in NumPy 2.x".
# This blocked every SQL submission before the user's query could run.
RUN pip install --no-cache-dir "numpy<2" duckdb==0.10.0 pandas==2.1.0 pyarrow==14.0.1

# Mount points the runner expects:
#   /fixtures/*.parquet   input fixture tables
#   /expected/expected.parquet  expected output table for comparison
#   /runner/*             the runner script
RUN mkdir -p /fixtures /expected
COPY runner/ /runner/

# Sandbox user. The container runs as non-root so a Python escape can't
# trivially escalate.
RUN useradd -m sandbox && chown -R sandbox /runner /fixtures /expected
USER sandbox

WORKDIR /runner

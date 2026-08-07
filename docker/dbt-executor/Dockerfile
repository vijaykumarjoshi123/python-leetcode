FROM python:3.11-slim

# dbt-core + dbt-duckdb adapter. DuckDB replaces BigQuery/Snowflake/Redshift
# for the dbt sandbox — it's the only adapter that ships with no credentials,
# runs in-process, and supports the SQL features dbt emits.
# Pin numpy<2 defensively: dbt-duckdb may pull pandas/duckdb transitively,
# which were built against NumPy 1.x and crash under NumPy 2.x.
RUN pip install --no-cache-dir "numpy<2" dbt-core==1.7.0 dbt-duckdb==1.7.0

COPY project_template/ /project/
COPY profiles/ /profiles/
COPY runner/ /runner/

# Sandbox user. dbt writes artifacts to /project/target/ which must be
# writable by the sandbox user.
RUN useradd -m sandbox && chown -R sandbox /project /profiles /runner
USER sandbox

# Tell dbt where to find the profile. dbt-duckdb doesn't need credentials,
# just the profile config + a target name.
ENV DBT_PROFILES_DIR=/profiles
ENV DBT_TARGET=dev

WORKDIR /project

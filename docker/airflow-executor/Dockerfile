FROM python:3.11-slim

# Airflow is heavy — pin versions and use the constraints file pattern so
# the image rebuilds are deterministic. We don't pull constraints.txt at
# build time here (offline assumption); operators are expected to regenerate
# constraints if upgrading.
ARG AIRFLOW_VERSION=2.9.0
ARG PYTHON_VERSION=3.11
ARG CONSTRAINT_URL="https://raw.githubusercontent.com/apache/airflow/constraints-${AIRFLOW_VERSION}/constraints-${PYTHON_VERSION}.txt"

RUN pip install --no-cache-dir \
    "apache-airflow==${AIRFLOW_VERSION}" \
    --constraint "${CONSTRAINT_URL}"

# Disable Airflow's heavy example DAG loading — we only ever import user DAGs.
ENV AIRFLOW__CORE__LOAD_EXAMPLES=False
ENV AIRFLOW__CORE__DAGS_FOLDER=/sandbox

COPY runner/ /runner/

# Sandbox user. Airflow's DAG parser runs at import time and any code that
# executes inside the parser runs as this uid.
RUN useradd -m sandbox && chown -R sandbox /runner
USER sandbox

WORKDIR /runner

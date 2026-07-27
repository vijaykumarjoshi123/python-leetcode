FROM bitnami/spark:3.5

USER root

# PySpark + delta-spark for DataFrame API and Delta Lake writes.
# The user submission writes its output to /tmp/output/ as parquet.
RUN pip install --no-cache-dir pyspark==3.5.0 pandas==2.1.0 pyarrow==14.0.1 delta-spark==3.0.0

# Sandbox user. Spark jobs run as this uid; the bitnami image's default
# user (1001) is fine but creating a named one keeps logs greppable.
RUN useradd -m sandbox
USER sandbox

WORKDIR /tmp

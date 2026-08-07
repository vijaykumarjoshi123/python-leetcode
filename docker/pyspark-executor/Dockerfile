FROM bitnami/spark:3.5

USER root

# PySpark + delta-spark for DataFrame API and Delta Lake writes.
# The user submission writes its output to /tmp/output/ as parquet.
# Pin numpy<2: pandas==2.1.0 was built against NumPy 1.x; an unpinned install
# pulls NumPy 2.x and crashes at import ("compiled using NumPy 1.x cannot be
# run in NumPy 2.x"), which breaks every PySpark submission before user code.
RUN pip install --no-cache-dir "numpy<2" pyspark==3.5.0 pandas==2.1.0 pyarrow==14.0.1 delta-spark==3.0.0

# Sandbox user. Spark jobs run as this uid; the bitnami image's default
# user (1001) is fine but creating a named one keeps logs greppable.
RUN useradd -m sandbox
USER sandbox

WORKDIR /tmp

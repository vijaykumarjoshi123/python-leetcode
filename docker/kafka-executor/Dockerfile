FROM python:3.11-slim

# Kafka 3.7 + a JRE to run it. KRaft mode (Kafka 3.3+) eliminates the
# Zookeeper dependency, making it feasible to run inside one container
# with reasonable startup time (~5-8s).
ENV KAFKA_VERSION=3.7.0
ENV KAFKA_SCALA=2.13

# Install JDK first (large but cacheable), then Kafka, then Python clients.
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q "https://downloads.apache.org/kafka/${KAFKA_VERSION}/kafka_${KAFKA_SCALA}-${KAFKA_VERSION}.tgz" -O /tmp/kafka.tgz \
    && tar -xzf /tmp/kafka.tgz -C /opt/ \
    && mv /opt/kafka_${KAFKA_SCALA}-${KAFKA_VERSION} /opt/kafka \
    && rm /tmp/kafka.tgz

ENV PATH="/opt/kafka/bin:${PATH}"
ENV JAVA_HOME=/usr/lib/jvm/default-java

RUN pip install --no-cache-dir kafka-python==2.0.2 confluent-kafka==2.4.0 duckdb==0.10.0 pandas==2.1.0

COPY runner/ /runner/

RUN useradd -m sandbox && chown -R sandbox /runner /opt/kafka
USER sandbox

WORKDIR /runner

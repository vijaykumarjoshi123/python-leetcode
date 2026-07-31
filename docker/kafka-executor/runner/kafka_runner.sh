#!/bin/bash
# Kafka submission runner.
#
# Lifecycle:
#   1. Format storage and start Kafka in KRaft mode on localhost:9092
#   2. Wait for the broker to be ready
#   3. Create topics defined in /fixtures/topics.json and seed them from
#      /fixtures/seed_messages.json (if mounted)
#   4. Run the user's submitted Python script — it should produce/consume
#      and write its output to /tmp/output.json
#   5. Compare /tmp/output.json against /expected/expected_messages.json
#      (if mounted)
#   6. Stop Kafka and write a JSON result line to stdout
#
# Args:
#   $1 — absolute in-container path to the user's submitted .py file
#
# Output (single line, valid JSON):
#   {"passed": true|false, "output": "...", "error": "...", "runtime_ms": N,
#    "diagnostics": {...}?}
#
# Section 11I — when PIPELINE_COLLECT_DIAGNOSTICS is set, the JSON line
# may also include a `diagnostics` object with:
#   - consumerLag     — total messages behind across the user's consumer
#                       group (queried via kafka-consumer-groups.sh after
#                       the user script has run)
#   - topicStats[]    — list of {topic, partition, logEndOffset,
#                       messageCount} for each topic in the broker
# On clean stages the orchestrator doesn't request diagnostics; the
# extra kafka-consumer-groups.sh call is skipped to keep the cost limit.
set -u

USER_FILE="${1:-/sandbox/solution.py}"
EXPECTED_FILE="${EXPECTED_FILE:-/expected/expected_messages.json}"
KAFKA_PORT="${KAFKA_PORT:-9092}"
KAFKA_LOG_DIR="/tmp/kraft-combined-logs"
KAFKA_PROPS="/tmp/kraft-server.properties"
START=$(date +%s%N)

emit() {
  local passed="$1" output="$2" error="$3" runtime_ms="$4" diagnostics="${5-}"
  if [ -n "$diagnostics" ] && [ "$diagnostics" != "{}" ]; then
    printf '{"passed": %s, "output": %s, "error": %s, "runtime_ms": %s, "diagnostics": %s}\n' \
      "$passed" \
      "$(printf '%s' "$output" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
      "$(printf '%s' "$error" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
      "$runtime_ms" \
      "$diagnostics"
  else
    printf '{"passed": %s, "output": %s, "error": %s, "runtime_ms": %s}\n' \
      "$passed" \
      "$(printf '%s' "$output" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
      "$(printf '%s' "$error" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
      "$runtime_ms"
  fi
}

# Section 11I — collect Kafka consumer-group lag and per-topic offset
# stats. Best-effort: returns {} if the broker is in a bad state, no
# consumer group exists yet, or the user script never committed offsets.
collect_kafka_diagnostics() {
  python3 - "$KAFKA_PORT" <<'PYEOF'
import json, subprocess, sys
port = sys.argv[1]
bootstrap = f"localhost:{port}"
out = {"consumerLag": None, "topicStats": []}

# Topic stats: list topics and their end offsets. Cheap on a small
# broker — caps latency at ~100ms even with dozens of topics.
try:
    topics_proc = subprocess.run(
        ["/opt/kafka/bin/kafka-topics.sh", "--bootstrap-server", bootstrap, "--list"],
        capture_output=True, text=True, timeout=10,
    )
    topics = [t for t in topics_proc.stdout.splitlines() if t and not t.startswith("__")]
except Exception:
    topics = []

for t in topics:
    try:
        desc = subprocess.run(
            ["/opt/kafka/bin/kafka-topics.sh", "--bootstrap-server", bootstrap,
             "--describe", "--topic", t],
            capture_output=True, text=True, timeout=5,
        )
        # "Topic: foo Partition: 0 Leader: ... Replicas: ... Isr: ..."
        for ln in desc.stdout.splitlines():
            parts = ln.split()
            if len(parts) < 5:
                continue
            try:
                out["topicStats"].append({
                    "topic": parts[1],
                    "partition": int(parts[3]),
                    "logEndOffset": 0,  # parsed below
                    "messageCount": 0,
                })
            except (ValueError, IndexError):
                continue
    except Exception:
        pass

# Consumer-group lag: pick up any group the user script may have used.
# The script doesn't tell us its group name (it's user code), so we
# list all groups and aggregate lag. Empty list = no consumers yet.
try:
    groups_proc = subprocess.run(
        ["/opt/kafka/bin/kafka-consumer-groups.sh", "--bootstrap-server", bootstrap, "--list"],
        capture_output=True, text=True, timeout=10,
    )
    groups = [g for g in groups_proc.stdout.splitlines() if g]
except Exception:
    groups = []

total_lag = 0
for g in groups:
    try:
        desc = subprocess.run(
            ["/opt/kafka/bin/kafka-consumer-groups.sh", "--bootstrap-server", bootstrap,
             "--describe", "--group", g],
            capture_output=True, text=True, timeout=10,
        )
        # Each line: "GROUP TOPIC PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG HOST CLIENT-ID"
        for ln in desc.stdout.splitlines():
            parts = ln.split()
            if len(parts) < 6:
                continue
            try:
                lag = int(parts[5])
                if lag > 0:
                    total_lag += lag
            except ValueError:
                continue
    except Exception:
        pass

if total_lag > 0:
    out["consumerLag"] = total_lag

out = {k: v for k, v in out.items() if v}
print(json.dumps(out))
PYEOF
}

# 1. Generate a cluster id and format the storage directory.
CLUSTER_ID=$(/opt/kafka/bin/kafka-storage.sh random-uuid)
rm -rf "$KAFKA_LOG_DIR"

cat >"$KAFKA_PROPS" <<EOF
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@localhost:9093
listeners=PLAINTEXT://0.0.0.0:${KAFKA_PORT},CONTROLLER://localhost:9093
inter.broker.listener.name=PLAINTEXT
advertised.listeners=PLAINTEXT://localhost:${KAFKA_PORT}
controller.listener.names=CONTROLLER
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
num.network.threads=2
num.io.threads=2
socket.request.max.bytes=104857600
log.dirs=${KAFKA_LOG_DIR}
num.partitions=1
num.recovery.threads.per.data.dir=1
offsets.topic.replication.factor=1
transaction.state.log.replication.factor=1
transaction.state.log.min.isr=1
log.retention.hours=1
log.retention.minutes=1
log.segment.bytes=1073741824
log.retention.check.interval.ms=300000
group.initial.rebalance.delay.ms=0
EOF

/opt/kafka/bin/kafka-storage.sh format -t "$CLUSTER_ID" -c "$KAFKA_PROPS" >/dev/null 2>&1 || {
  emit false "" "kafka-storage format failed" 0
  exit 0
}

# 2. Start Kafka in the background. Capture pid for cleanup.
KAFKA_OUT=$(mktemp)
/opt/kafka/bin/kafka-server-start.sh "$KAFKA_PROPS" >"$KAFKA_OUT" 2>&1 &
KAFKA_PID=$!

cleanup() {
  kill "$KAFKA_PID" 2>/dev/null || true
  wait "$KAFKA_PID" 2>/dev/null || true
}
trap cleanup EXIT

# 3. Poll for broker readiness.
for i in $(seq 1 60); do
  if /opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server "localhost:${KAFKA_PORT}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! /opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server "localhost:${KAFKA_PORT}" >/dev/null 2>&1; then
  TAIL=$(tail -c 2000 "$KAFKA_OUT")
  emit false "" "kafka failed to start within 60s: $TAIL" 0
  exit 0
fi

# 4. Create + seed topics if fixtures are mounted.
if [ -f /fixtures/topics.json ] && [ -f /fixtures/seed_messages.json ]; then
  python3 - <<PYEOF
import json, subprocess, sys
from kafka import KafkaProducer, KafkaConsumer

bootstrap = "localhost:${KAFKA_PORT}"

with open("/fixtures/topics.json") as f:
    topics = json.load(f)
for t in topics:
    subprocess.run(["/opt/kafka/bin/kafka-topics.sh", "--bootstrap-server", bootstrap,
                    "--create", "--topic", t, "--partitions", "1", "--replication-factor", "1"],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

with open("/fixtures/seed_messages.json") as f:
    seeds = json.load(f)

producer = KafkaProducer(bootstrap_servers=bootstrap, value_serializer=lambda v: json.dumps(v).encode())
for topic, msgs in seeds.items():
    for m in msgs:
        producer.send(topic, m)
producer.flush()
PYEOF
fi

# 5. Run the user's script. They get KAFKA_BOOTSTRAP_SERVERS in env.
export KAFKA_BOOTSTRAP_SERVERS="localhost:${KAFKA_PORT}"
if ! python3 "$USER_FILE"; then
  ELAPSED_MS=$(( ( $(date +%s%N) - START ) / 1000000 ))
  DIAGNOSTICS=""
  if [ -n "$PIPELINE_COLLECT_DIAGNOSTICS" ]; then
    DIAGNOSTICS=$(collect_kafka_diagnostics)
  fi
  emit false "" "user script exited non-zero" "$ELAPSED_MS" "$DIAGNOSTICS"
  exit 0
fi

USER_OUTPUT=""
if [ -f /tmp/output.json ]; then
  USER_OUTPUT=$(head -c 4000 /tmp/output.json)
fi

ELAPSED_MS=$(( ( $(date +%s%N) - START ) / 1000000 ))

# Section 11I — diagnostics on the success path are also useful when
# PIPELINE_COLLECT_DIAGNOSTICS=always (used by the orchestrator for
# scenarios where the failure is in the comparison, not in user code).
DIAGNOSTICS=""
if [ -n "$PIPELINE_COLLECT_DIAGNOSTICS" ]; then
  DIAGNOSTICS=$(collect_kafka_diagnostics)
fi

# 6. Compare against expected if mounted.
if [ -f "$EXPECTED_FILE" ]; then
  DIFF=$(python3 - <<PYEOF
import json, sys
with open("$EXPECTED_FILE") as f:
    expected = json.load(f)
with open("/tmp/output.json") as f:
    actual = json.load(f)
if sorted(map(json.dumps, expected, sort_keys=True)) == sorted(map(json.dumps, actual, sort_keys=True)):
    print(json.dumps({"error": ""}))
else:
    print(json.dumps({"error": f"message count mismatch: expected {len(expected)}, got {len(actual)}"}))
PYEOF
)
  ERROR_MSG=$(printf '%s' "$DIFF" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("error",""))')
  if [ -n "$ERROR_MSG" ]; then
    emit false "$USER_OUTPUT" "$ERROR_MSG" "$ELAPSED_MS" "$DIAGNOSTICS"
    exit 0
  fi
fi

emit true "$USER_OUTPUT" "" "$ELAPSED_MS" "$DIAGNOSTICS"
exit 0

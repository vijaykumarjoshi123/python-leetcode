// Maps executorType strings to Docker image names and run commands.
// Adding a new tool means adding a new entry here. The router is the
// single source of truth for how a submission is dispatched.

// `buildCmd` returns an argv array (NOT a shell string) so it can be passed
// directly to `docker run <image> ...args` without any quoting concerns.
// Adding a new tool means adding a new entry here. The router is the single
// source of truth for how a submission is dispatched.
const EXECUTOR_CONFIG = {
  python: {
    image: 'python-executor',
    // The runner script wraps user code execution: it reads the
    // solution file, runs it in an isolated namespace, and emits the
    // JSON contract `{passed, output, error, runtime_ms, result}`.
    // The worker compares `result` against each test case's expected
    // output via normalizeResult().
    buildCmd: (file) => ['python3', '/runner/runner.py'],
    timeout: 5000,
    memoryMb: 256,
    toolVersion: 'Python 3.11',
    useGpu: false,
  },
  sql: {
    image: 'duckdb-executor',
    // SQL submissions are still injected as a .sql file but the runner
    // is a Python wrapper that loads fixtures and runs the SQL via DuckDB.
    buildCmd: (file) => ['python3', '/runner/sql_runner.py', file],
    timeout: 10000,
    memoryMb: 256,
    toolVersion: 'DuckDB 0.10 (Snowflake-compatible SQL)',
    useGpu: false,
  },
  pyspark: {
    image: 'pyspark-executor',
    // The runner handles the full lifecycle (copy file, spark-submit, capture
    // stdout, compare /tmp/output/ to /expected/, write JSON). See Section 3B.
    // Timeout bumped to 120s: the Spark JVM cold start alone eats ~30-40s,
    // and 60s left no margin for the runner's setup + the user's job under
    // pipeline concurrency, causing TLEs on otherwise-fine submissions.
    buildCmd: (file) => ['bash', '/runner/spark_runner.sh', file],
    timeout: 120000,
    memoryMb: 1024,
    toolVersion: 'PySpark 3.5',
    useGpu: false,
  },
  dbt: {
    image: 'dbt-executor',
    buildCmd: (file) => ['bash', '/runner/dbt_runner.sh', file],
    timeout: 60000,
    memoryMb: 512,
    toolVersion: 'dbt-core 1.7 (DuckDB adapter)',
    useGpu: false,
  },
  airflow: {
    image: 'airflow-executor',
    buildCmd: (file) => ['python3', '/runner/airflow_runner.py', file],
    timeout: 30000,
    memoryMb: 512,
    toolVersion: 'Apache Airflow 2.9',
    useGpu: false,
  },
  kafka: {
    image: 'kafka-executor',
    // Timeout bumped to 90s: the runner formats storage, boots Kafka in
    // KRaft mode, waits for the broker (~20s cold), creates topics, and
    // seeds messages before the user's script even runs. 30s was too tight
    // and the stage TLE'd before the user code got a chance to execute.
    buildCmd: (file) => ['bash', '/runner/kafka_runner.sh', file],
    timeout: 90000,
    memoryMb: 512,
    toolVersion: 'Kafka 3.7 (KRaft mode)',
    useGpu: false,
  },
  iceberg: {
    image: 'iceberg-executor',
    // The runner handles fixture setup, user script execution, and
    // comparison against /expected/. See Section 3F.
    buildCmd: (file) => ['python3', '/runner/iceberg_runner.py'],
    timeout: 60000,
    memoryMb: 512,
    toolVersion: 'PyIceberg 0.7 / DuckDB (Databricks-Iceberg)',
    useGpu: false,
  },

  // Tier 3 / Section 11B: the pipeline orchestrator itself. Note that
  // this is the executorType for the *orchestrator* container (built in
  // Section 11C). Individual pipeline stages use one of the 7 single-tool
  // types above; this entry exists so the orchestrator can be spawned
  // via the existing docker-run path with per-stage resource controls.
  //
  // Pipeline submissions are rejected at the HTTP layer by routes/
  // submissions.js — callers must use /api/pipelines/run instead, which
  // gives the orchestrator the pipelineSpec JSON instead of user code.
  pipeline: {
    image: 'pipeline-runner',
    // The runner receives a JSON spec describing the stages at $1 and
    // emits one consolidated result line to stdout (see Section 11C).
    buildCmd: (file) => ['bash', '/runner/pipeline_runner.sh', file],
    timeout: 300000,    // 5 min — pipelines can be long (Spark startup, Kafka KRaft boot, etc.)
    memoryMb: 2048,     // orchestrator + fixtures in memory; bump via Docker socket if you go bigger
    toolVersion: 'Multi-tool pipeline (Kafka → Spark → Iceberg → dbt)',
    useGpu: false,
  },
};

const DEFAULT_EXECUTOR = 'python';

/**
 * Resolve the configuration for an executorType.
 * Falls back to python when an unknown type is requested so we
 * never silently break a submission.
 */
function getExecutorConfig(executorType) {
  return EXECUTOR_CONFIG[executorType] || EXECUTOR_CONFIG[DEFAULT_EXECUTOR];
}

/**
 * Whitelist of allowed executor types. Used by the HTTP layer to
 * validate POST body input before jobs hit the queue.
 */
const VALID_EXECUTOR_TYPES = Object.keys(EXECUTOR_CONFIG);

function isValidExecutorType(executorType) {
  return VALID_EXECUTOR_TYPES.includes(executorType);
}

module.exports = {
  EXECUTOR_CONFIG,
  VALID_EXECUTOR_TYPES,
  getExecutorConfig,
  isValidExecutorType,
};

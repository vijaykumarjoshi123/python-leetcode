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
    // The worker's run argv. `file` is the absolute path to the mounted
    // source file inside the container.
    buildCmd: (file) => ['python3', file],
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
    buildCmd: (file) => ['bash', '/runner/spark_runner.sh', file],
    timeout: 60000,
    memoryMb: 1024,
    toolVersion: 'PySpark 3.5',
    useGpu: false,
  },
  dbt: {
    image: 'dbt-executor',
    buildCmd: (file) => ['bash', '/runner/dbt_runner.sh', file],
    timeout: 30000,
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
    buildCmd: (file) => ['bash', '/runner/kafka_runner.sh', file],
    timeout: 30000,
    memoryMb: 512,
    toolVersion: 'Kafka 3.7 (KRaft mode)',
    useGpu: false,
  },
  iceberg: {
    image: 'iceberg-executor',
    // The runner handles fixture setup, user script execution, and
    // comparison against /expected/. See Section 3F.
    buildCmd: (file) => ['python3', '/runner/iceberg_runner.py'],
    timeout: 30000,
    memoryMb: 512,
    toolVersion: 'PyIceberg 0.7 / DuckDB (Databricks-Iceberg)',
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

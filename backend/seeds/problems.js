// Sample problems to seed the database
// Run this with: node seeds/problems.js
//
// One problem per executorType from the master plan:
//   1. python   (foundations)         — Flatten nested JSON
//   2. sql      (foundations)         — Cohort retention query
//   3. pyspark  (data-engineering)    — Skewed join optimisation
//   4. dbt      (data-engineering)    — Incremental model with late-arriving data
//   5. airflow  (orchestration)       — Debug this broken DAG
//   6. kafka    (streaming)           — Exactly-once event deduplication
//   7. iceberg  (lakehouse)           — Schema evolution with partition pruning
//
// Every problem uses the schema added in Section 2:
//   executorType, track, starterCode (Map keyed by executorType),
//   evaluationScript notes, testCases (visible) + hiddenTestCases (>=2).

const PROBLEMS = [
  // ---------------------------------------------------------------
  // 1. Python — foundations
  // ---------------------------------------------------------------
  {
    title: 'Flatten nested JSON',
    slug: 'flatten-nested-json',
    description: `Given a nested Python dictionary \`d\` where string keys map to either primitives or other dictionaries, write a function \`flatten(d, prefix='')\` that returns a **flat** dictionary with dot-notation keys.

**Rules**
- Empty input \`{}\` returns \`{}\`.
- Nested keys are joined with a single \`.\` between parent and child.
- Lists, tuples, and other iterables are NOT recursed into — treat them as primitives and store under their parent key as-is.
- Keys are strings. You may assume all keys are valid Python identifiers (no escaping needed).

**Examples**
\`\`\`python
flatten({'a': {'b': 1}})
# => {'a.b': 1}

flatten({'a': {'b': {'c': 2}}, 'd': 3})
# => {'a.b.c': 2, 'd': 3}

flatten({'user': {'profile': {'name': 'Ada'}, 'id': 7}})
# => {'user.profile.name': 'Ada', 'user.id': 7}
\`\`\``,
    difficulty: 'Easy',
    category: 'Dictionaries',
    executorType: 'python',
    track: 'foundations',
    examples: [
      {
        input: '{"a": {"b": 1}}',
        output: "{'a.b': 1}",
        explanation: 'One level of nesting collapses to a single dot-joined key.',
      },
      {
        input: '{"a": {"b": {"c": 2}}, "d": 3}',
        output: "{'a.b.c': 2, 'd': 3}",
        explanation: 'Recursive flattening; sibling keys remain siblings.',
      },
    ],
    constraints: '- Up to 5 levels of nesting\n- Up to 100 keys at any level\n- Values are int, str, float, bool, or nested dict',
    starterCode: {
      python: `def flatten(d, prefix=''):
    """
    Flatten a nested dict to dot-notation keys.
    Treat non-dict values (including lists) as primitives.
    """
    # YOUR CODE HERE
    pass
`,
    },
    evaluationScript:
      'The Python runner wraps the function in a JSON-printing harness. Each test case calls `flatten(input)` and compares the returned dict against the expected dict. Order of keys does not matter for comparison.',
    testCases: [
      // `visible: true` ones are shown to the user as examples.
      { input: "{'a': {'b': 1}}", output: "{'a.b': 1}", visible: true },
      { input: "{'a': {'b': {'c': 2}}, 'd': 3}", output: "{'a.b.c': 2, 'd': 3}", visible: true },
    ],
    hiddenTestCases: [
      { input: "{}", output: "{}", visible: false },
      { input: "{'a': 1, 'b': 2}", output: "{'a': 1, 'b': 2}", visible: false },
      { input: "{'user': {'profile': {'name': 'Ada'}, 'id': 7}}", output: "{'user.profile.name': 'Ada', 'user.id': 7}", visible: false },
      { input: "{'a': {'b': {'c': {'d': {'e': 5}}}}}", output: "{'a.b.c.d.e': 5}", visible: false },
      { input: "{'a': [1, 2, 3]}", output: "{'a': [1, 2, 3]}", visible: false },
    ],
    hints: [
      'Recursion is the natural fit: for each key, if the value is a dict, recurse with an extended prefix; otherwise emit the flattened key-value pair.',
      'Edge case: when the dict is empty, return immediately — recursion otherwise grows the prefix by `parent + "."`.',
    ],
    solution: {
      explanation:
        'A recursive walk. For each (key, value) in the dict, if value is itself a dict and non-empty, recurse with `prefix + key + "."`. If value is a dict but empty, emit the parent key with an empty dict. Otherwise, emit the leaf as-is. Lists/tuples are treated as primitives per the problem rules.',
      code: `def flatten(d, prefix=''):
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}" if prefix == '' else f"{prefix}.{k}"
        if isinstance(v, dict) and v:
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out
`,
      complexity: { time: 'O(n) where n is the total number of leaf values', space: 'O(n) for the output dict' },
    },
    tags: ['Python', 'Recursion', 'Dictionary'],
    submissions: 0,
    accepted: 0,
    acceptanceRate: 0,
  },

  // ---------------------------------------------------------------
  // 2. SQL — foundations
  // ---------------------------------------------------------------
  {
    title: 'Cohort retention query',
    slug: 'cohort-retention-query',
    description: `You are given a single table:

**\`user_events(user_id INT, event_date DATE, event_type VARCHAR)\`**

The first time we see a \`signup\` event for a user is their **cohort**. Retention is measured by whether the user has **any event** (any \`event_type\`) within 7 and 30 days after the cohort date.

Write a single SQL query that returns one row per cohort week with these exact columns:

| column | type | meaning |
|---|---|---|
| \`cohort_week\` | DATE | Monday of the cohort week (the signup week). Use \`DATE_TRUNC('week', ...)\`. |
| \`total_users\` | INT | Number of distinct users whose first \`signup\` falls in this cohort week. |
| \`retained_7d\` | INT | Of \`total_users\`, how many have any event within 7 days (inclusive) of their \`event_date\`. |
| \`retained_30d\` | INT | Of \`total_users\`, how many have any event within 30 days (inclusive) of their \`event_date\`. |
| \`retention_7d_pct\` | DOUBLE | \`retained_7d / total_users * 100\`, rounded to 2 decimals. |
| \`retention_30d_pct\` | DOUBLE | \`retained_30d / total_users * 100\`, rounded to 2 decimals. |

**Output ordering:** Rows sorted by \`cohort_week\` ascending.

**Notes**
- Use **CTEs** (\`WITH\`) — readability is graded.
- The expected output table is provided to the runner as \`/expected/expected.parquet\` with the same column order.
- DuckDB-compatible SQL (Snowflake-style syntax works).`,
    difficulty: 'Medium',
    category: 'Window Functions',
    executorType: 'sql',
    track: 'foundations',
    examples: [
      {
        input: 'user_events = [(1, 2024-01-01, signup), (1, 2024-01-05, login), (2, 2024-01-02, signup), (2, 2024-02-15, login)]',
        output: '(2024-01-01, 2, 1, 2, 50.00, 100.00)',
        explanation: 'Both users signed up the same week. User 1 has a login within 7 days. User 2 has a login within 30 days.',
      },
    ],
    constraints:
      '- Up to 10M rows in `user_events`\n- `event_date` ranges over 5 years\n- `event_type` is one of: signup, login, view, click, purchase',
    starterCode: {
      sql: `-- Write a DuckDB-compatible query that returns:
--   cohort_week, total_users, retained_7d, retained_30d, retention_7d_pct, retention_30d_pct
--
-- Table:
--   user_events(user_id INT, event_date DATE, event_type VARCHAR)

WITH first_signup AS (
    -- YOUR CODE HERE: find each user's first signup date
),
cohorts AS (
    -- YOUR CODE HERE: collapse first_signup to weekly cohorts
),
retention AS (
    -- YOUR CODE HERE: for each cohort, count how many users have any event
    -- within 7 and 30 days of their signup
)
SELECT
    cohort_week,
    total_users,
    retained_7d,
    retained_30d,
    ROUND(retained_7d * 100.0 / total_users, 2) AS retention_7d_pct,
    ROUND(retained_30d * 100.0 / total_users, 2) AS retention_30d_pct
FROM retention
ORDER BY cohort_week ASC;
`,
    },
    evaluationScript:
      'The runner mounts /fixtures/user_events.parquet and registers it as the `user_events` view. The expected output is /expected/expected.parquet with the same column order. The runner uses pandas.testing.assert_frame_equal(..., check_dtype=False) — column order matters, but dtype coercion (e.g. INT vs BIGINT) is allowed. ROW ORDER matters (sorted by cohort_week ASC).',
    testCases: [
      // For SQL problems, the runner uses hidden fixtures rather than the
      // small testCases below. We keep one visible example for documentation.
      {
        input: 'user_events rows from /fixtures/user_events.parquet',
        output: 'See /expected/expected.parquet',
        visible: true,
      },
    ],
    hiddenTestCases: [
      {
        input: 'Fixture A: 1000 users, 5 cohorts, 30 days of activity',
        output: 'See fixture A expected table',
        visible: false,
      },
      {
        input: 'Fixture B: 100 users in a single cohort week, sparse activity (tests retained_7d < total_users)',
        output: 'See fixture B expected table',
        visible: false,
      },
    ],
    hints: [
      'First, derive each user\'s first signup date: `MIN(event_date) FILTER (WHERE event_type = \'signup\')` grouped by user_id.',
      'To get a retention flag, JOIN the cohort back to user_events with a date-range predicate and check existence: `EXISTS (SELECT 1 FROM user_events e WHERE e.user_id = c.user_id AND e.event_date BETWEEN c.signup_date AND c.signup_date + INTERVAL 7 DAY)`.',
      'Window for the cohort week: `DATE_TRUNC(\'week\', signup_date)` — DuckDB returns the Monday of that week.',
    ],
    solution: {
      explanation:
        'Two CTEs. `first_signup` reduces events to one row per user with their earliest signup date. `cohorts` aggregates to weekly cohort counts. `retention` joins the cohort table back to all events with a BETWEEN predicate to count users who had any event within 7 and 30 days. Final SELECT rounds the percentages.',
      code: `WITH first_signup AS (
    SELECT user_id, MIN(event_date) AS signup_date
    FROM user_events
    WHERE event_type = 'signup'
    GROUP BY user_id
),
cohorts AS (
    SELECT
        DATE_TRUNC('week', signup_date) AS cohort_week,
        COUNT(DISTINCT user_id)        AS total_users
    FROM first_signup
    GROUP BY 1
),
retention AS (
    SELECT
        c.cohort_week,
        c.total_users,
        COUNT(DISTINCT CASE
            WHEN e.event_date BETWEEN c2.signup_date AND c2.signup_date + INTERVAL 7 DAY
            THEN c2.user_id
        END) AS retained_7d,
        COUNT(DISTINCT CASE
            WHEN e.event_date BETWEEN c2.signup_date AND c2.signup_date + INTERVAL 30 DAY
            THEN c2.user_id
        END) AS retained_30d
    FROM cohorts c
    JOIN first_signup c2
      ON DATE_TRUNC('week', c2.signup_date) = c.cohort_week
    LEFT JOIN user_events e
      ON e.user_id = c2.user_id
    GROUP BY c.cohort_week, c.total_users
)
SELECT
    cohort_week,
    total_users,
    retained_7d,
    retained_30d,
    ROUND(retained_7d * 100.0 / total_users, 2) AS retention_7d_pct,
    ROUND(retained_30d * 100.0 / total_users, 2) AS retention_30d_pct
FROM retention
ORDER BY cohort_week ASC;
`,
      complexity: { time: 'O(N log N) — the self-join is the dominating cost', space: 'O(N) for the cohort table' },
    },
    tags: ['SQL', 'CTEs', 'Window Functions', 'Retention'],
    submissions: 0,
    accepted: 0,
    acceptanceRate: 0,
  },

  // ---------------------------------------------------------------
  // 3. PySpark — data-engineering
  // ---------------------------------------------------------------
  {
    title: 'Skewed join optimisation',
    slug: 'skewed-join-optimisation',
    description: `You are given two DataFrames:

**\`orders\`** — 500M rows, columns \`(order_id, customer_id, order_date, amount)\`. The \`customer_id\` distribution is **highly skewed**: 1% of customers account for ~80% of orders.

**\`customers\`** — 1M rows, columns \`(customer_id, name, country, signup_date)\`. Uniform-ish distribution.

**The problem**
A naive \`orders.join(customers, "customer_id")\` triggers the well-known **data skew** failure mode: one or a few executors receive a hugely disproportionate partition of the shuffle, OOM, fail, retry, fail again. The default \`spark.sql.autoBroadcastJoinThreshold\` (10MB) is below the size of \`customers\` (50MB) so Spark does a shuffle hash join, exposing the skew.

**Your task**
Write code that:
1. Joins \`orders\` and \`customers\` on \`customer_id\` correctly (no row loss or duplication).
2. Avoids OOM on the skewed keys.
3. Completes within the 60s sandbox timeout.
4. Writes the joined DataFrame to \`/tmp/output/joined_orders.parquet\` with the **same schema** as a straightforward join would produce:
   \`(order_id, customer_id, order_date, amount, name, country, signup_date)\`

**Hint shapes** (pick one)
- **Broadcast join** — replicate the small side (customers) to every executor, then shuffle hash join only the large side. Eliminates the skew at the cost of broadcasting 50MB.
- **Salting** — append a salt suffix to the skewed key on both sides, join on the salted key, then drop the salt. Avoids broadcasting and works at any scale, but the join key changes and the result needs to be de-salted.`,
    difficulty: 'Hard',
    category: 'DataFrames',
    executorType: 'pyspark',
    track: 'data-engineering',
    examples: [
      {
        input: 'orders: 500M rows, skewed 80/20 on customer_id. customers: 1M rows.',
        output: '/tmp/output/joined_orders.parquet with 500M rows + 3 customer columns',
        explanation: 'A correct join preserves the 500M-row count and adds name/country/signup_date from the customers side.',
      },
    ],
    constraints:
      '- Memory: 1GB for the driver\n- Cores: local[2]\n- Timeout: 60s (PySpark startup is ~8-15s — your actual job has ~45s)\n- Both fixtures are mounted as parquet at /fixtures/orders.parquet and /fixtures/customers.parquet',
    starterCode: {
      pyspark: `"""
Skewed join — produce /tmp/output/joined_orders.parquet.

Approaches to consider:
  - Broadcast the small side (customers) and let Spark do a broadcast hash join.
  - Salt the skewed key and join on (customer_id, salt) then drop the salt.

Either is acceptable as long as:
  - Row count is preserved (500M rows for the default fixture).
  - The result has columns: order_id, customer_id, order_date, amount, name, country, signup_date.
  - The job completes within 60s.

Spark is already initialised for you (the runner invokes this file via spark-submit,
which sets up a SparkSession you can get with SparkSession.builder.getOrCreate()).
"""
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

spark = SparkSession.builder.getOrCreate()

orders = spark.read.parquet('/fixtures/orders.parquet')
customers = spark.read.parquet('/fixtures/customers.parquet')

# YOUR CODE HERE
# joined = ...

joined.write.mode('overwrite').parquet('/tmp/output/joined_orders.parquet')
`,
    },
    evaluationScript:
      'The runner mounts /fixtures/orders.parquet and /fixtures/customers.parquet. The user must write the joined DataFrame to /tmp/output/joined_orders.parquet. The runner compares every parquet file in /expected/ against the same-named file in /tmp/output/ using DuckDB to sort both files and assert_frame_equal on the row contents. ROW ORDER matters (both sides are sorted before comparison). Schemas must match exactly. A solution that times out fails with `error: spark-submit failed (exit=...)`.',
    testCases: [
      {
        input: 'orders=500M rows (skewed 80/20), customers=1M rows',
        output: '/tmp/output/joined_orders.parquet with 500M rows, 7 columns',
        visible: true,
      },
    ],
    hiddenTestCases: [
      {
        input: 'Fixture A: high skew (1% of customers = 80% of orders), 500M rows',
        output: 'See fixture A expected joined_orders.parquet',
        visible: false,
      },
      {
        input: 'Fixture B: milder skew (10% of customers = 50% of orders), 100M rows',
        output: 'See fixture B expected joined_orders.parquet',
        visible: false,
      },
    ],
    hints: [
      'The default fixture has customers at 50MB — above `spark.sql.autoBroadcastJoinThreshold` (10MB). Hint: broadcast it manually with `F.broadcast(customers)`.',
      'If you choose salting, append `F.rand() * N` (where N is the salt bucket count, e.g. 10) as a `salt` column to BOTH sides, join on `(customer_id, salt)`, then drop `salt`. Beware of cartesian blowup if N is too small or too large.',
      'Use `joined.explain()` to confirm the broadcast hint is taking effect — `BroadcastHashJoin` should appear in the plan, not `SortMergeJoin`.',
    ],
    solution: {
      explanation:
        'A broadcast join is the right choice when the smaller side fits comfortably in driver memory and cluster RAM. Here customers is 50MB, well under typical broadcast thresholds (8GB default in newer Spark). `F.broadcast(customers)` annotates the small side, Spark skips the shuffle, and the skew vanishes because the hot keys are no longer driving a shuffle partition. Salting is the alternative if the small side is too large to broadcast.',
      code: `from pyspark.sql import SparkSession
from pyspark.sql import functions as F

spark = SparkSession.builder.getOrCreate()
spark.conf.set('spark.sql.autoBroadcastJoinThreshold', -1)  # force explicit broadcast

orders = spark.read.parquet('/fixtures/orders.parquet')
customers = spark.read.parquet('/fixtures/customers.parquet')

# Broadcast the small side — eliminates shuffle, so skew on customer_id
# doesn't cause one executor to OOM.
joined = orders.join(
    F.broadcast(customers),
    on='customer_id',
    how='inner',
)

joined.write.mode('overwrite').parquet('/tmp/output/joined_orders.parquet')
`,
      complexity: {
        time: 'O(N) — one shuffle avoided, broadcast replaces the SortMergeJoin',
        space: 'O(N) for the joined output + O(M) for the broadcast copy of customers',
      },
    },
    tags: ['PySpark', 'DataFrames', 'Skew', 'Broadcast Join'],
    submissions: 0,
    accepted: 0,
    acceptanceRate: 0,
  },

  // ---------------------------------------------------------------
  // 4. dbt — data-engineering
  // ---------------------------------------------------------------
  {
    title: 'Incremental model with late-arriving data',
    slug: 'incremental-model-late-arriving-data',
    description: `Write a dbt **incremental model** called \`fct_daily_revenue.sql\` that:

1. Aggregates the \`orders\` seed into one row per \`(date, product_id)\` pair, summing \`amount\` as \`revenue\`.
2. Handles **late-arriving records**: an order's \`updated_at\` may be up to 3 days after its \`event_date\`, and an incremental run must include those late rows.
3. Uses \`unique_key\` correctly so re-running the incremental does not duplicate rows.
4. Uses \`is_incremental()\` to guard the source filter so that the first run materialises everything and subsequent runs only process the trailing window.
5. Includes a dbt test asserting **no duplicate \`(date, product_id)\` combinations**.

**Input schema (from the seed)**

| column | type |
|---|---|
| \`order_id\` | BIGINT |
| \`product_id\` | INT |
| \`event_date\` | DATE |
| \`updated_at\` | TIMESTAMP |
| \`amount\` | DOUBLE |

**Output schema (your model)**

| column | type |
|---|---|
| \`date\` | DATE |
| \`product_id\` | INT |
| \`revenue\` | DOUBLE |

**Important**
- The seed \`orders\` is loaded by \`dbt seed\` at the start of every run.
- The runner compares the resulting table (\`dev.main.fct_daily_revenue\`) against \`/expected/expected.parquet\` after \`dbt run\` completes.`,
    difficulty: 'Medium',
    category: 'Incremental Models',
    executorType: 'dbt',
    track: 'data-engineering',
    examples: [
      {
        input: 'orders rows from /project/seeds/orders.csv',
        output: 'dev.main.fct_daily_revenue: (date, product_id, revenue) — one row per (date, product_id)',
        explanation: 'Aggregation collapses many orders per day to one row per day+product.',
      },
    ],
    constraints:
      '- Incremental strategy: `merge`\n- Materialisation: `incremental`\n- Late-arrival window: 3 days (event_date - 3 <= updated_at::DATE)\n- A uniqueness test on (date, product_id) is mandatory',
    starterCode: {
      dbt: `{{ config(
    materialized='incremental',
    unique_key=['date', 'product_id']
) }}

-- Step 1: filter to the incremental window when re-running.
-- On the first run, is_incremental() is false and you should process ALL rows.
-- On subsequent runs, only process rows whose updated_at is recent enough to
-- capture late-arriving records (an event can be updated up to 3 days after
-- the event_date).
WITH source AS (
    SELECT * FROM {{ source('raw', 'orders') }}
    {% if is_incremental() %}
        WHERE updated_at >= (
            SELECT COALESCE(MAX(updated_at), '1900-01-01') FROM {{ this }}
        ) - INTERVAL '3 days'
    {% endif %}
),

-- Step 2: aggregate to (date, product_id) -> revenue.
-- YOUR CODE HERE

SELECT date, product_id, revenue FROM aggregated
`,
    },
    evaluationScript:
      'The runner copies the user file to /project/models/staging/solution.sql but the model is referenced by the dbt project as `solution` regardless of filename (dbt selects `--select solution`). The runner runs `dbt seed && dbt run --select solution && dbt test --select solution`. After dbt run, the runner compares dev.duckdb.main.staging.solution against /expected/expected.parquet using DuckDB row-sorted assertion. dbt test must also pass — if the user forgot the uniqueness test, dbt test will fail and the result will be passed=false.',
    testCases: [
      {
        input: 'orders seed at /project/seeds/orders.csv (~1000 rows, with late-arriving records)',
        output: 'dev.main.staging.solution with (date, product_id, revenue), no duplicate (date, product_id)',
        visible: true,
      },
    ],
    hiddenTestCases: [
      {
        input: 'Fixture A: orders with a few late-arriving rows (updated_at 1-3 days after event_date)',
        output: 'See fixture A expected table',
        visible: false,
      },
      {
        input: 'Fixture B: orders that produce duplicate (date, product_id) when grouped naively — tests uniqueness test enforcement',
        output: 'See fixture B expected table',
        visible: false,
      },
    ],
    hints: [
      'Inside `is_incremental()`, compare `updated_at` to the MAX of `updated_at` already in `{{ this }}`, minus a 3-day window so you catch late-arriving rows.',
      'Use `MERGE INTO` strategy (the default for dbt-duckdb) so the unique_key list `(date, product_id)` collapses duplicate rows instead of appending them.',
      'Add a schema.yml alongside your model with `tests: - unique` on `composite_primary_key` of (date, product_id) so `dbt test` enforces the requirement automatically.',
    ],
    solution: {
      explanation:
        'Two parts: the SQL model and the test declaration. The model uses `is_incremental()` to filter to the trailing 3-day window on `updated_at`, then aggregates to one row per `(date, product_id)`. `unique_key=[date, product_id]` plus dbt-duckdb\'s default `merge` strategy handles deduplication on re-runs. The accompanying `schema.yml` adds a composite uniqueness test that `dbt test --select solution` enforces.',
      code: `{{ config(
    materialized='incremental',
    unique_key=['date', 'product_id']
) }}

WITH source AS (
    SELECT * FROM {{ source('raw', 'orders') }}
    {% if is_incremental() %}
        WHERE updated_at >= (
            SELECT COALESCE(MAX(updated_at), '1900-01-01') FROM {{ this }}
        ) - INTERVAL '3 days'
    {% endif %}
),
aggregated AS (
    SELECT
        event_date AS date,
        product_id,
        SUM(amount) AS revenue
    FROM source
    GROUP BY 1, 2
)
SELECT date, product_id, revenue FROM aggregated
`,
      complexity: { time: 'O(N) on first run; O(window) on subsequent incremental runs', space: 'O(K) where K is the number of distinct (date, product_id) keys' },
    },
    tags: ['dbt', 'Incremental', 'Late-Arriving Data', 'Tests'],
    submissions: 0,
    accepted: 0,
    acceptanceRate: 0,
  },

  // ---------------------------------------------------------------
  // 5. Airflow — orchestration
  // ---------------------------------------------------------------
  {
    title: 'Debug this broken DAG',
    slug: 'debug-this-broken-dag',
    description: `You are given a (deliberately broken) Airflow DAG file below. It has **three bugs** that prevent it from running successfully. Find them all and submit the corrected file.

**Bug 1 — circular dependency**
Two tasks form a cycle (task_a >> task_b AND task_b >> task_a). The DAG cannot be topologically sorted, so it never executes.

**Bug 2 — \`provide_context\` on a PythonOperator**
A PythonOperator is constructed with provide_context=True. This kwarg was a no-op in Airflow 1.x and was **removed** in Airflow 2.x. The sandbox runs Airflow 2.9, so the kwarg is dead code that hides the real intent (python_callable always receives context in 2.x). Remove it.

**Bug 3 — XCom key mismatch**
A task \`compute_x\` pushes an XCom with key \`'value'\`, but a downstream task \`consume_x\` reads it via \`ti.xcom_pull(key='result')\`. The keys don't match, so the consumer receives \`None\` and any downstream logic that uses the value breaks. Either rename the push key or the pull key so they agree.

**Pass criteria**
The runner will:
1. Import your file and find a \`DAG\` object.
2. Verify the DAG has no cycles (\`topological_sort()\` succeeds).
3. Verify no task uses the stale \`provide_context\` kwarg.
4. Execute every \`PythonOperator\` task with a mock context. The XCom bug must not raise — your fix should either rename the push/pull key OR have the consuming task tolerate a \`None\` value.`,
    difficulty: 'Medium',
    category: 'DAG Authoring',
    executorType: 'airflow',
    track: 'orchestration',
    examples: [
      {
        input: 'See starterCode — a 3-task DAG with extract → compute_x → consume_x',
        output: 'Same DAG shape, no cycles, no provide_context, matching XCom key',
        explanation: 'The corrected DAG must still define the three tasks and their dependencies.',
      },
    ],
    constraints:
      '- Airflow 2.9 in the sandbox\n- Runner mocks ti with `None` and pre-seeds `xcom_push`/`xcom_pull` to a no-op dict — you must use consistent keys WITHOUT relying on real XCom storage\n- Task order: extract must run before compute_x, which must run before consume_x',
    starterCode: {
      airflow: `"""
BROKEN Airflow DAG. Find and fix the 3 bugs described in the problem.

Bug 1: circular dependency between task_a and task_b.
Bug 2: provide_context=True on a PythonOperator (Airflow 1.x leftover).
Bug 3: XCom push key ('value') doesn't match pull key ('result').
"""
from datetime import datetime
from airflow import DAG
from airflow.operators.python import PythonOperator

def extract(**context):
    # Pretend to extract data.
    return {'rows': 100}

def compute_x(**context):
    # Pushes XCom with the wrong key.
    return context['ti'].xcom_push(key='value', value=42)

def consume_x(**context):
    # Reads XCom with the wrong key.
    val = context['ti'].xcom_pull(key='result')
    if val is None:
        raise ValueError('XCom pull returned None — keys do not match')
    return val

with DAG(
    dag_id='debug_dag',
    start_date=datetime(2024, 1, 1),
    schedule_interval='@daily',
    catchup=False,
) as dag:
    task_a = PythonOperator(task_id='task_a', python_callable=extract)
    task_b = PythonOperator(task_id='task_b', python_callable=compute_x, provide_context=True)
    task_c = PythonOperator(task_id='task_c', python_callable=consume_x)

    task_a >> task_b >> task_c
    task_b >> task_a  # <-- cycle
`,
    },
    evaluationScript:
      'The runner imports the user file and locates the DAG object. It then runs (1) structural validation (no cycles, no orphans, anti-pattern checks including provide_context detection), (2) PythonOperator task execution with a mock context where `ti.xcom_push` is a no-op and `ti.xcom_pull` reads from a small in-memory dict pre-seeded by earlier tasks in topological order. The XCom bug surfaces as either a `None` value or a raised exception inside consume_x. Pass criteria: structural validation returns [] AND all PythonOperator tasks complete without raising.',
    testCases: [
      {
        input: 'DAG with three tasks: extract, compute_x, consume_x',
        output: 'Same three tasks, no cycles, no provide_context, XCom keys aligned',
        visible: true,
      },
    ],
    hiddenTestCases: [
      {
        input: 'Fixture A: the buggy DAG exactly as shown in starterCode',
        output: 'must fail: cycle + provide_context + XCom key mismatch',
        visible: false,
      },
      {
        input: 'Fixture B: a different DAG with only the XCom key bug (cycle and provide_context already fixed)',
        output: 'must fail: XCom mismatch',
        visible: false,
      },
    ],
    hints: [
      'Bug 1: remove the `task_b >> task_a` line. The intended linear order is extract → compute_x → consume_x.',
      'Bug 2: `provide_context` is no longer a valid kwarg on `PythonOperator` in Airflow 2.x — remove it entirely. The callable always receives `**context`.',
      'Bug 3: pick one key — `value` or `result` — and use it in BOTH the push and the pull.',
    ],
    solution: {
      explanation:
        'Three surgical edits. (1) Drop the `task_b >> task_a` cycle line — the linear order already declared via `task_a >> task_b >> task_c` is what the DAG should have. (2) Remove `provide_context=True` from the `task_b` operator — Airflow 2.x passes context automatically. (3) Pick one XCom key (the convention is usually the task_id or "value") and use it in BOTH the push in `compute_x` and the pull in `consume_x`.',
      code: `from datetime import datetime
from airflow import DAG
from airflow.operators.python import PythonOperator

def extract(**context):
    return {'rows': 100}

def compute_x(**context):
    # Push XCom with the key the consumer will pull.
    context['ti'].xcom_push(key='value', value=42)
    return 42

def consume_x(**context):
    val = context['ti'].xcom_pull(key='value')
    if val is None:
        raise ValueError('XCom pull returned None')
    return val

with DAG(
    dag_id='debug_dag',
    start_date=datetime(2024, 1, 1),
    schedule_interval='@daily',
    catchup=False,
) as dag:
    task_a = PythonOperator(task_id='task_a', python_callable=extract)
    task_b = PythonOperator(task_id='task_b', python_callable=compute_x)
    task_c = PythonOperator(task_id='task_c', python_callable=consume_x)

    task_a >> task_b >> task_c
`,
      complexity: { time: 'O(1) per task execution', space: 'O(1)' },
    },
    tags: ['Airflow', 'DAG', 'Debugging', 'XCom'],
    submissions: 0,
    accepted: 0,
    acceptanceRate: 0,
  },

  // ---------------------------------------------------------------
  // 6. Kafka — streaming
  // ---------------------------------------------------------------
  {
    title: 'Exactly-once event deduplication',
    slug: 'exactly-once-event-deduplication',
    description: `You are given a Kafka topic \`raw_clickstream\` containing ~1000 messages with **duplicates** (at-least-once delivery semantics from upstream). Each message is JSON with a unique \`event_id\` field but the same logical event may appear 2-3 times.

Write a Python script that:

1. Connects to the broker at \`KAFKA_BOOTSTRAP_SERVERS\` (an env var the runner sets for you).
2. Consumes from \`raw_clickstream\`.
3. Deduplicates by \`event_id\` using a **DuckDB in-memory store** as the dedup ledger.
4. Produces each unique event (once) to \`clean_clickstream\`.
5. Writes the **complete set of unique events** to \`/tmp/output.json\` as a JSON array, sorted by \`event_id\`.

**Why DuckDB for dedup?**
The spec calls out DuckDB specifically — it's in-process, supports UPSERT semantics, and the dedup ledger becomes a single SQL table. Real production code would use Redis or a stateful processor; in this sandbox, DuckDB is the canonical choice.

**Why exactly-once?**
The naive consumer (process every message) would emit duplicates to \`clean_clickstream\`. The grader verifies that \`clean_clickstream\` contains **exactly** the unique events and that the count matches the expected output.

**Constraints**
- You may use \`kafka-python\` (the runner has it installed).
- The dedup table should be \`CREATE TABLE seen(event_id VARCHAR PRIMARY KEY, first_seen_ts TIMESTAMP)\`.
- Use INSERT...ON CONFLICT to make the dedup atomic.
- The script must \`producer.flush()\` before exiting so all messages reach the broker before the runner reads \`/tmp/output.json\`.`,
    difficulty: 'Hard',
    category: 'Stream Processing',
    executorType: 'kafka',
    track: 'streaming',
    examples: [
      {
        input: 'raw_clickstream: 1000 messages, ~300 unique event_ids (each duplicated 2-3 times)',
        output: '/tmp/output.json: ~300 events, sorted by event_id',
        explanation: 'After dedup, the output is the unique-event set.',
      },
    ],
    constraints:
      '- Kafka 3.7 in KRaft mode (single broker, 1 partition per topic)\n- Timeout: 30s\n- The runner mounts /fixtures/topics.json and /fixtures/seed_messages.json and starts Kafka before running your script\n- The runner compares /tmp/output.json against /expected/expected_messages.json',
    starterCode: {
      kafka: `"""
Exactly-once event deduplication.

Read from 'raw_clickstream', dedup by 'event_id' using DuckDB, produce
unique events to 'clean_clickstream', and write the unique-event set to
/tmp/output.json for the grader.
"""
import json
import os
import sys

import duckdb
from kafka import KafkaConsumer, KafkaProducer

bootstrap = os.environ["KAFKA_BOOTSTRAP_SERVERS"]

# 1. Set up DuckDB dedup ledger.
con = duckdb.connect(":memory:")
con.execute("""
    CREATE TABLE seen (
        event_id VARCHAR PRIMARY KEY,
        first_seen_ts TIMESTAMP
    )
""")

# 2. Consume from raw_clickstream.
consumer = KafkaConsumer(
    "raw_clickstream",
    bootstrap_servers=bootstrap,
    auto_offset_reset="earliest",
    enable_auto_commit=True,
    group_id="dedup-runner",
    consumer_timeout_ms=5000,
)

# 3. Producer for clean_clickstream.
producer = KafkaProducer(
    bootstrap_servers=bootstrap,
    value_serializer=lambda v: json.dumps(v).encode("utf-8"),
)

unique_events = {}

# YOUR CODE HERE: loop over consumer, dedup with DuckDB, produce to clean_clickstream,
# and accumulate unique_events for the grader output file.

# Write the unique-event set to /tmp/output.json (sorted by event_id) so the
# grader can compare against /expected/expected_messages.json.
with open("/tmp/output.json", "w") as f:
    json.dump(sorted(unique_events.values(), key=lambda e: e["event_id"]), f)

producer.flush()
`,
    },
    evaluationScript:
      'The runner starts Kafka in KRaft mode on localhost:9092, polls until ready (max 60s), creates topics defined in /fixtures/topics.json, seeds messages from /fixtures/seed_messages.json into raw_clickstream, then runs the user script with KAFKA_BOOTSTRAP_SERVERS=localhost:9092 in env. After the user script exits, the runner compares /tmp/output.json against /expected/expected_messages.json — both must be JSON arrays; comparison sorts both lists by JSON-serialised event_id and checks equality. ROW ORDER in the output file does not matter (the comparison sorts before checking).',
    testCases: [
      {
        input: 'raw_clickstream: 1000 messages, ~300 unique event_ids (each duplicated 2-3 times)',
        output: '/tmp/output.json: exactly the unique event set, sorted by event_id',
        visible: true,
      },
    ],
    hiddenTestCases: [
      {
        input: 'Fixture A: 1000 messages, 300 unique (3-4x dup rate)',
        output: 'See fixture A expected messages',
        visible: false,
      },
      {
        input: 'Fixture B: 100 messages, 50 unique (2x dup rate)',
        output: 'See fixture B expected messages',
        visible: false,
      },
    ],
    hints: [
      'Pattern: `INSERT INTO seen (event_id, first_seen_ts) VALUES (?, now()) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`. If RETURNING yields a row, this event is new — produce it. If not, it was already seen — skip.',
      'For each consumed message, parse JSON, extract event_id, attempt the INSERT, and only produce if the INSERT succeeded.',
      'Always call `producer.flush()` before writing /tmp/output.json — otherwise the grader may read the file before all messages reach the broker.',
    ],
    solution: {
      explanation:
        'The INSERT...ON CONFLICT pattern gives us atomic dedup in a single SQL statement. We loop over consumed messages, attempt the INSERT, and the RETURNING clause tells us whether this is a new event. If new, we produce to clean_clickstream AND record it in the local unique_events dict for the grader output file. After the loop, we sort by event_id and write to /tmp/output.json.',
      code: `import json
import os
import duckdb
from kafka import KafkaConsumer, KafkaProducer

bootstrap = os.environ["KAFKA_BOOTSTRAP_SERVERS"]

con = duckdb.connect(":memory:")
con.execute("""
    CREATE TABLE seen (
        event_id VARCHAR PRIMARY KEY,
        first_seen_ts TIMESTAMP
    )
""")

consumer = KafkaConsumer(
    "raw_clickstream",
    bootstrap_servers=bootstrap,
    auto_offset_reset="earliest",
    enable_auto_commit=True,
    group_id="dedup-runner",
    consumer_timeout_ms=5000,
)

producer = KafkaProducer(
    bootstrap_servers=bootstrap,
    value_serializer=lambda v: json.dumps(v).encode("utf-8"),
)

unique_events = {}
for msg in consumer:
    payload = json.loads(msg.value)
    eid = payload["event_id"]
    inserted = con.execute(
        "INSERT INTO seen (event_id, first_seen_ts) VALUES (?, now()) "
        "ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
        [eid],
    ).fetchone()
    if inserted:
        producer.send("clean_clickstream", payload)
        unique_events[eid] = payload

with open("/tmp/output.json", "w") as f:
    json.dump(sorted(unique_events.values(), key=lambda e: e["event_id"]), f)

producer.flush()
`,
      complexity: { time: 'O(N) where N is the number of raw messages; the dedup insert is O(log K) on the DuckDB primary key', space: 'O(K) where K is the number of unique events' },
    },
    tags: ['Kafka', 'Streaming', 'Exactly-Once', 'Dedup'],
    submissions: 0,
    accepted: 0,
    acceptanceRate: 0,
  },

  // ---------------------------------------------------------------
  // 7. Iceberg / PyIceberg — lakehouse
  // ---------------------------------------------------------------
  {
    title: 'Schema evolution with partition pruning',
    slug: 'schema-evolution-partition-pruning',
    description: `You are given a PyIceberg table 'events' partitioned by '(year, month)'. The fixture contains events across multiple partitions, e.g. 'year=2024, month=03' and 'year=2024, month=04'.

Write a Python script that performs **three** operations, in order:

**Step 1 — Schema evolution**
Add a new nullable column 'session_id' (VARCHAR) to 'events'. PyIceberg's 'update_schema().add_column(...).commit()' is the canonical API.

**Step 2 — Partition pruning**
Run a query that scans **only** the 'year=2024, month=03' partition — verify by inspecting 'table.scan(...).metrics()' after the read (the 'skipped_data_files' or 'skipped_manifests' counter should be > 0).

**Step 3 — Time travel**
Read the 'events' table **as it was before Step 1** — i.e., at the snapshot ID that existed before the schema change. The PyIceberg API supports this via 'table.scan(snapshot_id=...)' or 'table.current_snapshot()' minus one. Write the time-travelled result to 'default.solution' (this is what the grader compares).

**Constraints**
- PyIceberg API only — no Spark, no DuckDB write paths.
- The runner initialises a SQLite-backed Iceberg catalog at '/tmp/warehouse'. You access it via the injected 'catalog' variable in the user module.
- The grader compares 'default.solution' against '/expected/expected.parquet'.`,
    difficulty: 'Hard',
    category: 'Lakehouse',
    executorType: 'iceberg',
    track: 'lakehouse',
    examples: [
      {
        input: 'events table partitioned by (year=2024, month=03) and (year=2024, month=04)',
        output: 'default.solution: pre-schema-change rows for (year=2024, month=03)',
        explanation: 'Time-travel read pulls the snapshot from before Step 1, restricted to one partition via pruning.',
      },
    ],
    constraints:
      '- PyIceberg 0.7 + DuckDB 0.10\n- Catalog: SQLite-backed at /tmp/warehouse\n- Fixture mounts /fixtures/schema.json declaring the events table\n- The runner wipes /tmp/warehouse before each attempt',
    starterCode: {
      iceberg: `"""
Schema evolution + partition pruning + time travel.

The runner gives you 'catalog' and 'warehouse' via module injection.
Fixtures mount /fixtures/schema.json and /fixtures/events.parquet so the
events table is pre-loaded.
"""
from pyiceberg.expressions import EqualTo, And

# The runner has already loaded the events fixture for you.
events = catalog.load_table("default.events")

# Capture the snapshot id BEFORE any schema change so we can time-travel.
pre_change_snapshot_id = events.current_snapshot().snapshot_id

# --- Step 1: schema evolution ---
# Add a nullable VARCHAR column 'session_id'.
# YOUR CODE HERE

# --- Step 2: partition pruning ---
# Scan only year=2024, month=03. Verify via the metrics object.
# YOUR CODE HERE

# --- Step 3: time travel + write to default.solution ---
# Reload the table at pre_change_snapshot_id and write its contents to
# default.solution so the grader can compare.
# YOUR CODE HERE
`,
    },
    evaluationScript:
      "The runner wipes /tmp/warehouse, loads fixtures per /fixtures/schema.json (which declares the events table from /fixtures/events.parquet), injects 'catalog' and 'warehouse' into the user module, and execs it. After the user script exits, the runner reads 'default.solution' via the PyIceberg API and compares against /expected/expected.parquet using pd.testing.assert_frame_equal(check_dtype=False). ROW ORDER matters (the comparison does not sort — the user must write the result in the same order as expected).",
    testCases: [
      {
        input: 'events partitioned by (year, month), with rows in (2024,03) and (2024,04)',
        output: 'default.solution: pre-schema-change snapshot, scoped to (2024,03)',
        visible: true,
      },
    ],
    hiddenTestCases: [
      {
        input: 'Fixture A: 2 partitions (2024,03 and 2024,04), each with ~500 rows',
        output: 'See fixture A expected (2024,03 rows only, pre-schema-change)',
        visible: false,
      },
      {
        input: 'Fixture B: 4 partitions spanning 2 years, varied row counts',
        output: 'See fixture B expected (2024,03 rows only, pre-schema-change)',
        visible: false,
      },
    ],
    hints: [
      "For schema evolution: 'events = events.update_schema().add_column(\"session_id\", StringType(), required=False).commit()'. Note that 'commit()' returns the updated table object — reassign it.",
      "For partition pruning: 'events.scan(row_filter=And(EqualTo(\"year\", 2024), EqualTo(\"month\", 3))).to_pandas()'. Check 'events.scan(...).metrics()' — skipped_data_files or skipped_manifests should be > 0.",
      "For time travel: after capturing 'pre_change_snapshot_id = events.current_snapshot().snapshot_id' BEFORE Step 1, you can do 'catalog.load_table(\"default.events\").scan(snapshot_id=pre_change_snapshot_id).to_pandas()'. To write to 'default.solution', you may need to create the table first: 'catalog.create_table(\"default.solution\", schema=...)' then '.append(df)'.",
    ],
    solution: {
      explanation:
        "Capture the snapshot id at the very top — before any mutation — so Step 3 can read the pre-change state. Step 1 uses PyIceberg's fluent schema-evolution API ('.update_schema().add_column(...).commit()'). Step 2 demonstrates partition pruning by combining two 'EqualTo' predicates with 'And' and inspecting the scan metrics. Step 3 reloads the table at the captured snapshot_id and creates a new 'default.solution' table from the result.",
      code: `from pyiceberg.expressions import And, EqualTo
from pyiceberg.schema import Schema
from pyiceberg.types import IntegerType, LongType, NestedField, StringType

events = catalog.load_table("default.events")
pre_change_snapshot_id = events.current_snapshot().snapshot_id

# Step 1: schema evolution.
events = (
    events.update_schema()
    .add_column("session_id", StringType(), required=False)
    .commit()
)

# Step 2: partition pruning (verify via metrics).
pruned_scan = events.scan(
    row_filter=And(EqualTo("year", 2024), EqualTo("month", 3))
)
pruned_metrics = pruned_scan.metrics()
assert pruned_metrics.get("skipped_data_files", 0) > 0 or pruned_metrics.get("skipped_manifests", 0) > 0, (
    "partition pruning did not skip any files; check your filter"
)
pruned_df = pruned_scan.to_pandas()

# Step 3: time travel back to the pre-change snapshot, scoped to the same partition.
historical = catalog.load_table("default.events").scan(
    snapshot_id=pre_change_snapshot_id,
    row_filter=And(EqualTo("year", 2024), EqualTo("month", 3)),
).to_pandas()

# Write to default.solution for the grader.
solution_schema = Schema(
    NestedField(1, "event_id", LongType(), required=True),
    NestedField(2, "user_id", LongType(), required=False),
    NestedField(3, "event_ts", StringType(), required=False),
    NestedField(4, "year", IntegerType(), required=False),
    NestedField(5, "month", IntegerType(), required=False),
)
try:
    catalog.drop_table("default.solution")
except Exception:
    pass
catalog.create_table("default.solution", schema=solution_schema).append(historical)
`,
      complexity: { time: 'O(N) for the schema change and scan; partition pruning reduces the file I/O bound', space: 'O(N) for the solution table' },
    },
    tags: ['Iceberg', 'PyIceberg', 'Schema Evolution', 'Time Travel', 'Partition Pruning'],
    submissions: 0,
    accepted: 0,
    acceptanceRate: 0,
  },
];

module.exports = PROBLEMS;

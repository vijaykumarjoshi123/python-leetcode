/**
 * Pipeline seed problems — Tier 3 / Section 11F.
 *
 * One sample multi-tool pipeline problem: "Real-time clickstream
 * analytics". Topology follows the spec:
 *
 *     kafka (ingest) → pyspark (enrich) → iceberg (load) → dbt (report)
 *
 * Run with: node seeds/pipeline_problems.js
 *
 * This file is intentionally pure data — same convention as
 * seeds/problems.js and seeds/pipeline_scenarios.js. The runner
 * (seed_pipeline_problems.js or 11F's seeding step) imports it,
 * resolves fixture paths against the host filesystem, and inserts
 * the PipelineProblem documents.
 *
 * Fixture data lives at docker/pipeline-runner/fixtures/<problem-slug>/
 * (see that directory). Each stage declares which fixtures it needs
 * via the `inputFixtures[]` field. The orchestrator (Section 11F)
 * mounts them at the in-container paths the per-tool runners expect
 * (typically /fixtures/...).
 *
 * The 4 stages:
 *
 *   1. ingest (kafka)
 *      Reads click events from the seeded Kafka topic `clickstream`
 *      and writes them as a JSON list to /tmp/output.json (the kafka
 *      runner's convention).
 *
 *   2. enrich (pyspark)
 *      Reads the raw click events as a parquet DataFrame and adds
 *      two derived columns: `event_hour` (truncated to the hour)
 *      and `device_class` (mobile/desktop/tablet derived from
 *      `user_agent`). Writes to /tmp/output/clickstream_enriched.parquet.
 *
 *   3. load (iceberg)
 *      Reads the enriched parquet and writes it as an Iceberg table
 *      `default.clickstream_enriched`. The Iceberg runner reads
 *      /fixtures/schema.json to discover the table definition.
 *
 *   4. report (dbt)
 *      A SQL model that aggregates the enriched Iceberg table by
 *      `event_hour`, counting distinct `user_id`s and events.
 *      Writes a CSV preview via `dbt show` (the runner's standard
 *      output).
 *
 * Expected outputs (one per stage) live at
 * docker/pipeline-runner/fixtures/<problem-slug>/expected/ so the
 * pipeline-runner image (Section 11C) can compare each stage's
 * actual output against the expected. These are NOT mounted during
 * the per-stage docker runs (the orchestrator leaves the
 * /expected/ comparison to the final pipeline-runner pass).
 */

module.exports = [
  {
    title: 'Real-time clickstream analytics',
    slug: 'real-time-clickstream-analytics',
    description: `Build a 4-stage pipeline that ingests clickstream events from Kafka, enriches them with derived fields in PySpark, loads them into an Iceberg table, and finally reports hourly user counts via a dbt model.

This is the canonical end-to-end data engineering pipeline. Each stage has a clear contract with the next, and failures propagate through the DAG — fixing one stage's bug unblocks the next.

**Stages**

1. **ingest (kafka)** — consume the \`clickstream\` topic and write events to /tmp/output.json.
2. **enrich (pyspark)** — read the events, add \`event_hour\` and \`device_class\` columns, write parquet to /tmp/output/clickstream_enriched.parquet.
3. **load (iceberg)** — write the enriched parquet to the Iceberg table \`default.clickstream_enriched\`.
4. **report (dbt)** — a SQL model that aggregates by \`event_hour\` and produces a CSV preview.

**Hints**
- Late events: see if your Spark windowing allows lateness.
- Schema drift: if a column disappears, decide whether to alias it or fail-fast.
- OOM on score: lower your partition count or ask for more memory via the stage's memoryMbOverride.`,
    difficulty: 'Hard',
    tracks: ['streaming', 'data-engineering', 'lakehouse'],
    stages: [
      {
        id: 'ingest',
        executorType: 'kafka',
        description: 'Consume clickstream events from Kafka and write to /tmp/output.json',
        entryPoint: 'solution.py',
        dependsOn: [],
        inputFixtures: [
          // The kafka runner reads these as `/fixtures/topics.json` and
          // `/fixtures/seed_messages.json`. The orchestrator (Section 11F)
          // mounts them at those in-container paths.
          { name: 'topics',         path: '/fixtures/topics.json' },
          { name: 'seed_messages',  path: '/fixtures/seed_messages.json' },
        ],
        outputPath: '/tmp/output.json',
        acceptanceCriteria: 'A JSON list of events written to /tmp/output.json matching the seed_messages payload exactly.',
      },
      {
        id: 'enrich',
        executorType: 'pyspark',
        description: 'Add event_hour and device_class columns; write parquet',
        entryPoint: 'solution.py',
        // The kafka stage produces a JSON list at /tmp/output.json.
        // The orchestrator (11F) mounts the equivalent pre-parsed
        // parquet for the pyspark stage to read as a DataFrame.
        dependsOn: ['ingest'],
        inputFixtures: [
          { name: 'raw_events', path: '/fixtures/clickstream/raw_events.parquet' },
        ],
        outputPath: '/tmp/output/clickstream_enriched.parquet',
        acceptanceCriteria: 'Parquet with the original columns plus event_hour (string, ISO hour) and device_class (mobile/desktop/tablet).',
      },
      {
        id: 'load',
        executorType: 'iceberg',
        description: 'Write enriched parquet to Iceberg table default.clickstream_enriched',
        entryPoint: 'solution.py',
        dependsOn: ['enrich'],
        inputFixtures: [
          { name: 'schema',              path: '/fixtures/schema.json' },
          { name: 'clickstream_data',    path: '/fixtures/clickstream_enriched.parquet' },
        ],
        outputPath: '/tmp/output/iceberg_table_metadata.json',
        acceptanceCriteria: 'Iceberg table default.clickstream_enriched exists with at least N rows.',
      },
      {
        id: 'report',
        executorType: 'dbt',
        description: 'Aggregate by event_hour, count distinct user_id and events',
        entryPoint: 'solution.sql',
        dependsOn: ['load'],
        // The dbt runner has its own internal dbt project at /project/.
        // inputFixtures for dbt would normally be a seed CSV — but for
        // pipeline use, we just rely on the Iceberg-loaded data being
        // available via the dbt-duckdb profile that reads from /project.
        inputFixtures: [],
        outputPath: '/tmp/output/report.csv',
        acceptanceCriteria: 'CSV with columns event_hour, distinct_users, event_count, ordered by event_hour.',
      },
    ],
    fixtureVersion: 1,
  },
];

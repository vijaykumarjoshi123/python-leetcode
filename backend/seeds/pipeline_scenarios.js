/**
 * Pipeline scenarios — Tier 3 / Section 11E.
 *
 * Sample failure-injection scenarios for each pipeline problem seeded
 * in seeds/pipeline_problems.js (Section 11F). Each scenario is one
 * runnable "variant" of the problem — same pipeline topology, but
 * with a different failure applied so the user can practice
 * diagnosing it.
 *
 * Run with: node seeds/pipeline_scenarios.js
 *
 * Shape: { pipelineProblemSlug, slug, name, description, failures,
 *         expectedDiagnosis }
 *
 * The pipeline_scenarios.js file is intentionally pure data — same
 * convention as seeds/problems.js. The runner (when 11F lands and
 * the pipeline problems exist) will resolve `pipelineProblemSlug`
 * to the actual PipelineProblem._id before inserting.
 *
 * Failure types (see backend/models/PipelineScenario.js):
 *   - oom_on_stage:    memory pressure on a stage
 *   - late_data:       input fixture marked "late" (post-watermark)
 *   - schema_drift:    column renamed/dropped in a stage's input
 *   - poison_message:  malformed record in input stream
 *   - slow_consumer:   artificial delay between consumed events
 *
 * Scenarios below assume the clickstream pipeline problem from 11F:
 *   stages: [ingest (kafka) → enrich (sql) → score (pyspark) → report (dbt)]
 * The slugs are referenced by pipelineProblemSlug so the runner
 * can resolve the parent id without hard-coding ObjectIds here.
 */

module.exports = [
  // ===================================================================
  // Pipeline: real-time-clickstream-analytics (Section 11F)
  //   stages: ingest (kafka) → enrich (pyspark) → load (iceberg) → report (dbt)
  // ===================================================================

  // ---------- oom_on_stage ----------
  {
    pipelineProblemSlug: 'real-time-clickstream-analytics',
    slug: 'oom-on-enrich',
    name: 'OOM on the enrichment stage',
    description: 'The Spark enrichment stage runs out of memory mid-job. Diagnose by reading the executor stderr and adjusting either the executor memoryMbOverride or the user code partition size.',
    failures: [
      { stageId: 'enrich', type: 'oom_on_stage', params: { memoryMb: 64 } },
    ],
    expectedDiagnosis: 'Look for "java.lang.OutOfMemoryError" or "Container killed by YARN" in the enrich stage stderr. Either reduce the user code partition size or the per-stage memoryMbOverride.',
  },
  {
    pipelineProblemSlug: 'real-time-clickstream-analytics',
    slug: 'oom-on-load',
    name: 'OOM on the Iceberg load stage',
    description: 'The Iceberg load stage exceeds its memory budget because the parquet file is large and Iceberg\'s in-memory catalog buffers the whole schema.',
    failures: [
      { stageId: 'load', type: 'oom_on_stage', params: { memoryMb: 128 } },
    ],
    expectedDiagnosis: 'Iceberg emits "Out of Memory" while building the table metadata. Either pre-aggregate upstream or ask for more memory via the stage\'s memoryMbOverride.',
  },

  // ---------- late_data ----------
  {
    pipelineProblemSlug: 'real-time-clickstream-analytics',
    slug: 'late-events',
    name: 'Late-arriving click events',
    description: 'The Kafka topic includes events with timestamps up to 3 hours past the current watermark. The enrichment stage must tolerate this without double-counting.',
    failures: [
      { stageId: 'ingest', type: 'late_data', params: { fixtureName: 'clickstream', delayHours: 3 } },
    ],
    expectedDiagnosis: 'Watermark logic in the enrichment stage should allow up to N hours of lateness. If the user code drops events older than the watermark, late events are silently lost. Use event-time windowing with a generous allowed lateness.',
  },

  // ---------- schema_drift ----------
  {
    pipelineProblemSlug: 'real-time-clickstream-analytics',
    slug: 'renamed-column',
    name: 'Renamed session_id column',
    description: 'The Kafka schema has been migrated: `session_id` was renamed to `session_uuid`. Downstream stages that reference `session_id` will fail with column-not-found.',
    failures: [
      { stageId: 'enrich', type: 'schema_drift', params: { driftType: 'rename', column: 'session_id', newName: 'session_uuid' } },
    ],
    expectedDiagnosis: 'Check the enrich stage\'s SELECT — it references `session_id`. Either update the SQL to use `session_uuid`, or add an explicit rename in the ingest stage to alias `session_uuid` back to `session_id`.',
  },
  {
    pipelineProblemSlug: 'real-time-clickstream-analytics',
    slug: 'dropped-column',
    name: 'Dropped user_agent column',
    description: 'The pipeline no longer emits `user_agent` (privacy scrub). The dbt report model still references it.',
    failures: [
      { stageId: 'enrich', type: 'schema_drift', params: { driftType: 'drop', column: 'user_agent' } },
    ],
    expectedDiagnosis: 'dbt run fails with "column user_agent not found". Remove the reference in the report model or replace with a derived field (e.g. device_class).',
  },

  // ---------- poison_message ----------
  {
    pipelineProblemSlug: 'real-time-clickstream-analytics',
    slug: 'malformed-event',
    name: 'One malformed JSON event in the stream',
    description: 'The Kafka topic contains exactly one event that isn\'t valid JSON (the producer skipped schema validation once). The ingest stage should handle it gracefully.',
    failures: [
      { stageId: 'ingest', type: 'poison_message', params: { fixtureName: 'clickstream', recordIndex: 42 } },
    ],
    expectedDiagnosis: 'The ingest stage throws a JSON decode error. The user code should wrap the parse in a try/except and either skip the record or route it to a dead-letter topic.',
  },

  // ---------- slow_consumer ----------
  {
    pipelineProblemSlug: 'real-time-clickstream-analytics',
    slug: 'slow-consumer',
    name: 'Slow Kafka consumer in the ingest stage',
    description: 'The Kafka consumer in the ingest stage artificially waits 200ms between reads, simulating a slow downstream consumer. Throughput drops but no data is lost.',
    failures: [
      { stageId: 'ingest', type: 'slow_consumer', params: { delayMs: 200 } },
    ],
    expectedDiagnosis: 'The pipeline still passes (no data loss) but consumer lag grows. Acceptable for development; in production you would investigate the slow batch interval or the join cardinality.',
  },

  // ---------- composite (multi-failure) ----------
  {
    pipelineProblemSlug: 'real-time-clickstream-analytics',
    slug: 'composite-cascade',
    name: 'OOM-on-enrich followed by late-data in ingest',
    description: 'A composite scenario: the enrichment stage runs out of memory AND receives late events from ingest. The user has to fix both for the pipeline to pass.',
    failures: [
      { stageId: 'enrich', type: 'oom_on_stage', params: { memoryMb: 64 } },
      { stageId: 'ingest', type: 'late_data', params: { fixtureName: 'clickstream', delayHours: 3 } },
    ],
    expectedDiagnosis: 'Two root causes — fix the OOM first (lower partitions or increase memoryMbOverride), then handle late data in the enrichment stage (windowing with allowed lateness).',
  },
];

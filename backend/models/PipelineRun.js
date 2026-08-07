/**
 * PipelineRun — Tier 3 / Section 11D.
 *
 * One document per user-submitted pipeline run. Sibling of Submission
 * (which is the single-tool attempt record); this is the multi-tool
 * pipeline attempt record. No cross-references to Submission — the two
 * flows are independent.
 *
 * Pipeline runs carry code for multiple stages (stageCode is a Map),
 * so a single document represents the user's full attempt to fix a
 * failing pipeline (or pass a clean one).
 *
 * Schema:
 *   - userId / pipelineProblemId — Mongo refs
 *   - scenarioId — populated by Section 11E; null for "no failure" runs
 *   - stageCode  — Map<stageId, code string> (the user's per-stage solutions)
 *   - stageResults — Array<{stageId, executorType, status, runtimeMs, output, error}>
 *     where status matches the per-tool runner enum: 'passed'|'failed'|'skipped'
 *   - totalRuntimeMs — wall clock from run start to final JSON
 *   - passed — final pass/fail verdict (true iff every stage passed or
 *     was skipped)
 *   - error — top-level orchestrator error (empty on normal runs)
 *   - submittedAt — set by Mongoose default
 *
 * The model does not store the fixtures themselves; it references the
 * PipelineProblem's fixtureVersion so historical runs can be reproduced
 * (Section 11F will add per-fixture digests for stronger reproducibility).
 */

const mongoose = require('mongoose');

const stageResultSchema = new mongoose.Schema({
  stageId: { type: String, required: true },
  executorType: {
    type: String,
    // Mirrors the per-stage allowed set in PipelineProblem.stageSchema.
    // 'pipeline' is NOT allowed here — a pipeline run contains
    // per-tool stage runs, never nested pipeline runs.
    enum: ['python', 'sql', 'pyspark', 'dbt', 'airflow', 'kafka', 'iceberg'],
    required: true,
  },
  status: {
    type: String,
    enum: ['passed', 'failed', 'skipped', 'error'],
    required: true,
  },
  runtimeMs: { type: Number, default: 0 },
  output: { type: String, default: '' },   // truncated stdout / CSV head
  error: { type: String, default: '' },
  // Section 11E: failures applied to this stage for this run.
  // Each entry is a normalised { stageId, type, params: Map } as
  // resolved by pipelineOrchestrator.resolveScenarioFailures.
  // Recorded so the report page (11H) can show what was injected.
  failures: [{
    type: {
      type: String,
      enum: ['oom_on_stage', 'late_data', 'schema_drift', 'poison_message', 'slow_consumer'],
    },
    params: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },
    applied: { type: Boolean, default: true },  // false when recorded but not yet implemented
    note: { type: String, default: '' },         // explanation when applied=false
  }],
  // Section 11I — per-stage diagnostics. Each tool captures the bits
  // that matter for diagnosing that tool's failure modes:
  //   - pyspark:   { sparkStages[], sparkEventLogTail, oomMarker }
  //                — sparkStages is a list of {stageId, taskCount,
  //                durationMs, status} parsed from the event log;
  //                sparkEventLogTail is the last ~20 lines of the log
  //                file so the user can read the Spark UI's view
  //                without downloading the whole log; oomMarker is a
  //                boolean set when the stderr contains
  //                "OutOfMemoryError" or "Container killed by YARN".
  //   - dbt:       { runResults: [...], tests: [...], modelTimings }
  //                — runResults is the parsed dbt run_results.json
  //                (each entry: {unique_id, message, timing, status});
  //                tests is the parsed dbt test results; modelTimings
  //                is a rollup {model, totalTime, status}.
  //   - kafka:     { consumerLag, topicStats[] }
  //                — consumerLag is the lag at the moment of capture
  //                for the user's consumer group; topicStats is a list
  //                of {topic, partition, logEndOffset, messageCount}.
  //   - airflow:   { taskTimings[], dagId, structuralIssues }
  //                — taskTimings is a list of {taskId, durationMs,
  //                status}; structuralIssues echoes the validator's
  //                findings for diagnosis (cycles, orphans, etc).
  //   - other:     undefined (no diagnostic capture yet)
  //
  // Cost-limit: the orchestrator only requests diagnostics for failed
  // stages by default (env var PIPELINE_DIAGNOSTICS_MODE=always|on-failure;
  // default on-failure). On clean stages the field is omitted from the
  // schema entirely — no Mongo write overhead.
  diagnostics: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined,
  },
}, { _id: false });

const pipelineRunSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pipelineProblemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PipelineProblem',
    required: true,
  },
  // Section 11E — failures injected into this run. Null for clean runs
  // or for runs submitted before scenarios exist. Stored as a string
  // (the scenario's slug) for cheap querying; full scenario metadata
  // is fetched from PipelineScenario separately.
  scenarioId: { type: String, default: null },
  // The version of fixtures that was active when this run happened.
  // Snapshot at run time so later fixtureVersion bumps don't retro-
  // actively change what the user submitted against.
  fixtureVersion: { type: Number, default: 1 },
  // Map of stageId -> user code for that stage. Mongoose maps to
  // a plain JS object on read/write, which is what the orchestrator
  // already uses (Object.fromEntries on the way in).
  stageCode: {
    type: Map,
    of: String,
    default: () => new Map(),
  },
  stageResults: [stageResultSchema],
  totalRuntimeMs: { type: Number, default: 0 },
  // Run lifecycle. 'pending' while the worker is executing the pipeline
  // (pipeline runs go through the worker because only the worker has
  // Docker-socket access); 'completed' once the orchestrator has written
  // the final verdict; 'error' if the orchestrator itself blew up. The
  // frontend report page polls GET /run/:runId until status !== 'pending'.
  status: {
    type: String,
    enum: ['pending', 'completed', 'error'],
    default: 'completed',
  },
  // Final verdict. A pipeline passes iff every stage is in
  // ('passed', 'skipped'). Failed/errored stages fail the pipeline.
  passed: { type: Boolean, default: false },
  // Top-level orchestrator error. Distinct from per-stage errors —
  // this fires when the orchestrator itself blew up (bad spec,
  // Docker spawn failure, etc.) before or between stages.
  error: { type: String, default: '' },
  // Section 11J — pipeline-aware grading. `score` is the product of
  // correctness and operational quality, computed by the orchestrator
  // after the run finishes.
  //
  //   correctness ∈ [0, 1] — fraction of stages that passed
  //                            (skipped stages count as 1.0 because the
  //                             pipeline was correctly aborted when an
  //                             upstream stage failed; the user didn't
  //                             write bad code, they just didn't get to
  //                             run it). For an N-stage pipeline with
  //                             P passing and S skipped: P/N + (S/N)*1
  //                             simplifies to (P+S)/N = (N - failed)/N.
  //   operational ∈ [0, 1] — quality of the debugging process:
  //                            - 1.0 if the run is the first attempt
  //                            - decreases with repeated runs on the
  //                              same problem (shotgun debugging)
  //                            - decreases with long time-to-diagnose
  //                              (slow runs cost operational points)
  //   total     ∈ [0, 1]   — correctness * operational (rounded to 2dp)
  //   breakdown — verbose per-criterion detail so the report page can
  //                explain WHY a particular score was awarded
  //
  // `score` is optional and defaults to undefined so older PipelineRun
  // documents from before 11J still validate. New runs always populate
  // it; the orchestrator writes the full document atomically.
  score: {
    correctness: { type: Number, min: 0, max: 1, default: 0 },
    operational: { type: Number, min: 0, max: 1, default: 1 },
    total: { type: Number, min: 0, max: 1, default: 0 },
    breakdown: {
      // Stages passed / skipped / failed counts (correctness basis).
      stagesPassed: { type: Number, default: 0 },
      stagesSkipped: { type: Number, default: 0 },
      stagesFailed: { type: Number, default: 0 },
      // Operational sub-scores — each ∈ [0, 1]. Reported so the
      // UI can show which dimension(s) cost the user points.
      //   - attemptEfficiency: 1.0 on first attempt; degrades by
      //                        0.1 per extra attempt on the same
      //                        problem (floor 0.1). Cap at 5 attempts.
      //   - timeEfficiency:    1.0 if the run was the first attempt
      //                        AND it passed; degrades if multiple
      //                        attempts are needed OR the pipeline
      //                        takes longer than 60s wall-clock.
      //   - noShotgun:         1.0 if the user code changed across
      //                        attempts (revisions detected via stageCode
      //                        diff); drops to 0.5 if multiple attempts
      //                        had IDENTICAL code (smells like shotgun
      //                        debugging).
      attemptEfficiency: { type: Number, default: 1 },
      timeEfficiency: { type: Number, default: 1 },
      noShotgun: { type: Number, default: 1 },
      // Counters for the UI badges.
      attemptNumber: { type: Number, default: 1 },
      previousAttempts: { type: Number, default: 0 },
    },
  },
  submittedAt: { type: Date, default: Date.now },
});

// Common query: a user's history of attempts on a specific pipeline
// problem, newest first. The frontend's report page (Section 11H)
// uses this to render the attempt timeline.
pipelineRunSchema.index({ userId: 1, pipelineProblemId: 1, submittedAt: -1 });

module.exports = mongoose.model('PipelineRun', pipelineRunSchema);

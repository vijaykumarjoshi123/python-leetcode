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
  // Final verdict. A pipeline passes iff every stage is in
  // ('passed', 'skipped'). Failed/errored stages fail the pipeline.
  passed: { type: Boolean, default: false },
  // Top-level orchestrator error. Distinct from per-stage errors —
  // this fires when the orchestrator itself blew up (bad spec,
  // Docker spawn failure, etc.) before or between stages.
  error: { type: String, default: '' },
  submittedAt: { type: Date, default: Date.now },
});

// Common query: a user's history of attempts on a specific pipeline
// problem, newest first. The frontend's report page (Section 11H)
// uses this to render the attempt timeline.
pipelineRunSchema.index({ userId: 1, pipelineProblemId: 1, submittedAt: -1 });

module.exports = mongoose.model('PipelineRun', pipelineRunSchema);

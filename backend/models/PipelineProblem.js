const mongoose = require('mongoose');

const VALID_TRACKS = ['foundations', 'data-engineering', 'streaming', 'orchestration', 'lakehouse'];

/**
 * PipelineProblem — Tier 3 / Section 11A.
 *
 * A multi-tool pipeline problem: the user works on a sequence of stages
 * (each one of the existing 7 executor types) where the stages interact
 * and a failure may be injected via a scenario (Section 11E).
 *
 * This model is a SIBLING of the existing Problem model, not a
 * replacement. The single-tool Problem flow is untouched.
 *
 * Why a separate model:
 *   - Different shape (stages[] with dependsOn edges; multi-track)
 *   - Different grading (Section 11J — correctness × operational)
 *   - Different lifecycle (versioned fixtures, scenario-based attempts)
 *   - Cross-referencing existing Problem would force backwards-compat
 *     tweaks everywhere; isolation is cheaper.
 *
 * The 8th executor type `pipeline` lives in executorRouter.js (Section 11B)
 * and is rejected by routes/submissions.js — pipeline runs use
 * routes/pipelines.js (Section 11D).
 *
 * Structural validation: see validatePipelineShape below — call before
 * .save() to assert the DAG shape.
 */

// Stage subdocument — one node in the pipeline DAG.
//
// executorType is restricted to the 7 single-tool types (NOT 'pipeline')
// because a pipeline stage is always a single-tool execution. The
// orchestrator (Section 11D) spawns one container per stage using the
// existing executor routing.
const stageSchema = new mongoose.Schema({
  id: { type: String, required: true },                   // unique within this problem
  executorType: {
    type: String,
    enum: ['python', 'sql', 'pyspark', 'dbt', 'airflow', 'kafka', 'iceberg'],
    required: true,
  },
  description: { type: String, default: '' },
  // Filename the user's code for this stage should be mounted as inside
  // the stage container (e.g. 'solution.py', 'solution.sql').
  entryPoint: { type: String, required: true },
  // Other stage ids this stage reads output from. Used by the orchestrator
  // to compute topological order and to wire /tmp/output/<id>/ -> next stage.
  dependsOn: [{ type: String }],
  // Fixture descriptors — paths into /fixtures/ relative to the runner
  // container. The orchestrator mounts the right files per attempt.
  inputFixtures: [{
    name: { type: String, required: true },               // e.g. 'raw_events'
    path: { type: String, required: true },               // e.g. '/fixtures/clickstream/raw_events.parquet'
  }],
  // Where this stage writes its output. The orchestrator wires the
  // next stage's dependsOn entry to this path.
  outputPath: { type: String, default: '/tmp/output' },
  // Human-readable description of what makes this stage "pass". Grading
  // is descriptive here (Section 11J will turn this into a comparator).
  acceptanceCriteria: { type: String, default: '' },
  // Per-stage resource overrides. Defaults to the executorType's router
  // config; use this to bump memoryMb for memory-hungry stages (e.g.
  // Spark) or drop it for forced-OOM scenarios (Section 11E).
  memoryMbOverride: { type: Number, default: null },
  timeoutMsOverride: { type: Number, default: null },
}, { _id: false });

const pipelineProblemSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, default: '' },           // markdown
  difficulty: {
    type: String,
    enum: ['Easy', 'Medium', 'Hard'],
    required: true,
  },
  // Pipeline problems can span multiple tracks (e.g. a Kafka stream
  // feeding into a dbt model touches both 'streaming' and
  // 'data-engineering'). Plurals — distinct from Problem.track.
  tracks: {
    type: [{ type: String, enum: VALID_TRACKS }],
    default: [],
  },
  stages: [stageSchema],
  // Fixture versioning. When the orchestrator loads fixtures for an
  // attempt, it tags the run with this version. Future versions of the
  // same pipeline can change fixtures without invalidating historical
  // runs (and without surprise mid-attempt breakage).
  fixtureVersion: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
});

// Structural validation lives in app code (validatePipelineShape below)
// rather than a Mongoose pre-validate hook. Mongoose 7 + kareem have subtle
// behaviour around hooks that throw or call next(error) from pre-validate —
// the throw can escape the validation chain depending on the hook signature
// and the call path (validateSync skips async hooks entirely; validate()
// has a known kareem issue where synchronous throws from a `function (next)`
// hook escape via Karem.wrap's asyncPresLeft counter). Doing the validation
// in a plain helper that's called before .save() is more robust, easier to
// test in isolation, and doesn't depend on Mongoose internals.

/**
 * Validate the structural invariants of a PipelineProblem document.
 * Returns null on success, or a string describing the first violation.
 *
 * Checks:
 *   - All stage ids are unique within the document
 *   - Every dependsOn reference points to an existing stage id
 *
 * Call this before `.save()` or wherever you need to assert the document
 * shape is sane. The Mongoose schema-level validation handles required
 * fields; this handles the DAG shape.
 */
function validatePipelineShape(doc) {
  const stages = doc.stages || [];
  const ids = stages.map((s) => s.id);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) {
    return 'PipelineProblem.stages ids must be unique';
  }
  for (const stage of stages) {
    for (const dep of stage.dependsOn || []) {
      if (!idSet.has(dep)) {
        return `Stage "${stage.id}" dependsOn "${dep}" which is not defined in stages[].id`;
      }
    }
  }
  return null;
}

module.exports = mongoose.model('PipelineProblem', pipelineProblemSchema);
module.exports.validatePipelineShape = validatePipelineShape;

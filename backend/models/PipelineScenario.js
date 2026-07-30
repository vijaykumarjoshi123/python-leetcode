/**
 * PipelineScenario — Tier 3 / Section 11E.
 *
 * A failure-injection scenario attached to a PipelineProblem. Each
 * scenario describes one or more stage-level failures that the
 * orchestrator applies before running the pipeline. The scenario's
 * `expectedDiagnosis` is a free-form description of what the user
 * should look for to identify the root cause (rendered as a hint in
 * the report page; not auto-graded).
 *
 * Schema:
 *   - pipelineProblemId — ref to PipelineProblem
 *   - slug — short identifier used in API requests and seed URLs
 *   - name — human-readable label
 *   - description — markdown explanation of what the scenario does
 *   - failures[] — list of {stageId, type, params}, where:
 *       * stageId — id of the stage to apply this failure to
 *       * type — one of VALID_FAILURE_TYPES (see below)
 *       * params — type-specific parameter map
 *   - expectedDiagnosis — markdown hint for the report page
 *
 * Failure types (Section 11E spec):
 *
 *   oom_on_stage
 *     Inject an artificial memory pressure on the named stage. The
 *     orchestrator sets `memoryMb` for that stage's docker run to a
 *     value small enough that the user's code OOMs on the fixture
 *     data. params: { memoryMb } (defaults to 64m).
 *
 *   late_data
 *     Stage runs normally but with a latency-injected fixture — the
 *     orchestrator mounts a fixture marked "late" (events arriving
 *     past the watermark). The user's code should observe the late
 *     data in its output. params: { fixtureName } (the orchestrator
 *     resolves the fixture from the problem's inputFixtures[]).
 *
 *   schema_drift
 *     The named stage's input fixture is replaced with a
 *     schema-drifted version (a column renamed / dropped). Downstream
 *     stages that read the drifted output will fail with column-not-
 *     found errors. params: { driftType: 'rename' | 'drop',
 *     column: string, newName?: string }.
 *
 *   poison_message
 *     The named stage receives an input that includes a single
 *     malformed record (e.g. a Kafka message that isn't valid JSON).
 *     The user's code should detect this and either drop it or
 *     route to a dead-letter path. params: { fixtureName,
 *     recordIndex }.
 *
 *   slow_consumer
 *     Stage runs normally but with an artificial delay between
 *     events it reads. Used to test backpressure / consumer lag
 *     handling. params: { delayMs: number }.
 *
 * Future types (deferred to later sections):
 *   - network_partition — Section 11I (observability) will introduce
 *     this. The orchestrator currently doesn't apply network
 *     failures — that requires an `--add-network` flag and additional
 *     docker plumbing.
 *   - disk_full — similar.
 */

const mongoose = require('mongoose');

const VALID_FAILURE_TYPES = [
  'oom_on_stage',
  'late_data',
  'schema_drift',
  'poison_message',
  'slow_consumer',
];

// failure subdocument — one failure injected into one stage.
const failureSchema = new mongoose.Schema({
  // The stage id within the pipeline problem's stages[]. Validated
  // by validateScenarioShape below (must exist on the parent
  // problem's stages[]).
  stageId: { type: String, required: true },
  type: {
    type: String,
    enum: VALID_FAILURE_TYPES,
    required: true,
  },
  // Type-specific parameter bag. Shape depends on `type` — see the
  // docblock above for per-type expectations. Stored as a free-form
  // map because the params differ per failure type.
  params: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map(),
  },
}, { _id: false });

const pipelineScenarioSchema = new mongoose.Schema({
  pipelineProblemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PipelineProblem',
    required: true,
  },
  // Short identifier used in URLs and seed files. Unique per
  // pipeline problem so a scenario can be referenced unambiguously.
  slug: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },           // markdown
  failures: [failureSchema],
  // Free-form diagnosis hint shown in the report page (Section 11H).
  // Not auto-graded — purely an instructional aid.
  expectedDiagnosis: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

pipelineScenarioSchema.index({ pipelineProblemId: 1, slug: 1 }, { unique: true });

/**
 * Validate that a scenario's failures reference real stages on the
 * parent PipelineProblem. Returns null on success, or a string
 * describing the first violation. Same call-then-save pattern as
 * PipelineProblem.validatePipelineShape — see that file for the
 * rationale (Mongoose 7 + kareem hook subtleties).
 */
function validateScenarioShape(scenarioDoc, problemDoc) {
  if (!problemDoc) {
    return 'parent PipelineProblem is required for validation';
  }
  const stageIds = new Set((problemDoc.stages || []).map((s) => s.id));
  for (const f of scenarioDoc.failures || []) {
    if (!stageIds.has(f.stageId)) {
      return `failure references stage "${f.stageId}" which is not defined on the parent PipelineProblem`;
    }
  }
  return null;
}

module.exports = mongoose.model('PipelineScenario', pipelineScenarioSchema);
module.exports.VALID_FAILURE_TYPES = VALID_FAILURE_TYPES;
module.exports.validateScenarioShape = validateScenarioShape;

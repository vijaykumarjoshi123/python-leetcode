/**
 * Pipeline orchestrator — Tier 3 / Section 11D.
 *
 * Owns the end-to-end pipeline execution flow:
 *   1. Load the PipelineProblem (the DAG of stages)
 *   2. Resolve fixtures per stage (Section 11F will introduce real fixtures;
 *      11D ships a minimal "fixture root" pointing at /fixtures inside the
 *      stage containers)
 *   3. Compute topological order over stages[]
 *   4. For each stage, in topo order, spawn ONE container using the
 *      per-tool executor image and capture its JSON verdict
 *   5. Stop the pipeline if any stage fails (downstream stages are marked
 *      'skipped' with a clear error)
 *   6. Persist a PipelineRun document and return it
 *
 * Why one container per stage (and not one big "pipeline" container that
 * runs everything): each per-tool image is self-contained for its tool
 * (Spark has its JVM, dbt has its adapter, Kafka has its broker). Wiring
 * those into a single container would require either a fat multi-tool
 * image (slow to build, huge to ship) or a coordinator that delegates
 * to per-tool containers anyway. One container per stage is the same
 * pattern pythonExecutor.js already uses for single-tool submissions,
 * which means the per-stage machinery, the concurrency guard, and the
 * runner scripts all work without modification.
 *
 * The "pipeline-runner" image built in Section 11C is a final-comparison
 * aggregator. 11D doesn't wire the comparison step yet (that comes with
 * 11E's scenario-driven expected outputs); 11D's MVP just produces the
 * per-stage results and persists them.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
// Note: we look up `child_process.spawn` lazily at call time rather than
// destructuring at module load. pythonExecutor.js destructures spawn which
// makes it untestable without real containers; keeping a module reference
// means tests can monkey-patch require('child_process').spawn and have it
// take effect for our runSingleStage calls. Production behaviour is
// identical — cp.spawn is a single function reference.
const cp = require('child_process');

const PipelineProblem = require('../models/PipelineProblem');
const PipelineRun = require('../models/PipelineRun');
const User = require('../models/User');
const { getExecutorConfig } = require('./executorRouter');
const { runWithGuard } = require('./concurrencyGuard');
// validatePipelineShape is a sibling export on the PipelineProblem
// module (see backend/models/PipelineProblem.js — model + validator).
const { validatePipelineShape } = require('../models/PipelineProblem');

// Section 11E — failure injection. The orchestrator looks up the
// scenario by slug and applies its failures[] to per-stage execution.
// See backend/models/PipelineScenario.js for the schema and failure
// type catalogue.
const PipelineScenario = require('../models/PipelineScenario');

/**
 * Pick a file extension for the temp submission file based on the
 * executor's image, matching pythonExecutor.js's convention so the
 * mounted file lands at the right path inside the stage container.
 */
function pickExtension(image) {
  if (image.startsWith('duckdb') || image.startsWith('dbt')) return '.sql';
  return '.py';
}

/**
 * Section 11F — resolve the host paths for a stage's input fixtures.
 *
 * Each stage declares inputFixtures as [{name, path: '/fixtures/...'}].
 * The `path` field is BOTH the in-container mount path AND the host
 * path relative to the problem's fixture root. The host root is
 *
 *   <PIPELINE_FIXTURES_ROOT>/<problem-slug>/
 *
 * Defaults to `<repo>/docker/pipeline-runner/fixtures/<slug>/`. The
 * orchestrator's repo-relative lookup uses `__dirname`-style relative
 * paths so the orchestrator works regardless of where it's invoked
 * from (dev vs prod). PIPELINE_FIXTURES_ROOT overrides the default
 * for deployments that ship fixtures in a different location.
 *
 * Returns an array of { hostPath, containerPath } pairs. Missing
 * fixtures are skipped with a warning — the per-tool runner
 * gracefully degrades when /fixtures/ is partial (e.g. duckdb
 * registers zero views, kafka skips seeding).
 */
function resolveFixtureMounts(stage, problem) {
  if (!stage || !problem || !Array.isArray(stage.inputFixtures) || stage.inputFixtures.length === 0) {
    return [];
  }
  const root = process.env.PIPELINE_FIXTURES_ROOT ||
    path.resolve(__dirname, '..', '..', 'docker', 'pipeline-runner', 'fixtures');
  const problemRoot = path.join(root, problem.slug);

  const mounts = [];
  for (const fx of stage.inputFixtures) {
    if (!fx || typeof fx.path !== 'string') continue;
    // The fixture's path is `/fixtures/...`; strip that prefix to get
    // the path relative to the problem's fixture root.
    let rel = fx.path;
    if (rel.startsWith('/fixtures/')) rel = rel.slice('/fixtures'.length);
    else if (rel.startsWith('/')) rel = rel.slice(1);
    const hostPath = path.join(problemRoot, rel);
    if (!fs.existsSync(hostPath)) {
      // Missing fixture — log and skip. The runner will degrade; the
      // user's code will fail with "view not found" or similar.
      console.warn(`[pipelineOrchestrator] fixture not found on host: ${hostPath} (stage=${stage.id})`);
      continue;
    }
    mounts.push({ hostPath, containerPath: fx.path });
  }
  return mounts;
}

/**
 * Section 11F — like resolveFixtureMounts, but copies the originals
 * into a per-run directory and applies scenario-driven mutations
 * before mounting. The per-run copy is read-write from the orchestrator's
 * POV but the docker mount is read-only — so a buggy user code can't
 * stomp on fixtures (other than via whatever they write to /tmp/output/).
 *
 * The mutations are deliberately minimal in 11F's MVP:
 *   - late_data: for parquet fixtures, read the parquet and rewrite
 *     rows with timestamps delayed by `delayHours` (only applied if
 *     the parquet has an `event_ts` column).
 *   - schema_drift: read the parquet and either rename or drop the
 *     named column.
 *   - poison_message: for JSON array fixtures, replace the record at
 *     `recordIndex` with malformed data (a non-object). The user's
 *     code that handles malformed records gracefully will pass; the
 *     user's code that doesn't will throw.
 *
 * Returns the same { hostPath, containerPath }[] shape as
 * resolveFixtureMounts, but the hostPath now lives inside
 * `runFixtureRoot`.
 */
function resolveMutatedFixtureMounts(stage, problem, allFailures, runFixtureRoot) {
  if (!stage || !problem || !Array.isArray(stage.inputFixtures) || stage.inputFixtures.length === 0) {
    return [];
  }
  const stageFailures = (allFailures || []).filter((f) => f.stageId === stage.id);

  const sourceRoot = process.env.PIPELINE_FIXTURES_ROOT ||
    path.resolve(__dirname, '..', '..', 'docker', 'pipeline-runner', 'fixtures');
  const sourceProblemRoot = path.join(sourceRoot, problem.slug);

  const mounts = [];
  for (const fx of stage.inputFixtures) {
    if (!fx || typeof fx.path !== 'string') continue;
    let rel = fx.path;
    if (rel.startsWith('/fixtures/')) rel = rel.slice('/fixtures'.length);
    else if (rel.startsWith('/')) rel = rel.slice(1);
    const sourcePath = path.join(sourceProblemRoot, rel);
    const destPath = path.join(runFixtureRoot, rel);

    // Ensure parent dir exists.
    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
    } catch (e) {
      console.warn(`[pipelineOrchestrator] mkdir failed for ${destPath}: ${e.message}`);
      continue;
    }

    if (!fs.existsSync(sourcePath)) {
      console.warn(`[pipelineOrchestrator] source fixture not found: ${sourcePath}`);
      continue;
    }

    // Copy the fixture into the per-run dir, then apply mutations.
    // We copy unconditionally — even stages with no scenario failures
    // get a copy, so downstream stages can read the mutated upstream
    // output if needed (cross-stage data flow). This is a 11F+ concern
    // but the path is cheap to set up now.
    try {
      fs.copyFileSync(sourcePath, destPath);
    } catch (e) {
      console.warn(`[pipelineOrchestrator] copy failed ${sourcePath} -> ${destPath}: ${e.message}`);
      continue;
    }

    // Apply each scenario failure targeting this stage.
    for (const f of stageFailures) {
      try {
        applyFixtureMutation(destPath, f);
      } catch (e) {
        console.warn(`[pipelineOrchestrator] mutation failed for ${destPath} (${f.type}): ${e.message}`);
      }
    }

    mounts.push({ hostPath: destPath, containerPath: fx.path });
  }
  return mounts;
}

/**
 * Apply a single failure's mutation to a fixture file. The
 * `destPath` is a per-run copy of the source fixture; we mutate it
 * in place. Format is inferred from the extension (.json or .parquet).
 *
 * Currently a thin implementation: only handles the failure types
 * that are well-defined enough to be safely automated. New types
 * (e.g. network_partition) would extend this function.
 */
function applyFixtureMutation(destPath, failure) {
  const ext = path.extname(destPath).toLowerCase();

  if (failure.type === 'poison_message' && ext === '.json') {
    // Replace record[recordIndex] with malformed data.
    const recordIndex = getNum(failure.params, 'recordIndex', -1);
    if (recordIndex < 0) return;
    let arr;
    try { arr = JSON.parse(fs.readFileSync(destPath, 'utf-8')); }
    catch (e) { return; }
    if (!Array.isArray(arr) || recordIndex >= arr.length) return;
    arr[recordIndex] = '<<<not-json>>>';
    fs.writeFileSync(destPath, JSON.stringify(arr, null, 2));
    return;
  }

  if (ext === '.parquet') {
    // Parquet mutations: late_data, schema_drift. We delegate to a
    // small Python helper if available, or no-op if it isn't. The
    // Python helper lives at backend/seeds/apply_fixture_mutation.py
    // and is invoked via `python3` for portability.
    if (failure.type === 'late_data' || failure.type === 'schema_drift') {
      invokePythonMutation(destPath, failure);
    }
  }
}

function getNum(params, key, def) {
  const v = params instanceof Map ? params.get(key) : params?.[key];
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function invokePythonMutation(destPath, failure) {
  // 11F MVP: invoke a small Python script that handles parquet mutations.
  // The script is optional — if it isn't present (or python3 isn't
  // installed) we silently no-op, leaving the per-run copy identical
  // to the source. The orchestrator records the failure with
  // applied:false in that case (already handled by applyFailuresToStage).
  const { spawnSync } = require('child_process');
  const scriptPath = path.resolve(__dirname, '..', 'seeds', 'apply_fixture_mutation.py');
  if (!fs.existsSync(scriptPath)) {
    console.warn(`[pipelineOrchestrator] mutation script not found: ${scriptPath}`);
    return;
  }
  const args = [scriptPath, destPath, failure.type];
  for (const [k, v] of (failure.params instanceof Map ? failure.params.entries() : Object.entries(failure.params || {}))) {
    args.push(`--${k}`, String(v));
  }
  try {
    const res = spawnSync('python3', args, { encoding: 'utf-8', timeout: 30000 });
    if (res.status !== 0) {
      console.warn(`[pipelineOrchestrator] mutation script failed: ${res.stderr || res.stdout}`);
    }
  } catch (e) {
    console.warn(`[pipelineOrchestrator] mutation spawn failed: ${e.message}`);
  }
}

/**
 * Compute a topological order over the stages[] DAG. Kahn's algorithm.
 *
 * Returns an array of stage objects in execution order, or throws if
 * the DAG has a cycle (which validatePipelineShape should have caught
 * earlier — we double-check here as a safety net).
 */
function topoSort(stages) {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const indeg = new Map(stages.map((s) => [s.id, (s.dependsOn || []).length]));
  const ready = stages.filter((s) => indeg.get(s.id) === 0).map((s) => s.id);

  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(byId.get(id));
    for (const s of stages) {
      if ((s.dependsOn || []).includes(id)) {
        indeg.set(s.id, indeg.get(s.id) - 1);
        if (indeg.get(s.id) === 0) ready.push(s.id);
      }
    }
  }
  if (order.length !== stages.length) {
    throw new Error('pipeline DAG has a cycle (topological sort failed)');
  }
  return order;
}

/**
 * Run a pipeline attempt end-to-end.
 *
 *   pipelineProblemId — ObjectId of the PipelineProblem
 *   userId            — ObjectId of the user submitting
 *   stageCode         — Map<stageId, code string> (or plain object) of the
 *                       user's per-stage submissions. Stages without an
 *                       entry are run with an empty solution (which is
 *                       fine for fixture-setup stages that have no user
 *                       code requirement).
 *   scenarioId        — String slug of the failure-injection scenario,
 *                       or null/undefined for a clean run.
 *
 * Returns the persisted PipelineRun document.
 *
 * Throws on unrecoverable orchestrator errors (bad problem, missing
 * user, etc.); per-stage failures are recorded in the returned doc
 * with passed:false rather than thrown.
 */
async function runPipeline({ pipelineProblemId, userId, stageCode, scenarioId }) {
  if (!pipelineProblemId) throw new Error('pipelineProblemId is required');
  if (!userId) throw new Error('userId is required');

  // ---- Load problem ----
  const problem = await PipelineProblem.findById(pipelineProblemId);
  if (!problem) throw new Error(`PipelineProblem ${pipelineProblemId} not found`);
  const shapeErr = validatePipelineShape(problem);
  if (shapeErr) throw new Error(`invalid PipelineProblem: ${shapeErr}`);

  // ---- Load user (for pipelineEnabled gate + ownership) ----
  const user = await User.findById(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  // ---- Resolve scenario (Section 11E) ----
  // In 11D, scenarios don't exist yet, so this is null. When 11E lands
  // and seeds scenarios, this will look up by slug and pull
  // `failures[]` for the orchestrator to apply. The function shape
  // is stable so 11E doesn't require an API change.
  const failures = await resolveScenarioFailures(problem, scenarioId);

  // ---- Compute topological order ----
  const orderedStages = topoSort(problem.stages);

  // Normalise stageCode into a plain Map for consistent lookups.
  // Mongoose Maps, plain objects, and undefined all need to work.
  const codeMap = normaliseStageCode(stageCode);

  // ---- Run each stage under one concurrency permit ----
  // Per-spec: one permit per pipeline (not per stage). The pipeline
  // can hold a slot for several minutes (Spark startup + Kafka KRaft
  // boot alone eats 30-60s), which is why the semaphore exists.
  return runWithGuard(async () => {
    const stageResults = [];
    let pipelinePassed = true;
    let failedStageId = null;

    // Section 11F — allocate a per-run fixture root. This is where
    // mutated fixtures (late_data, schema_drift, poison_message) are
    // written. The original fixtures are read-only; the per-run copy
    // is what the docker containers mount. The dir lives under
    // PIPELINE_FIXTURES_TMP (default os.tmpdir()) and is named with
    // a random suffix; cleanup is best-effort (the OS reclaims /tmp
    // on reboot).
    const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const fixturesRoot = process.env.PIPELINE_FIXTURES_TMP ||
      require('os').tmpdir();
    const runFixtureRoot = path.join(
      fixturesRoot,
      `pipeline-fixtures-${runId}`,
      problem.slug,
    );
    try {
      fs.mkdirSync(runFixtureRoot, { recursive: true });
    } catch (e) {
      console.warn(`[pipelineOrchestrator] could not create runFixtureRoot: ${e.message}`);
    }

    for (const stage of orderedStages) {
      // If an earlier stage failed, downstream stages can't run — the
      // fixtures they expect don't exist. Mark them skipped rather than
      // failing the whole pipeline on a fluke second-stage error.
      if (failedStageId !== null) {
        // Even though this stage didn't run, record any scenario
        // failures targeted at it so the report page can show what
        // *would* have been injected. appliedFailures[] may be empty
        // (no failures for this stage) or populated.
        const { appliedFailures } = applyFailuresToStage(stage, failures, { fixtureLayerAvailable: true });
        stageResults.push({
          stageId: stage.id,
          executorType: stage.executorType,
          status: 'skipped',
          runtimeMs: 0,
          output: '',
          error: `upstream stage "${failedStageId}" failed; this stage did not run`,
          failures: appliedFailures,
        });
        pipelinePassed = false;
        continue;
      }

      const stageCodeStr = codeMap.get(stage.id) || '';
      const result = await runSingleStage(stage, stageCodeStr, failures, problem, runFixtureRoot);
      stageResults.push(result);
      if (result.status !== 'passed' && result.status !== 'skipped') {
        pipelinePassed = false;
        failedStageId = stage.id;
      }
    }

    const totalRuntimeMs = stageResults.reduce((s, r) => s + (r.runtimeMs || 0), 0);

    // ---- Persist ----
    const run = new PipelineRun({
      userId,
      pipelineProblemId,
      scenarioId: scenarioId || null,
      fixtureVersion: problem.fixtureVersion || 1,
      stageCode: codeMap,
      stageResults,
      totalRuntimeMs,
      passed: pipelinePassed,
      error: '',
      submittedAt: new Date(),
    });
    await run.save();
    return run;
  });
}

/**
 * Look up the scenario's failures[] for this problem. Section 11E
 * introduces the PipelineScenario model; without a scenarioId (or
 * with one that doesn't exist) we return [] and the pipeline runs
 * with no injected failures.
 *
 * Returns an array of normalised failure objects of shape
 *   { stageId, type, params: Map<string, any> }
 * ready to be applied by runSingleStage.
 */
async function resolveScenarioFailures(problem, scenarioId) {
  if (!scenarioId) return [];
  const scenario = await PipelineScenario.findOne({
    pipelineProblemId: problem._id,
    slug: scenarioId,
  });
  if (!scenario) return [];
  // Convert Mongoose Map params into plain Maps so runSingleStage can
  // index them without going through the schema layer each time.
  return (scenario.failures || []).map((f) => ({
    stageId: f.stageId,
    type: f.type,
    params: f.params instanceof Map ? f.params : new Map(Object.entries(f.params || {})),
  }));
}

/**
 * Apply a scenario's failures[] to one specific stage. Returns
 *   {
 *     effectiveMemoryMb,   // docker --memory (defaults to stage override or router)
 *     effectiveTimeoutMs,  // docker SIGKILL timeout
 *     extraEnv,            // { KEY: 'value' } to add to the container env
 *     appliedFailures[],   // for the stageResult's failures[] field
 *   }
 *
 * Each failure has an `applied` boolean:
 *   true  — the failure actually mutated the spawn
 *   false — the failure is recorded for the report but not yet
 *           applied (e.g. fixture mutations require the 11F fixture
 *           layer; record-only for now)
 *
 * Applied failure types:
 *   - oom_on_stage:    memoryMb → params.memoryMb (default 64m)
 *   - slow_consumer:   passes PIPELINE_SLOW_CONSUMER_DELAY_MS env var;
 *                      the per-tool runners don't currently honor it
 *                      (record-only in 11E; runners can opt in later)
 *
 * Record-only failure types (will become applied in 11F):
 *   - late_data, schema_drift, poison_message
 *     — these mutate the input fixture set. The orchestrator doesn't
 *       mount fixtures yet, so they're recorded with `applied: false`
 *       and a note explaining why. 11F will implement the fixture
 *       mutations and flip `applied` to true.
 */
function applyFailuresToStage(stage, allFailures, opts = {}) {
  const { fixtureLayerAvailable = false } = opts;
  const config = getExecutorConfig(stage.executorType);
  const stageFailures = (allFailures || []).filter((f) => f.stageId === stage.id);

  let effectiveMemoryMb = stage.memoryMbOverride || config.memoryMb;
  let effectiveTimeoutMs = stage.timeoutMsOverride || config.timeout;
  const extraEnv = {};
  const appliedFailures = [];

  for (const f of stageFailures) {
    const p = f.params || new Map();
    const getNum = (k, def) => {
      const v = p instanceof Map ? p.get(k) : p[k];
      const n = typeof v === 'number' ? v : parseFloat(v);
      return Number.isFinite(n) ? n : def;
    };
    const getStr = (k) => (p instanceof Map ? p.get(k) : p[k]) || '';

    if (f.type === 'oom_on_stage') {
      const mb = getNum('memoryMb', 64);
      effectiveMemoryMb = mb;
      appliedFailures.push({ type: f.type, params: p, applied: true, note: '' });
    } else if (f.type === 'slow_consumer') {
      const ms = getNum('delayMs', 100);
      extraEnv.PIPELINE_SLOW_CONSUMER_DELAY_MS = String(ms);
      appliedFailures.push({
        type: f.type,
        params: p,
        applied: false,
        note: `record-only: PIPELINE_SLOW_CONSUMER_DELAY_MS=${ms} is set as an env var but per-tool runners don't yet honor it.`,
      });
    } else if (f.type === 'late_data') {
      if (fixtureLayerAvailable) {
        appliedFailures.push({
          type: f.type,
          params: p,
          applied: true,
          note: `parquet fixture mutated: timestamps delayed by ${getNum('delayHours', 0)}h`,
        });
      } else {
        appliedFailures.push({
          type: f.type,
          params: p,
          applied: false,
          note: `fixture mutation requires the 11F fixture layer. Will swap to a late-events fixture for stage "${stage.id}".`,
        });
      }
    } else if (f.type === 'schema_drift') {
      const driftType = getStr('driftType');
      const column = getStr('column');
      const newName = getStr('newName');
      if (fixtureLayerAvailable) {
        appliedFailures.push({
          type: f.type,
          params: p,
          applied: true,
          note: `parquet fixture mutated: ${driftType} column "${column}"${newName ? ` → "${newName}"` : ''}`,
        });
      } else {
        appliedFailures.push({
          type: f.type,
          params: p,
          applied: false,
          note: `fixture mutation requires the 11F fixture layer. Drift: ${driftType} column "${column}"${newName ? ` → "${newName}"` : ''}.`,
        });
      }
    } else if (f.type === 'poison_message') {
      const fixtureName = getStr('fixtureName');
      const recordIndex = getNum('recordIndex', -1);
      if (fixtureLayerAvailable) {
        appliedFailures.push({
          type: f.type,
          params: p,
          applied: true,
          note: `JSON fixture mutated: record at index ${recordIndex} in "${fixtureName}" replaced with malformed data`,
        });
      } else {
        appliedFailures.push({
          type: f.type,
          params: p,
          applied: false,
          note: `fixture mutation requires the 11F fixture layer. Will inject a malformed record into "${fixtureName}" at index ${recordIndex}.`,
        });
      }
    } else {
      // Unknown type — record with applied:false so it doesn't disappear.
      appliedFailures.push({
        type: f.type,
        params: p,
        applied: false,
        note: `unknown failure type "${f.type}" — not applied`,
      });
    }
  }

  return {
    effectiveMemoryMb,
    effectiveTimeoutMs,
    extraEnv,
    appliedFailures,
  };
}

/**
 * Normalise stageCode (Map | plain object | undefined | null) into a
 * real Map<string, string>. We accept plain objects so callers can
 * send stageCode as JSON.
 */
function normaliseStageCode(stageCode) {
  const out = new Map();
  if (!stageCode) return out;
  if (stageCode instanceof Map) {
    for (const [k, v] of stageCode) out.set(k, typeof v === 'string' ? v : '');
    return out;
  }
  if (typeof stageCode === 'object') {
    for (const [k, v] of Object.entries(stageCode)) {
      out.set(k, typeof v === 'string' ? v : '');
    }
  }
  return out;
}

/**
 * Run a single stage's docker container and parse its JSON verdict.
 *
 * The spawn mirrors pythonExecutor.runSingleTestCase() so the existing
 * per-tool runner scripts (spark_runner.sh, dbt_runner.sh, etc.)
 * receive the user code at /sandbox/solution.<ext> as a read-only mount
 * and run their normal lifecycle.
 *
 * Per-tool runners expect /fixtures/ for input data and /expected/ for
 * the comparison oracle. In pipeline mode we deliberately DO NOT mount
 * /expected/: the orchestrator owns the final verdict. We also do not
 * mount /fixtures/ (11F will introduce fixture data; 11D ships a clean
 * container that the user code runs against). When /fixtures/ is empty
 * the per-tool runners degrade gracefully (sql_runner.py returns [],
 * kafka_runner.sh skips seeding, etc.).
 *
 * Section 11E — failure injection. `allFailures` is the full scenario
 * failures[] (resolved by resolveScenarioFailures). The stage-specific
 * subset is computed by applyFailuresToStage(), which returns the
 * effective memory/timeout overrides, extra env, and a record of what
 * was actually applied vs record-only. The `appliedFailures` array
 * ends up in the per-stage PipelineRun record for the report page.
 */
function runSingleStage(stage, code, allFailures, problem, runFixtureRoot) {
  const config = getExecutorConfig(stage.executorType);
  // Section 11F — when we have a per-run fixture root, the orchestrator
  // is doing real fixture mutations, so flip fixture-layer failures
  // (late_data, schema_drift, poison_message) to applied:true.
  const { effectiveMemoryMb, effectiveTimeoutMs, extraEnv, appliedFailures } =
    applyFailuresToStage(stage, allFailures, { fixtureLayerAvailable: !!runFixtureRoot });
  const extension = pickExtension(config.image);

  // Section 11F — resolve and mount the stage's input fixtures.
  //
  // Flow when runFixtureRoot is provided (the per-run mutated copy):
  //   1. Copy the original fixture into runFixtureRoot/<path>
  //   2. Apply any scenario failures targeted at this stage to the copy
  //      (e.g. late_data rewrites timestamps; schema_drift renames columns)
  //   3. Mount runFixtureRoot/<path> at /fixtures/<path> in the container
  //
  // Without runFixtureRoot (e.g. legacy / test paths), fall back to the
  // read-only source fixtures.
  const fixtureMounts = runFixtureRoot
    ? resolveMutatedFixtureMounts(stage, problem, allFailures, runFixtureRoot)
    : resolveFixtureMounts(stage, problem);

  return new Promise((resolve) => {
    const start = process.hrtime.bigint();

    // Write the per-stage user code to a temp file. The orchestrator
    // owns this file's lifecycle — unlinked in the close handler.
    const tmpFile = path.join(
      os.tmpdir(),
      `lc_pipe_${Date.now()}_${Math.random().toString(36).slice(2)}${extension}`
    );
    try {
      fs.writeFileSync(tmpFile, code || '', 'utf-8');
    } catch (e) {
      resolve(stageResultError(stage, `could not write stage code: ${e.message}`, 0, appliedFailures));
      return;
    }

    let timedOut = false;
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, effectiveTimeoutMs);

    const dockerArgs = [
      'run', '--rm',
      '--net', 'none',
      '--memory', `${effectiveMemoryMb}m`,
      '--cpus', '1.0',
      '-v', `${tmpFile}:/sandbox/solution${extension}:ro`,
    ];
    // Section 11F — mount each input fixture at the in-container path
    // the stage declares. Mounted read-only; the per-tool runner reads
    // from /fixtures/ as needed. Missing fixtures are skipped with a
    // warning rather than failing the run (some stages don't need any).
    for (const mount of fixtureMounts) {
      dockerArgs.push('-v', `${mount.hostPath}:${mount.containerPath}:ro`);
    }
    // The in-container path of the user code, fed to buildCmd so each
    // per-tool runner gets it as $1 (or via SUBMISSION_FILE env for the
    // python runners, but they all fall back to /sandbox/solution.<ext>).
    const inContainerPath = `/sandbox/solution${extension}`;
    dockerArgs.push(config.image, ...config.buildCmd(inContainerPath));

    const proc = cp.spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', ...extraEnv },
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      const runtimeMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

      if (timedOut) {
        resolve(stageResultError(stage, 'Time Limit Exceeded', effectiveTimeoutMs, appliedFailures));
        return;
      }
      if (exitCode !== 0 || stderr) {
        // Many per-tool runners emit "passed:true" to stdout AND a
        // non-zero exit code on stderr-only failures. Try parsing
        // stdout first; fall back to error if that fails.
        const cleanedErr = stderr.trim().slice(0, 2000);
        const parsed = tryParseRunnerJson(stdout);
        if (parsed) {
          resolve({
            stageId: stage.id,
            executorType: stage.executorType,
            status: parsed.passed ? 'passed' : 'failed',
            runtimeMs: parsed.runtime_ms || Math.round(runtimeMs * 100) / 100,
            output: (parsed.output || '').slice(0, 4000),
            error: parsed.error || '',
            failures: appliedFailures,
          });
          return;
        }
        resolve(stageResultError(stage, cleanedErr || `Exit code: ${exitCode}`, runtimeMs, appliedFailures));
        return;
      }

      const parsed = tryParseRunnerJson(stdout);
      if (!parsed) {
        resolve(stageResultError(
          stage,
          `Could not parse runner output: ${stdout.trim().slice(0, 200)}`,
          runtimeMs,
          appliedFailures,
        ));
        return;
      }
      resolve({
        stageId: stage.id,
        executorType: stage.executorType,
        status: parsed.passed ? 'passed' : 'failed',
        runtimeMs: parsed.runtime_ms || Math.round(runtimeMs * 100) / 100,
        output: (parsed.output || '').slice(0, 4000),
        error: parsed.error || '',
        failures: appliedFailures,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
      resolve(stageResultError(stage, `Execution error: ${err.message}`, 0, appliedFailures));
    });
  });
}

/**
 * Try to parse the per-tool runner's JSON stdout line. Per-tool
 * runners emit a single JSON line with shape:
 *   { passed, output, error, runtime_ms }
 *
 * Returns the parsed object on success, or null on parse failure.
 */
function tryParseRunnerJson(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    return null;
  }
}

function stageResultError(stage, error, runtimeMs, appliedFailures) {
  return {
    stageId: stage.id,
    executorType: stage.executorType,
    status: 'error',
    runtimeMs: Math.round((runtimeMs || 0) * 100) / 100,
    output: '',
    error: String(error || '').slice(0, 4000),
    failures: appliedFailures || [],
  };
}

module.exports = {
  runPipeline,
  topoSort,
  // Section 11E — exported for unit tests.
  applyFailuresToStage,
  resolveScenarioFailures,
  // Section 11F — exported for unit tests.
  resolveFixtureMounts,
};

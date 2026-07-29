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
// scenario by slug; in 11D (before scenarios exist) we accept null and
// treat it as "no injection". Loaded lazily inside runPipeline() so the
// orchestrator module still parses when PipelineScenario.js doesn't
// exist yet (which is the state of the world up until 11E lands).
let _PipelineScenario = null;
function getScenarioModel() {
  if (_PipelineScenario !== null) return _PipelineScenario;
  try {
    _PipelineScenario = require('../models/PipelineScenario');
  } catch (e) {
    _PipelineScenario = false; // sentinel: not available
  }
  return _PipelineScenario || null;
}

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

    for (const stage of orderedStages) {
      // If an earlier stage failed, downstream stages can't run — the
      // fixtures they expect don't exist. Mark them skipped rather than
      // failing the whole pipeline on a fluke second-stage error.
      if (failedStageId !== null) {
        stageResults.push({
          stageId: stage.id,
          executorType: stage.executorType,
          status: 'skipped',
          runtimeMs: 0,
          output: '',
          error: `upstream stage "${failedStageId}" failed; this stage did not run`,
        });
        pipelinePassed = false;
        continue;
      }

      const stageCodeStr = codeMap.get(stage.id) || '';
      const result = await runSingleStage(stage, stageCodeStr, failures);
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
 * introduces the PipelineScenario model; in 11D the model doesn't exist
 * yet and we always return []. Failures returned here are still
 * ignored in 11D's stage runner (see runSingleStage's TODO); the lookup
 * itself is wired up so 11E only needs to add the application logic.
 */
async function resolveScenarioFailures(problem, scenarioId) {
  if (!scenarioId) return [];
  const Scenario = getScenarioModel();
  if (!Scenario) return []; // 11E hasn't landed yet
  const scenario = await Scenario.findOne({
    pipelineProblemId: problem._id,
    slug: scenarioId,
  });
  if (!scenario) return [];
  return scenario.failures || [];
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
 * Section 11E will read `failures` to apply pre-spawn mutations
 * (memoryMbOverride, fault injection via env vars). 11D ignores
 * failures — they're accepted but no-op until 11E lands.
 */
function runSingleStage(stage, code, failures) {
  const config = getExecutorConfig(stage.executorType);
  const stageMemoryMb = stage.memoryMbOverride || config.memoryMb;
  const stageTimeoutMs = stage.timeoutMsOverride || config.timeout;
  const extension = pickExtension(config.image);

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
      resolve(stageResultError(stage, `could not write stage code: ${e.message}`, 0));
      return;
    }

    let timedOut = false;
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, stageTimeoutMs);

    const dockerArgs = [
      'run', '--rm',
      '--net', 'none',
      '--memory', `${stageMemoryMb}m`,
      '--cpus', '1.0',
      '-v', `${tmpFile}:/sandbox/solution${extension}:ro`,
    ];
    // The in-container path of the user code, fed to buildCmd so each
    // per-tool runner gets it as $1 (or via SUBMISSION_FILE env for the
    // python runners, but they all fall back to /sandbox/solution.<ext>).
    const inContainerPath = `/sandbox/solution${extension}`;
    dockerArgs.push(config.image, ...config.buildCmd(inContainerPath));

    const proc = cp.spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      const runtimeMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

      if (timedOut) {
        resolve(stageResultError(stage, 'Time Limit Exceeded', stageTimeoutMs));
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
          });
          return;
        }
        resolve(stageResultError(stage, cleanedErr || `Exit code: ${exitCode}`, runtimeMs));
        return;
      }

      const parsed = tryParseRunnerJson(stdout);
      if (!parsed) {
        resolve(stageResultError(
          stage,
          `Could not parse runner output: ${stdout.trim().slice(0, 200)}`,
          runtimeMs,
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
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
      resolve(stageResultError(stage, `Execution error: ${err.message}`, 0));
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

function stageResultError(stage, error, runtimeMs) {
  return {
    stageId: stage.id,
    executorType: stage.executorType,
    status: 'error',
    runtimeMs: Math.round((runtimeMs || 0) * 100) / 100,
    output: '',
    error: String(error || '').slice(0, 4000),
  };
}

module.exports = {
  runPipeline,
  topoSort,
};

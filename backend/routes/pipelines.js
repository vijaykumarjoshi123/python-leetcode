/**
 * Pipeline routes — Tier 3 / Section 11D.
 *
 *   POST /api/pipelines/run            — submit a pipeline attempt
 *   GET  /api/pipelines/run/:runId     — fetch a past run (owner-only)
 *
 * Spec:
 *   - JWT auth required for both routes
 *   - User must have pipelineEnabled=true on their record
 *   - Rate-limited per (user, problem) — same Redis pattern as /api/hints
 *     (5 per user per problem per day), but the limit is per problem
 *     rather than per problem+tool since pipelines are tool-agnostic
 *   - Body shape mirrors the orchestrator's input: { pipelineProblemId,
 *     stageCode, scenarioId }
 *   - Returns the persisted PipelineRun document on success
 *
 * Why no queue (yet): the orchestrator already wraps the entire pipeline
 * run in runWithGuard(), which provides the cross-pipeline concurrency
 * cap. A pipeline takes minutes to complete (Spark startup, Kafka KRaft
 * boot, etc.), and the HTTP client can afford to wait — the response
 * carries the full per-stage verdict so the UI can render immediately.
 * If we later need to decouple (so the UI can poll for progress), 11H
 * can introduce a Bull job here. For 11D's MVP, synchronous is fine.
 */

const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const PipelineProblem = require('../models/PipelineProblem');
const PipelineRun = require('../models/PipelineRun');
const PipelineScenario = require('../models/PipelineScenario');
const User = require('../models/User');
const { runPipeline } = require('../services/pipelineOrchestrator');

const router = express.Router();

// Rate limit: same Redis pattern as /api/hints. Pipelined runs are
// expensive (each one can hold a concurrency permit for minutes), so
// the cap is tighter than per-tool runs.
const RATE_LIMIT_PER_DAY = 5;
const RATE_LIMIT_TTL_SECONDS = 86400; // 24h

// Redis client — uses the same connection pattern as the hints route.
// Lazy-loaded so the module parses before Redis connects.
let _redis = null;
function redis() {
  if (_redis) return _redis;
  const IORedis = require('ioredis');
  _redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  _redis.on('error', (err) => {
    // Don't crash the process if Redis is unavailable — degrade to
    // "no rate limit" rather than 500ing every pipeline call.
    console.warn('[pipelines] Redis connection error:', err.message);
  });
  return _redis;
}

// Helper: pull userId from req.user regardless of which field the JWT
// payload uses. Same helper pattern as routes/assessments.js.
function getUserId(req) {
  return (req.user && (req.user.userId || req.user.id)) || null;
}

// Helper: validate an ObjectId-shaped string. Used to reject
// `pipelineProblemId` early so we don't hit the DB with garbage.
function isValidObjectId(s) {
  return typeof s === 'string' && /^[0-9a-fA-F]{24}$/.test(s);
}

// ---- POST /api/pipelines/run ----
router.post('/run', auth, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'unauthenticated' });
  }

  const { pipelineProblemId, stageCode, scenarioId } = req.body || {};

  // Body validation. pipelineProblemId is required and must be
  // ObjectId-shaped; stageCode is optional (a stage with no entry is
  // run with empty code); scenarioId is optional (Section 11E).
  if (!pipelineProblemId) {
    return res.status(400).json({ error: 'pipelineProblemId is required' });
  }
  if (!isValidObjectId(pipelineProblemId)) {
    return res.status(400).json({ error: 'pipelineProblemId is not a valid ObjectId' });
  }
  if (stageCode !== undefined && stageCode !== null && typeof stageCode !== 'object') {
    return res.status(400).json({ error: 'stageCode must be an object or null' });
  }
  if (scenarioId !== undefined && scenarioId !== null && typeof scenarioId !== 'string') {
    return res.status(400).json({ error: 'scenarioId must be a string or null' });
  }

  // ---- User gate: pipelineEnabled must be true ----
  // The feature is opt-in. Existing users default to false so the
  // /api/pipelines endpoints are invisible until an admin flips the flag.
  let user;
  try {
    user = await User.findById(userId);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!user) return res.status(404).json({ error: 'user not found' });
  if (!user.pipelineEnabled) {
    return res.status(403).json({ error: 'pipeline feature not enabled for this user' });
  }

  // ---- Rate limit ----
  // One Redis key per (userId, pipelineProblemId) pair. Caps at 5/day.
  // If Redis is down we degrade gracefully (same as /api/hints).
  const rlKey = `pipelines:${userId}:${pipelineProblemId}`;
  try {
    const r = redis();
    const count = await r.incr(rlKey);
    if (count === 1) {
      await r.expire(rlKey, RATE_LIMIT_TTL_SECONDS);
    }
    if (count > RATE_LIMIT_PER_DAY) {
      return res.status(429).json({
        error: `Rate limit exceeded. ${RATE_LIMIT_PER_DAY} pipeline runs per problem per day.`,
        retryAfterSeconds: await r.ttl(rlKey),
      });
    }
  } catch (err) {
    console.warn('[pipelines] rate-limit check failed:', err.message);
  }

  // ---- Run the pipeline ----
  // The orchestrator handles problem loading, scenario resolution,
  // topo sort, per-stage docker spawning, and persistence. It throws
  // on unrecoverable orchestrator errors (bad problem, etc.) — those
  // surface as 500. Per-stage failures are recorded in the returned
  // document with passed:false.
  try {
    const run = await runPipeline({
      pipelineProblemId,
      userId,
      stageCode: stageCode || {},
      scenarioId: scenarioId || null,
    });
    res.status(201).json(run);
  } catch (err) {
    // Orchestrator threw — could be "problem not found", "user not
    // found", invalid DAG shape, or a docker spawn failure that
    // couldn't even start a container. Bubble up as a 500 with the
    // orchestrator's message; the frontend can show "could not start".
    console.error('[pipelines] runPipeline threw:', err);
    res.status(500).json({ error: err.message || 'pipeline run failed' });
  }
});

// ---- GET /api/pipelines/run/:runId ----
// Owner-only read. Used by the report page (Section 11H) to render
// past run results.
router.get('/run/:runId', auth, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'unauthenticated' });
  }

  const { runId } = req.params;
  if (!isValidObjectId(runId)) {
    return res.status(400).json({ error: 'runId is not a valid ObjectId' });
  }

  let run;
  try {
    run = await PipelineRun.findById(runId);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!run) return res.status(404).json({ error: 'run not found' });

  if (String(run.userId) !== String(userId)) {
    // Don't leak existence — same 404 as for a missing run. The
    // frontend shouldn't render anything distinguishable.
    return res.status(404).json({ error: 'run not found' });
  }

  res.json(run);
});

// ---- GET /api/pipelines/problem/:problemId ----
// Public metadata for a pipeline problem (no fixture paths, no
// expected outputs — those are secrets for 11E/11F). The frontend's
// pipeline problem page (Section 11H) uses this to render the stage
// editor. We expose title/description/difficulty/tracks/stage layout
// (executorType + id + description + dependsOn) but not the user's
// solutions, fixture paths, or expected outputs.
router.get('/problem/:problemId', async (req, res) => {
  const { problemId } = req.params;
  if (!isValidObjectId(problemId)) {
    return res.status(400).json({ error: 'problemId is not a valid ObjectId' });
  }
  let problem;
  try {
    problem = await PipelineProblem.findById(problemId);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!problem) return res.status(404).json({ error: 'problem not found' });

  res.json({
    id: problem._id,
    title: problem.title,
    slug: problem.slug,
    description: problem.description,
    difficulty: problem.difficulty,
    tracks: problem.tracks,
    stages: (problem.stages || []).map((s) => ({
      id: s.id,
      executorType: s.executorType,
      description: s.description,
      dependsOn: s.dependsOn || [],
      entryPoint: s.entryPoint,
      // Strip fields that are not relevant to the UI editor:
      //   - inputFixtures / outputPath / acceptanceCriteria are
      //     internal to the orchestrator and would leak fixture paths
      //     and grading secrets.
    })),
    fixtureVersion: problem.fixtureVersion,
  });
});

// ---- GET /api/pipelines/runs (current user) ----
// Convenience: list the current user's last N pipeline runs (across
// all problems). The frontend's profile/dashboard could use this to
// show recent pipeline activity. Capped to last 20 to keep the
// payload small.
router.get('/runs', auth, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'unauthenticated' });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  try {
    const runs = await PipelineRun.find({ userId })
      .sort({ submittedAt: -1 })
      .limit(limit)
      .select('pipelineProblemId scenarioId stageResults totalRuntimeMs passed error submittedAt');
    res.json({ runs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- GET /api/pipelines/problems ----
// Section 11H — public list of all PipelineProblem metadata. Used by
// the frontend's Pipelines landing/index page (gated by
// user.pipelineEnabled on the navbar link) and the run-history view.
// We expose only the fields safe to render: title/slug/difficulty/
// tracks, plus a count of stages and a count of scenarios (no fixture
// paths or grading secrets). The full stage layout is fetched per-
// problem via /problem/:id when the user opens one.
router.get('/problems', async (req, res) => {
  try {
    const problems = await PipelineProblem.find({})
      .select('title slug description difficulty tracks stages fixtureVersion createdAt')
      .sort({ createdAt: -1 });
    res.json({
      problems: problems.map((p) => ({
        id: p._id,
        title: p.title,
        slug: p.slug,
        description: (p.description || '').slice(0, 280),
        difficulty: p.difficulty,
        tracks: p.tracks || [],
        stageCount: (p.stages || []).length,
        fixtureVersion: p.fixtureVersion,
        createdAt: p.createdAt,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- GET /api/pipelines/problem/:problemId/scenarios ----
// Section 11H — list the failure-injection scenarios seeded for a
// pipeline problem (Section 11E). The frontend's problem page uses
// this to render a "Run with scenario" picker; the user can pick a
// scenario, hit Run, and the orchestrator (Section 11D/11E) applies
// the failures inline. We expose the scenario's slug/name/description
// (so the picker is human-readable) plus a summary of which stage each
// failure targets — the full `params` map is intentionally NOT leaked
// (it can include things like memoryMb for OOM, which would let a
// cheater bypass the diagnosis exercise).
router.get('/problem/:problemId/scenarios', async (req, res) => {
  const { problemId } = req.params;
  if (!isValidObjectId(problemId)) {
    return res.status(400).json({ error: 'problemId is not a valid ObjectId' });
  }
  try {
    const scenarios = await PipelineScenario.find({ pipelineProblemId: problemId })
      .select('slug name description failures expectedDiagnosis')
      .sort({ slug: 1 });
    res.json({
      scenarios: scenarios.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        // Compact the failures[] to a list of {stageId, type} so the
        // UI can render a "Targets: enrich (oom_on_stage)" pill without
        // leaking params like memoryMb / delayHours.
        failures: (s.failures || []).map((f) => ({
          stageId: f.stageId,
          type: f.type,
        })),
        // The expected diagnosis is a hint, not a secret — the user has
        // already committed to the diagnosis exercise by picking the
        // scenario. Surfacing it is intentional.
        expectedDiagnosis: s.expectedDiagnosis || '',
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

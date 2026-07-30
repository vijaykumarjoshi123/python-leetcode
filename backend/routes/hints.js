/**
 * Hints route — POST /api/hints
 *
 * Spec section 7 (single-tool) + Tier 3 / Section 11G (pipeline):
 *   - Body: { problemId, code, executorType, submissionHistory: [...last 3], isPipeline?: bool }
 *   - JWT auth required
 *   - Anthropic SDK call (Claude, Socratic, executor-aware)
 *   - SSE response (text/event-stream)
 *   - Rate limit: 5 hints/user/problem/day via Redis TTL=86400
 *
 * When `isPipeline: true` is passed, the route treats `problemId` as a
 * PipelineProblem id, fetches recent PipelineRun records instead of
 * Submission records, and forwards `stageResults[]` to hintsService so
 * the system prompt can branch on stage-level failures. The existing
 * 7-tool flow is unchanged — `isPipeline` defaults to false.
 */

const express = require('express');
const Problem = require('../models/Problem');
const Submission = require('../models/Submission');
const PipelineProblem = require('../models/PipelineProblem');
const PipelineRun = require('../models/PipelineRun');
const auth = require('../middleware/auth');
const { isValidExecutorType } = require('../services/executorRouter');
const { streamHint } = require('../services/hintsService');

const router = express.Router();

const RATE_LIMIT_PER_DAY = 5;
const RATE_LIMIT_TTL_SECONDS = 86400; // 24h

// Redis client — uses the same connection pattern as the submission queue.
// We import lazily so the route module can be loaded before Redis connects.
let _redis = null;
function redis() {
  if (_redis) return _redis;
  // Re-use the same options the submission queue uses.
  const IORedis = require('ioredis');
  _redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  // Don't crash the process if Redis is unavailable — we'll degrade to
  // "no rate limit" rather than 500ing every hint call.
  _redis.on('error', (err) => {
    console.warn('[hints] Redis connection error:', err.message);
  });
  return _redis;
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Disable Nginx buffering if we're behind one.
  res.setHeader('X-Accel-Buffering', 'no');
}

function sseSend(res, payload) {
  // `payload` is the raw text or a structured object. JSON objects are
  // serialised; text strings go through as-is. Either way, the prefix is
  // `data: ` and the line ends with `\n\n`.
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.write(`data: ${body}\n\n`);
}

router.post('/', auth, async (req, res) => {
  const { problemId, code, executorType, submissionHistory, isPipeline } = req.body || {};
  const userId = req.user && req.user.id;

  if (!userId) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  if (!problemId || typeof code !== 'string') {
    return res.status(400).json({
      error: 'problemId (string) and code (string) are required',
    });
  }
  // Section 11G — when the caller flags a pipeline problem we route to
  // PipelineProblem/PipelineRun and force executorType to 'pipeline'.
  // The single-tool flow (isPipeline falsy) is unchanged: executorType
  // defaults to 'python' for legacy callers.
  const resolvedIsPipeline = isPipeline === true;
  const resolvedExecutorType = resolvedIsPipeline
    ? 'pipeline'
    : (executorType || 'python');
  if (!isValidExecutorType(resolvedExecutorType)) {
    return res.status(400).json({
      error: `invalid executorType "${resolvedExecutorType}"`,
    });
  }

  // ---- Rate limit ----
  // Section 11G — pipeline hints use their own key namespace so the
  // single-tool limit isn't accidentally consumed (the two flows
  // share the same (userId, problemId) shape but problems live in
  // different collections, so a separate prefix prevents cross-pollination).
  const rlKey = resolvedIsPipeline
    ? `hints:pipe:${userId}:${problemId}`
    : `hints:${userId}:${problemId}`;
  try {
    const r = redis();
    const count = await r.incr(rlKey);
    if (count === 1) {
      // First hit — set the TTL so the key expires 24h from the first
      // call, not 24h from the last. Sliding window vs fixed window is
      // not in the spec; this is the simpler fixed-window approach.
      await r.expire(rlKey, RATE_LIMIT_TTL_SECONDS);
    }
    if (count > RATE_LIMIT_PER_DAY) {
      return res.status(429).json({
        error: `Rate limit exceeded. ${RATE_LIMIT_PER_DAY} hints per problem per day.`,
        retryAfterSeconds: await r.ttl(rlKey),
      });
    }
  } catch (err) {
    // If Redis is down we log and continue without rate limiting — better
    // than denying all hints in dev.
    console.warn('[hints] rate-limit check failed:', err.message);
  }

  // ---- Fetch the problem (and merge server-side submission history if
  // the client didn't supply it) ----
  let problem;
  try {
    // Section 11G — pipeline flow loads from PipelineProblem; single-tool
    // flow still loads from Problem. The two collections are isolated,
    // so a problemId in one will simply 404 in the other.
    problem = resolvedIsPipeline
      ? await PipelineProblem.findById(problemId)
      : await Problem.findById(problemId);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!problem) {
    return res.status(404).json({ error: 'problem not found' });
  }

  // Trust the client-supplied history but trim to the spec's 3-attempt
  // window. If absent, fall back to a Mongo lookup so the prompt still has
  // context.
  let history = Array.isArray(submissionHistory) ? submissionHistory.slice(-3) : null;
  if (!history || history.length === 0) {
    history = resolvedIsPipeline
      ? await loadPipelineHistory(userId, problemId)
      : await loadSingleToolHistory(userId, problemId);
  }

  // ---- SSE response ----
  sseHeaders(res);
  res.flushHeaders?.();

  // If the client closes the connection early, abort the stream so we
  // don't burn tokens for a disconnected user.
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  try {
    for await (const chunk of streamHint({
      problem,
      code,
      executorType: resolvedExecutorType,
      submissionHistory: history,
    })) {
      if (aborted) break;
      if (chunk && typeof chunk.text === 'string') {
        sseSend(res, { text: chunk.text });
      }
    }
    sseSend(res, { done: true });
  } catch (err) {
    // Surface the error as an SSE event so the UI can render it; do NOT
    // throw — we already started streaming and the headers are gone.
    sseSend(res, { error: err.message || 'hint stream failed' });
  } finally {
    res.end();
  }
});

/**
 * Section 11G — load the user's last 3 PipelineRun records and shape
 * them into the same {status, runtime, error, ...} contract that the
 * single-tool history uses, but with `stageResults[]` attached so the
 * service can surface a specific failing stage. failures[] on each
 * stage is serialised back to a plain object (MongoDB Map→Object
 * already happens on read, but we keep it explicit for clarity).
 */
async function loadPipelineHistory(userId, pipelineProblemId) {
  try {
    const recent = await PipelineRun.find({ userId, pipelineProblemId })
      .sort({ submittedAt: -1 })
      .limit(3)
      .select('stageResults totalRuntimeMs passed scenarioId submittedAt');
    return recent.map((r) => ({
      status: r.passed ? 'passed' : 'failed',
      runtime: r.totalRuntimeMs,
      error: '',
      executorType: 'pipeline',
      // toolVersion isn't meaningful at the pipeline level — leave empty.
      toolVersion: '',
      stageResults: (r.stageResults || []).map((sr) => ({
        stageId: sr.stageId,
        executorType: sr.executorType,
        status: sr.status,
        error: sr.error || '',
        // Serialise Mongoose Map params to a plain object so the
        // service can index by key without going through schema APIs.
        failures: (sr.failures || []).map((f) => ({
          type: f.type,
          applied: f.applied,
          note: f.note || '',
          params: f.params instanceof Map
            ? Object.fromEntries(f.params)
            : (f.params || {}),
        })),
      })),
      scenarioId: r.scenarioId || '',
    }));
  } catch (err) {
    console.warn('[hints] pipeline history lookup failed:', err.message);
    return [];
  }
}

/**
 * Existing single-tool history lookup, unchanged from before Section 11G.
 * Pulled into a named helper so the route handler reads as a straight-
 * line dispatch.
 */
async function loadSingleToolHistory(userId, problemId) {
  try {
    const recent = await Submission.find({ userId, problemId })
      .sort({ submittedAt: -1 })
      .limit(3)
      .select('status runtime error executorType toolVersion submittedAt');
    return recent.map((s) => ({
      status: s.status,
      runtime: s.runtime,
      error: s.error,
      executorType: s.executorType,
      toolVersion: s.toolVersion,
    }));
  } catch {
    return [];
  }
}

module.exports = router;

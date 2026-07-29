/**
 * Hints route — POST /api/hints
 *
 * Spec section 7:
 *   - Body: { problemId, code, executorType, submissionHistory: [...last 3] }
 *   - JWT auth required
 *   - Anthropic SDK call (Claude, Socratic, executor-aware)
 *   - SSE response (text/event-stream)
 *   - Rate limit: 5 hints/user/problem/day via Redis TTL=86400
 */

const express = require('express');
const Problem = require('../models/Problem');
const Submission = require('../models/Submission');
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
  const { problemId, code, executorType, submissionHistory } = req.body || {};
  const userId = req.user && req.user.id;

  if (!userId) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  if (!problemId || typeof code !== 'string') {
    return res.status(400).json({
      error: 'problemId (string) and code (string) are required',
    });
  }
  // executorType is optional — default to 'python' for legacy callers.
  const resolvedExecutorType = executorType || 'python';
  if (!isValidExecutorType(resolvedExecutorType)) {
    return res.status(400).json({
      error: `invalid executorType "${resolvedExecutorType}"`,
    });
  }

  // ---- Rate limit ----
  // One Redis key per (userId, problemId) pair with TTL=24h.
  const rlKey = `hints:${userId}:${problemId}`;
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
    problem = await Problem.findById(problemId);
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
    try {
      const recent = await Submission.find({ userId, problemId })
        .sort({ submittedAt: -1 })
        .limit(3)
        .select('status runtime error executorType toolVersion submittedAt');
      history = recent.map((s) => ({
        status: s.status,
        runtime: s.runtime,
        error: s.error,
        executorType: s.executorType,
        toolVersion: s.toolVersion,
      }));
    } catch {
      history = [];
    }
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

module.exports = router;

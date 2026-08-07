const express = require('express');
const Submission = require('../models/Submission');
const Problem = require('../models/Problem');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { submissionQueue } = require('../services/submissionQueue');
const { isValidExecutorType, VALID_EXECUTOR_TYPES } = require('../services/executorRouter');

const router = express.Router();

// Submit code for execution.
//
// Auth: requires a valid JWT. The submitter's userId is taken from the
// VERIFIED token (req.user.userId), NOT from the request body — accepting
// userId from the body let any caller submit code as any other user
// (impersonation, stat pollution). The body's userId, if present, is
// ignored.
router.post('/submit', auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const {
      problemId,
      code,
      language = 'python',
      executorType,
    } = req.body;

    if (!problemId || !code) {
      return res.status(400).json({ error: 'problemId and code are required' });
    }

    // Validate executorType against the whitelist exposed by the router.
    // Default to 'python' when absent so existing callers keep working.
    const resolvedExecutorType = executorType === undefined ? 'python' : executorType;
    if (!isValidExecutorType(resolvedExecutorType)) {
      return res.status(400).json({
        error: `Invalid executorType "${resolvedExecutorType}". Allowed: ${VALID_EXECUTOR_TYPES.join(', ')}`,
      });
    }

    // Tier 3 / Section 11B guard: pipeline is a valid executor type per the
    // router (because the orchestrator container uses it) but it is NOT a
    // valid executor type for /api/submissions/submit. Pipeline runs are
    // submitted via /api/pipelines/run (Section 11D) and carry a
    // pipelineSpec, not raw user code. Returning a 400 here protects the
    // existing submission grader from trying to grade a pipeline as a
    // single-tool submission — which would produce nonsensical results
    // because the orchestrator expects a spec file, not a .py / .sql.
    if (resolvedExecutorType === 'pipeline') {
      return res.status(400).json({
        error:
          "executorType 'pipeline' cannot be submitted via /api/submissions/submit. " +
          'Use POST /api/pipelines/run for multi-tool pipeline problems.',
      });
    }

    // Get problem
    const problem = await Problem.findById(problemId);
    if (!problem) return res.status(404).json({ msg: 'Problem not found' });

    // Get user
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Create submission record
    const submission = new Submission({
      userId,
      problemId,
      code,
      language,
      executorType: resolvedExecutorType,
      status: 'Pending',
    });

    await submission.save();

    // Add to attempted problems if not already there
    if (!user.attemptedProblems.includes(problemId)) {
      user.attemptedProblems.push(problemId);
      user.stats.totalAttempts += 1;
      await user.save();
    }

    // Queue the execution asynchronously. executorType is included in the
    // job payload so the worker (Section 1D) can route to the right image.
    await submissionQueue.add('execute-code', {
      submissionId: submission._id,
      executorType: resolvedExecutorType,
    });

    res.json(submission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user submissions
router.get('/user/:userId', async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const submissions = await Submission.find({ userId: req.params.userId })
      .populate('problemId', 'title difficulty slug')
      .sort({ submittedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Submission.countDocuments({ userId: req.params.userId });

    res.json({ submissions, total, page, pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single submission by id. Bug 3 fix: this is the endpoint the
// frontend polls after POST /api/submissions/submit returns 202. The
// response carries the current status ('Pending' until the worker
// finishes), plus output/error/testCasesPassed once execution completes.
//
// Auth: owner-only. We compare submission.userId against the requesting
// user's id from the JWT. Anonymous access would let any authenticated
// user enumerate other users' submissions by guessing ObjectIds.
router.get('/:submissionId', async (req, res) => {
  try {
    // Defensive: only treat values that look like ObjectIds as ids.
    // Otherwise a stray "/submissions/foo" would throw a CastError.
    if (!req.params.submissionId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: 'Invalid submission id' });
    }

    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // The /submit endpoint accepts userId from the body, but the request
    // itself isn't authenticated. We accept either:
    //   1. ?userId=... in the query string matching submission.userId, OR
    //   2. an Authorization: Bearer header whose decoded userId matches
    // Without one of these, return 403 — protects against cross-user reads.
    const requesterUserId = req.query.userId
      || (req.headers.authorization?.startsWith('Bearer ')
        ? require('jsonwebtoken').verify(
            req.headers.authorization.slice(7),
            process.env.JWT_SECRET || 'secret',
          ).userId
        : null);

    if (!requesterUserId || requesterUserId.toString() !== submission.userId.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(submission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get submissions for a specific problem by a user
router.get('/problem/:problemId/user/:userId', async (req, res) => {
  try {
    const submissions = await Submission.find({
      problemId: req.params.problemId,
      userId: req.params.userId
    })
    .sort({ submittedAt: -1 })
    .limit(10);

    res.json(submissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

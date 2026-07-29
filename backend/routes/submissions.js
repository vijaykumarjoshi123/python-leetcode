const express = require('express');
const Submission = require('../models/Submission');
const Problem = require('../models/Problem');
const User = require('../models/User');
const { submissionQueue } = require('../services/submissionQueue');
const { isValidExecutorType, VALID_EXECUTOR_TYPES } = require('../services/executorRouter');

const router = express.Router();

// Submit code for execution
router.post('/submit', async (req, res) => {
  try {
    const {
      userId,
      problemId,
      code,
      language = 'python',
      executorType,
    } = req.body;

    if (!userId || !problemId || !code) {
      return res.status(400).json({ error: 'userId, problemId, and code are required' });
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

const express = require('express');
const Submission = require('../models/Submission');
const Problem = require('../models/Problem');
const User = require('../models/User');
const { executeCode } = require('../services/pythonExecutor');

const router = express.Router();

const express = require('express');
const Submission = require('../models/Submission');
const Problem = require('../models/Problem');
const User = require('../models/User');
const { submissionQueue } = require('../services/submissionQueue');

const router = express.Router();

// Submit code for execution
router.post('/submit', async (req, res) => {
  try {
    const { userId, problemId, code, language = 'python' } = req.body;

    if (!userId || !problemId || !code) {
      return res.status(400).json({ error: 'userId, problemId, and code are required' });
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
      status: 'Pending'
    });

    await submission.save();

    // Add to attempted problems if not already there
    if (!user.attemptedProblems.includes(problemId)) {
      user.attemptedProblems.push(problemId);
      user.stats.totalAttempts += 1;
      await user.save();
    }

    // Queue the execution asynchronously
    await submissionQueue.add('execute-code', { submissionId: submission._id });

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
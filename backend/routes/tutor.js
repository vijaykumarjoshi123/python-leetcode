const express = require('express');
const { getAIHint } = require('../services/aiTutor');
const Problem = require('../models/Problem');
const Submission = require('../models/Submission');
const auth = require('../middleware/auth');

const router = express.Router();

// Get an AI-powered hint for a problem
router.post('/hint', auth, async (req, res) => {
  try {
    const { problemId, code } = req.body;
    const userId = req.user.id;

    if (!problemId || !code) {
      return res.status(400).json({ error: 'problemId and code are required' });
    }

    const problem = await Problem.findById(problemId);
    if (!problem) return res.status(404).json({ msg: 'Problem not found' });

    // Get the user's last 3 submissions for this problem to provide context
    const history = await Submission.find({ userId, problemId })
      .sort({ submittedAt: -1 })
      .limit(3);

    const aiResponse = await getAIHint(problem, code, history);
    
    res.json(aiResponse);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

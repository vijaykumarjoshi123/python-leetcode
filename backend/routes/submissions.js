const express = require('express');
const Submission = require('../models/Submission');
const Problem = require('../models/Problem');
const User = require('../models/User');
const axios = require('axios');

const router = express.Router();

// Submit code for execution
router.post('/submit', async (req, res) => {
  try {
    const { userId, problemId, code, language = 'python' } = req.body;
    
    // Get problem
    const problem = await Problem.findById(problemId);
    if (!problem) return res.status(404).json({ msg: 'Problem not found' });
    
    // Create submission record
    const submission = new Submission({
      userId,
      problemId,
      code,
      language,
      status: 'Pending'
    });
    
    await submission.save();
    
    // Execute code against test cases (using JDoodle or similar)
    try {
      const result = await executeCode(code, problem.testCases);
      
      let passed = 0;
      let accepted = true;
      
      for (let i = 0; i < result.length; i++) {
        if (result[i].passed) passed++;
        else accepted = false;
      }
      
      submission.status = accepted ? 'Accepted' : 'Wrong Answer';
      submission.testCasesPassed = passed;
      submission.totalTestCases = problem.testCases.length;
      submission.output = JSON.stringify(result);
      
      // Update user stats
      if (accepted) {
        const user = await User.findById(userId);
        if (!user.solvedProblems.includes(problemId)) {
          user.solvedProblems.push(problemId);
          user.stats.totalSolved += 1;
          
          if (problem.difficulty === 'Easy') user.stats.easyCount += 1;
          else if (problem.difficulty === 'Medium') user.stats.mediumCount += 1;
          else if (problem.difficulty === 'Hard') user.stats.hardCount += 1;
          
          await user.save();
        }
      }
      
      problem.submissions += 1;
      if (submission.status === 'Accepted') problem.accepted += 1;
      problem.acceptanceRate = (problem.accepted / problem.submissions * 100).toFixed(2);
      await problem.save();
      
    } catch (err) {
      submission.status = 'Runtime Error';
      submission.error = err.message;
    }
    
    await submission.save();
    res.json(submission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user submissions
router.get('/user/:userId', async (req, res) => {
  try {
    const submissions = await Submission.find({ userId: req.params.userId })
      .populate('problemId', 'title difficulty')
      .sort({ submittedAt: -1 });
    
    res.json(submissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper function to execute code (simplified)
async function executeCode(code, testCases) {
  // This would integrate with an online code execution service like JDoodle
  // For now, returning mock results
  return testCases.map(tc => ({
    input: tc.input,
    expected: tc.output,
    passed: true // Simplified for demo
  }));
}

module.exports = router;

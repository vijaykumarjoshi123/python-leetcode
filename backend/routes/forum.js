const express = require('express');
const Discussion = require('../models/Discussion');

const router = express.Router();

// Get discussions for a problem
router.get('/problem/:problemId', async (req, res) => {
  try {
    const discussions = await Discussion.find({ problemId: req.params.problemId })
      .populate('userId', 'username avatar')
      .populate('comments.userId', 'username avatar')
      .sort({ updatedAt: -1 });
    
    res.json(discussions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create discussion
router.post('/', async (req, res) => {
  try {
    const { problemId, userId, title } = req.body;
    
    const discussion = new Discussion({
      problemId,
      userId,
      title,
      comments: []
    });
    
    await discussion.save();
    res.json(discussion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add comment to discussion
router.post('/:discussionId/comment', async (req, res) => {
  try {
    const { userId, content } = req.body;
    
    const discussion = await Discussion.findById(req.params.discussionId);
    if (!discussion) return res.status(404).json({ msg: 'Discussion not found' });
    
    discussion.comments.push({
      userId,
      content,
      replies: []
    });
    
    discussion.updatedAt = new Date();
    await discussion.save();
    
    res.json(discussion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Like comment
router.put('/comment/:commentId/like', async (req, res) => {
  try {
    res.json({ msg: 'Comment liked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

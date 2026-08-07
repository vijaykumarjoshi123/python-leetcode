const express = require('express');
const Discussion = require('../models/Discussion');
const auth = require('../middleware/auth');

const router = express.Router();

// Get discussions for a problem (public — reading doesn't require auth).
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

// Create discussion.
// Auth required: userId comes from the verified token, NOT the body, so a
// caller can't forge a discussion under another user's identity.
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { problemId, title } = req.body;

    if (!problemId || !title) {
      return res.status(400).json({ error: 'problemId and title are required' });
    }

    const discussion = new Discussion({
      problemId,
      userId,
      title,
      comments: []
    });

    await discussion.save();
    res.status(201).json(discussion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add comment to discussion. Auth required; userId from token.
router.post('/:discussionId/comment', auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

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

// Like (or unlike) a comment. Auth required.
//
// Comments are nested inside Discussion.comments, so we locate the parent
// discussion via the comment id, then increment the matched comment's
// `likes`. Returns the new like count so the UI can update optimistically.
// Previously this was a stub that always returned 200 without persisting.
router.put('/comment/:commentId/like', auth, async (req, res) => {
  try {
    const { commentId } = req.params;
    const discussion = await Discussion.findOne({ 'comments._id': commentId });
    if (!discussion) return res.status(404).json({ error: 'Comment not found' });

    const comment = discussion.comments.id(commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    comment.likes = (comment.likes || 0) + 1;
    await discussion.save();

    res.json({ msg: 'Comment liked', likes: comment.likes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

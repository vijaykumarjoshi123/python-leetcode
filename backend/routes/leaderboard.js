const express = require('express');
const User = require('../models/User');

const router = express.Router();

// Get global leaderboard
router.get('/', async (req, res) => {
  try {
    const { limit = 100, page = 1 } = req.query;
    
    const skip = (page - 1) * limit;
    
    const leaderboard = await User.find()
      .select('-password')
      .sort({ 'stats.totalSolved': -1 })
      .limit(parseInt(limit))
      .skip(skip);
    
    const total = await User.countDocuments();
    
    // Add rank to each user
    const rankedUsers = leaderboard.map((user, idx) => ({
      ...user.toObject(),
      rank: skip + idx + 1
    }));
    
    res.json({ users: rankedUsers, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user rank and stats
router.get('/user/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    
    // Get user's rank
    const rank = await User.countDocuments({
      'stats.totalSolved': { $gt: user.stats.totalSolved }
    }) + 1;
    
    res.json({ ...user.toObject(), rank });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get difficulty-based leaderboard
router.get('/difficulty/:difficulty', async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const difficulty = req.params.difficulty; // Easy, Medium, Hard
    
    const key = difficulty.toLowerCase() + 'Count';
    const skip = (page - 1) * limit;
    
    const leaderboard = await User.find()
      .select('-password')
      .sort({ [`stats.${key}`]: -1 })
      .limit(parseInt(limit))
      .skip(skip);
    
    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

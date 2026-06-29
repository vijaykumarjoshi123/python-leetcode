const express = require('express');
const Problem = require('../models/Problem');

const router = express.Router();

// Get categories (must be before /:id)
router.get('/categories', async (req, res) => {
  try {
    const categories = await Problem.distinct('category');
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all problems with filters
router.get('/', async (req, res) => {
  try {
    const { difficulty, category, search, limit = 20, page = 1 } = req.query;

    let query = {};
    if (difficulty) query.difficulty = difficulty;
    if (category) query.category = category;
    if (search) query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const problems = await Problem.find(query)
      .limit(parseInt(limit))
      .skip(skip)
      .select('-testCases -solution.code')
      .sort({ createdAt: -1 });

    const total = await Problem.countDocuments(query);

    res.json({ problems, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single problem (must be after /categories and /)
router.get('/:id', async (req, res) => {
  try {
    // Validate ObjectId format
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ msg: 'Invalid problem ID' });
    }
    const problem = await Problem.findById(req.params.id);
    if (!problem) return res.status(404).json({ msg: 'Problem not found' });

    res.json(problem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
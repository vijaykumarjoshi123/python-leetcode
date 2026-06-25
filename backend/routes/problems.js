const express = require('express');
const Problem = require('../models/Problem');

const router = express.Router();

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
    
    const skip = (page - 1) * limit;
    const problems = await Problem.find(query)
      .limit(parseInt(limit))
      .skip(skip)
      .select('-testCases -solution.code'); // Don't send full test cases or solutions
    
    const total = await Problem.countDocuments(query);
    
    res.json({ problems, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single problem
router.get('/:id', async (req, res) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) return res.status(404).json({ msg: 'Problem not found' });
    
    res.json(problem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get categories
router.get('/categories', async (req, res) => {
  try {
    const categories = await Problem.distinct('category');
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

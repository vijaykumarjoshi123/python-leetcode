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
    const { difficulty, category, search, track, limit = 20, page = 1 } = req.query;

    let query = {};
    if (difficulty) query.difficulty = difficulty;
    if (category) query.category = category;
    // Additional Change 3: server-side track filter so a deep link like
    // /problems?track=data-engineering works without depending on the
    // client-side filter (which only runs after fetching everything).
    if (track) query.track = track;
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
//
// Security: the detail endpoint MUST NOT leak grading secrets. We project
// out:
//   - solution.code        (the reference answer — users solve the problem
//                            themselves; the explanation/complexity are
//                            safe to show in a post-solve "Solution" tab)
//   - hiddenTestCases      (secret grading inputs/outputs)
// and we filter testCases to only the visible ones (some problems store
// hidden cases inside testCases with visible:false). Previously this
// returned the full document to anonymous callers, disclosing every
// problem's answer.
router.get('/:id', async (req, res) => {
  try {
    // Validate ObjectId format
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ msg: 'Invalid problem ID' });
    }
    const problem = await Problem.findById(req.params.id)
      .select('-hiddenTestCases -solution.code');
    if (!problem) return res.status(404).json({ msg: 'Problem not found' });

    // Defensively drop any non-visible test cases (the schema allows
    // visible:false entries inside testCases too). toObject so we can
    // mutate before serialising.
    const doc = problem.toObject();
    if (Array.isArray(doc.testCases)) {
      doc.testCases = doc.testCases.filter((tc) => tc.visible !== false);
    }

    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
const mongoose = require('mongoose');
const { VALID_EXECUTOR_TYPES } = require('../services/executorRouter');

const VALID_TRACKS = ['foundations', 'data-engineering', 'streaming', 'orchestration', 'lakehouse'];

const problemSchema = new mongoose.Schema({
  title: { type: String, required: true, unique: true },
  slug: { type: String, unique: true, required: true },
  description: { type: String, required: true },
  difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], required: true },
  category: { type: String, required: true }, // Arrays, Strings, Trees, etc.
  executorType: {
    type: String,
    enum: VALID_EXECUTOR_TYPES,
    default: 'python',
    required: true,
  },
  track: {
    type: String,
    enum: VALID_TRACKS,
    default: 'foundations',
  },
  starterCode: {
    // Map<executorType, boilerplateString>. Keyed by executorType so the
    // editor can pre-fill the right boilerplate per tool (e.g. pyspark
    // boilerplate for spark problems, SQL for sql/dbt problems).
    type: Map,
    of: String,
  },
  evaluationScript: { type: String }, // path or inline script that validates output correctness
  examples: [{
    input: String,
    output: String,
    explanation: String
  }],
  constraints: String,
  hints: [String],
  solution: {
    explanation: String,
    code: String,
    complexity: {
      time: String,
      space: String
    }
  },
  testCases: [{
    input: String,
    output: String,
    visible: { type: Boolean, default: true }
  }],
  // Test cases not shown to the user before they submit. Runner uses these
  // alongside the visible ones (which stay in `testCases` for hints/examples).
  hiddenTestCases: [{
    input: String,
    output: String,
    visible: { type: Boolean, default: false }
  }],
  submissions: { type: Number, default: 0 },
  accepted: { type: Number, default: 0 },
  acceptanceRate: { type: Number, default: 0 },
  tags: [String],
  likes: { type: Number, default: 0 },
  dislikes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Problem', problemSchema);

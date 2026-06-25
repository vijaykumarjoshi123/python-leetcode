const mongoose = require('mongoose');

const problemSchema = new mongoose.Schema({
  title: { type: String, required: true, unique: true },
  slug: { type: String, unique: true, required: true },
  description: { type: String, required: true },
  difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], required: true },
  category: { type: String, required: true }, // Arrays, Strings, Trees, etc.
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
  submissions: { type: Number, default: 0 },
  accepted: { type: Number, default: 0 },
  acceptanceRate: { type: Number, default: 0 },
  tags: [String],
  likes: { type: Number, default: 0 },
  dislikes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Problem', problemSchema);

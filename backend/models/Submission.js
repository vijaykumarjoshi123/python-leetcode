const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
  code: { type: String, required: true },
  language: { type: String, default: 'python' },
  status: {
    type: String,
    enum: ['Accepted', 'Wrong Answer', 'Time Limit Exceeded', 'Runtime Error', 'Pending'],
    default: 'Pending'
  },
  runtime: { type: Number }, // in ms
  gpuRuntime: { type: Number }, // GPU specific runtime for acceleration tracking
  memory: { type: Number }, // in MB
  output: String,
  error: String,
  testCasesPassed: { type: Number, default: 0 },
  totalTestCases: { type: Number, default: 0 },
  submittedAt: { type: Date, default: Date.now },
  executionTime: Number
});

module.exports = mongoose.model('Submission', submissionSchema);

const mongoose = require('mongoose');
const { VALID_EXECUTOR_TYPES } = require('../services/executorRouter');

const submissionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
  code: { type: String, required: true },
  language: { type: String, default: 'python' },
  executorType: {
    type: String,
    enum: VALID_EXECUTOR_TYPES,
    default: 'python',
  },
  toolVersion: { type: String },       // e.g. "PySpark 3.5", "dbt 1.7", "Kafka 3.7"
  executionRuntime: { type: Number },  // wall-clock ms from Docker start to result
  status: {
    type: String,
    enum: ['Accepted', 'Wrong Answer', 'Time Limit Exceeded', 'Runtime Error', 'Queue Full', 'Pending'],
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

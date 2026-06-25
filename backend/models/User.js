const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' },
  bio: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  stats: {
    totalSolved: { type: Number, default: 0 },
    totalAttempts: { type: Number, default: 0 },
    easyCount: { type: Number, default: 0 },
    mediumCount: { type: Number, default: 0 },
    hardCount: { type: Number, default: 0 }
  },
  solvedProblems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Problem' }],
  attemptedProblems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Problem' }]
});

module.exports = mongoose.model('User', userSchema);

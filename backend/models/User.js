const mongoose = require('mongoose');

const VALID_TRACKS = ['foundations', 'data-engineering', 'streaming', 'orchestration', 'lakehouse'];

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' },
  bio: { type: String, default: '' },
  // Distinguishes individual users from company accounts. Companies own
  // assessments; individuals can be invited as candidates. Spec 8A: "company
  // account type" — modelled as a string field with two values for now.
  // A separate `Company` collection is overkill for the schema as described.
  accountType: {
    type: String,
    enum: ['individual', 'company'],
    default: 'individual',
  },
  // Company display name. Only meaningful when accountType === 'company'.
  companyName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  stats: {
    totalSolved: { type: Number, default: 0 },
    totalAttempts: { type: Number, default: 0 },
    easyCount: { type: Number, default: 0 },
    mediumCount: { type: Number, default: 0 },
    hardCount: { type: Number, default: 0 }
  },
  // Track-aware solve counts. Powers the per-track profile radar and the
  // certificate eligibility check. Keys mirror VALID_TRACKS but are spelled
  // out so Mongoose picks them up as proper schema paths (dynamic keys via
  // [key] would still work but are less greppable).
  solvedByTrack: {
    foundations: { type: Number, default: 0 },
    'data-engineering': { type: Number, default: 0 },
    streaming: { type: Number, default: 0 },
    orchestration: { type: Number, default: 0 },
    lakehouse: { type: Number, default: 0 },
  },
  certificates: [{
    track: { type: String, enum: VALID_TRACKS },
    awardedAt: { type: Date },
    problemCount: { type: Number },
  }],
  solvedProblems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Problem' }],
  attemptedProblems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Problem' }]
});

module.exports = mongoose.model('User', userSchema);

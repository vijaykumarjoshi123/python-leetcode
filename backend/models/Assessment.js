const mongoose = require('mongoose');

/**
 * Assessment — a company-owned test sent to invited candidates. Spec 8A.
 *
 * Lifecycle:
 *   1. A company user (User.accountType === 'company') creates an
 *      assessment referencing a set of Problem documents.
 *   2. The company adds invitedCandidates via POST /invite. Each entry gets
 *      a single-use UUID token (the invite link).
 *   3. A candidate opens the link (GET /api/assessments/join/:token), which
 *      marks their entry 'started' and returns the problem set.
 *   4. The candidate submits code through the existing /api/submissions
 *      pipeline; nothing changes there — we just query those submissions
 *      later to score the candidate.
 *   5. When the candidate finishes (or expiresAt passes), the entry's status
 *      moves to 'completed' / 'expired'. The company then views the
 *      per-candidate report via GET /:id/report.
 *
 * Note on scoring: this model does NOT duplicate submission data. Reports
 * are derived from the Submission collection at view time. That keeps
 * stored state minimal and avoids drift if a candidate re-submits.
 */
const assessmentSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  problemIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Problem',
    required: true,
  }],
  invitedCandidates: [{
    email: { type: String, required: true },
    // Single-use invite link token. Consumed once when the candidate opens
    // GET /api/assessments/join/:token. We do not hash this — we compare
    // by exact match and then mark consumed.
    token: { type: String, required: true, index: true, unique: true },
    status: {
      type: String,
      enum: ['invited', 'started', 'completed', 'expired'],
      default: 'invited',
    },
    // Optional: link the candidate to an existing User document when they
    // register with the matching email. Lets the report show their
    // username instead of just the email.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    invitedAt: { type: Date, default: Date.now },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  }],
  // Optional: when non-null, the assessment must be finished within this
  // many minutes from startedAt. null means untimed.
  timeLimit: { type: Number, default: null },
  // Hard expiry for the entire assessment — even untimed ones can't be
  // joined past this date.
  expiresAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

// Marks expired candidates on read. Cheaper than a cron for this MVP.
assessmentSchema.methods.markExpiredCandidates = function () {
  if (!this.expiresAt) return;
  const now = new Date();
  if (now < this.expiresAt) return;
  for (const c of this.invitedCandidates) {
    if (c.status === 'invited' || c.status === 'started') {
      c.status = 'expired';
    }
  }
};

module.exports = mongoose.model('Assessment', assessmentSchema);

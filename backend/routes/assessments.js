/**
 * Assessments route — Spec 8B.
 *
 *   POST   /api/assessments              — create (company auth required)
 *   GET    /api/assessments              — list company's assessments
 *   GET    /api/assessments/:id          — assessment detail + candidates
 *   POST   /api/assessments/:id/invite   — add candidate emails, generate tokens
 *   GET    /api/assessments/join/:token  — candidate uses token (public)
 *   GET    /api/assessments/:id/report   — per-candidate score report
 *
 * The :id report and the company-only routes are gated by a middleware
 * that resolves the assessment and confirms the caller is the owning
 * company. The public /join/:token route only reveals the problem IDs
 * (no company secrets) and marks the candidate's status.
 */

const express = require('express');
const crypto = require('crypto');
const Assessment = require('../models/Assessment');
const Problem = require('../models/Problem');
const Submission = require('../models/Submission');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { sendInviteEmail } = require('../services/emailService');

const router = express.Router();

// Helper: pull userId from req.user regardless of which field the JWT
// payload uses. Existing code reads req.user.id (which is undefined on the
// current payload shape {userId}); new code accepts both.
function getUserId(req) {
  return (req.user && (req.user.userId || req.user.id)) || null;
}

// Middleware: load the assessment and confirm the caller owns it. Used by
// company-only routes. Attaches the assessment as req.assessment.
async function loadOwnedAssessment(req, res, next) {
  const id = req.params.id;
  if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
    return res.status(400).json({ error: 'invalid assessment id' });
  }
  const assessment = await Assessment.findById(id);
  if (!assessment) return res.status(404).json({ error: 'assessment not found' });

  const userId = getUserId(req);
  if (String(assessment.companyId) !== String(userId)) {
    return res.status(403).json({ error: 'not your assessment' });
  }
  req.assessment = assessment;
  next();
}

// Middleware: require accountType === 'company'. For create + invite.
function requireCompany(req, res, next) {
  User.findById(getUserId(req))
    .then((u) => {
      if (!u) return res.status(401).json({ error: 'user not found' });
      if (u.accountType !== 'company') {
        return res.status(403).json({ error: 'company account required' });
      }
      req.company = u;
      next();
    })
    .catch((err) => res.status(500).json({ error: err.message }));
}

// ---- POST /api/assessments — create ----
router.post('/', auth, requireCompany, async (req, res) => {
  try {
    const { title, description, problemIds, timeLimit, expiresAt } = req.body || {};
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!Array.isArray(problemIds) || problemIds.length === 0) {
      return res.status(400).json({ error: 'problemIds must be a non-empty array' });
    }
    // Validate each problem exists. Saves us from a dangling-ref later.
    const found = await Problem.find({ _id: { $in: problemIds } }, '_id');
    if (found.length !== problemIds.length) {
      return res.status(400).json({
        error: 'one or more problemIds do not exist',
        missing: problemIds.filter((p) => !found.find((f) => String(f._id) === String(p))),
      });
    }
    const assessment = new Assessment({
      companyId: getUserId(req),
      title,
      description: description || '',
      problemIds,
      timeLimit: typeof timeLimit === 'number' ? timeLimit : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });
    await assessment.save();
    res.status(201).json(assessment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/assessments — list company's assessments ----
router.get('/', auth, requireCompany, async (req, res) => {
  try {
    const assessments = await Assessment.find({ companyId: getUserId(req) })
      .sort({ createdAt: -1 })
      // Light projection so the list view stays snappy.
      .select('title description problemIds timeLimit expiresAt createdAt invitedCandidates.email invitedCandidates.status invitedCandidates.invitedAt');
    res.json({ assessments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/assessments/:id — detail + candidates ----
router.get('/:id', auth, loadOwnedAssessment, async (req, res) => {
  req.assessment.markExpiredCandidates();
  await req.assessment.save().catch(() => {});
  res.json(req.assessment);
});

// ---- POST /api/assessments/:id/invite — add candidates, generate tokens ----
router.post('/:id/invite', auth, loadOwnedAssessment, async (req, res) => {
  try {
    const { emails } = req.body || {};
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'emails must be a non-empty array' });
    }
    // INVITE_BASE_URL lets companies point candidates at their deployed
    // frontend rather than localhost. Falls back to a sensible default so
    // dev still works.
    const baseUrl = process.env.INVITE_BASE_URL || 'http://localhost:3000';
    const tokens = [];
    for (const email of emails) {
      if (typeof email !== 'string' || !email.includes('@')) continue;
      // 32-byte hex token = 64 chars; UUID-shaped for sharing in URLs.
      const token = crypto.randomBytes(16).toString('hex');
      req.assessment.invitedCandidates.push({
        email,
        token,
        status: 'invited',
        invitedAt: new Date(),
      });
      tokens.push({ email, token });
    }
    await req.assessment.save();

    // Best-effort email send — we never fail the request if SMTP is
    // down. Each token gets its own send; failures are recorded per-row
    // so the caller can see which invites need manual handling.
    const results = await Promise.all(
      tokens.map(async (t) => {
        const url = `${baseUrl}/assessments/join/${t.token}`;
        const sendResult = await sendInviteEmail(
          t.email,
          req.assessment.title,
          url
        );
        return {
          ...t,
          inviteUrl: url,
          email: sendResult,
        };
      })
    );
    res.status(201).json({ added: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/assessments/join/:token — public route used by the candidate ----
router.get('/join/:token', async (req, res) => {
  try {
    const token = req.params.token;
    if (!token) return res.status(400).json({ error: 'token required' });

    // Find the candidate entry across all assessments.
    const assessment = await Assessment.findOne({ 'invitedCandidates.token': token });
    if (!assessment) return res.status(404).json({ error: 'invite not found' });

    assessment.markExpiredCandidates();

    const candidate = assessment.invitedCandidates.find((c) => c.token === token);
    if (!candidate) return res.status(404).json({ error: 'invite not found' });

    if (candidate.status === 'completed') {
      return res.status(410).json({ error: 'this invite has already been used to completion' });
    }
    if (candidate.status === 'expired') {
      return res.status(410).json({ error: 'this invite has expired' });
    }

    // Mark as started if first use. If they already had a userId (linked
    // by email match), keep that; otherwise leave null.
    if (candidate.status === 'invited') {
      candidate.status = 'started';
      candidate.startedAt = new Date();
      await assessment.save();
    }

    // Only return the problem IDs and the assessment metadata — not the
    // candidate list or company info.
    const problems = await Problem.find(
      { _id: { $in: assessment.problemIds } },
      'title slug difficulty executorType track category description examples constraints'
    );

    res.json({
      assessment: {
        id: assessment._id,
        title: assessment.title,
        description: assessment.description,
        timeLimit: assessment.timeLimit,
        expiresAt: assessment.expiresAt,
      },
      candidate: {
        email: candidate.email,
        startedAt: candidate.startedAt,
      },
      problems,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/assessments/:id/report — per-candidate score report ----
router.get('/:id/report', auth, loadOwnedAssessment, async (req, res) => {
  try {
    req.assessment.markExpiredCandidates();
    const candidates = req.assessment.invitedCandidates;

    // For each candidate, pull their submissions to this assessment's
    // problem set and compute pass/fail per problem + overall score.
    const reports = [];
    for (const c of candidates) {
      const problemReports = [];
      let totalScore = 0;
      let totalAttempts = 0;

      for (const pid of req.assessment.problemIds) {
        let submissions = [];
        if (c.userId) {
          submissions = await Submission.find({
            userId: c.userId,
            problemId: pid,
          })
            .sort({ submittedAt: -1 })
            .select('status runtime error executionRuntime submittedAt');
        }
        const accepted = submissions.find((s) => s.status === 'Accepted');
        const attempts = submissions.length;
        const score = accepted ? (accepted.runtime || 0) : Number.POSITIVE_INFINITY;
        problemReports.push({
          problemId: pid,
          status: accepted ? 'Accepted' : (submissions[0]?.status || 'Not attempted'),
          attempts,
          runtime: accepted ? accepted.runtime : null,
          executionRuntime: accepted ? accepted.executionRuntime : null,
          lastError: submissions[0]?.error || null,
        });
        if (accepted) totalScore += accepted.runtime || 0;
        totalAttempts += attempts;
      }

      const solvedCount = problemReports.filter((p) => p.status === 'Accepted').length;

      reports.push({
        email: c.email,
        userId: c.userId,
        status: c.status,
        invitedAt: c.invitedAt,
        startedAt: c.startedAt,
        completedAt: c.completedAt,
        solvedCount,
        totalProblems: req.assessment.problemIds.length,
        totalAttempts,
        totalRuntime: Number.isFinite(totalScore) ? totalScore : null,
        problems: problemReports,
      });
    }

    res.json({
      assessment: {
        id: req.assessment._id,
        title: req.assessment.title,
        description: req.assessment.description,
        problemIds: req.assessment.problemIds,
      },
      reports,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

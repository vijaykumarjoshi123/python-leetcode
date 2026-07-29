import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { assessmentsAPI } from '../services/api';
import './AssessmentDashboard.css';

/**
 * AssessmentDashboard — company-facing. Spec 8C.
 *
 * Shows:
 *   - List of active assessments with candidate completion status
 *   - Per-assessment table: Name | Status | Problems solved | Avg runtime | Score | Actions
 *   - "Invite candidates" modal: paste emails, generates invite links
 *   - "View report" button per candidate that opens CandidateReport
 */
function AssessmentDashboard() {
  const [assessments, setAssessments] = useState([]);
  const [reports, setReports] = useState({}); // assessmentId -> report
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal state: { open, assessmentId, emails, inviteResult }
  const [modal, setModal] = useState({
    open: false,
    assessmentId: null,
    emails: '',
    inviteResult: null,
    inviting: false,
  });

  const user = JSON.parse(localStorage.getItem('user') || 'null');

  const fetchAssessments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await assessmentsAPI.list();
      setAssessments(res.data.assessments || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.accountType === 'company') {
      fetchAssessments();
    } else if (user) {
      setError('This dashboard is only available to company accounts.');
      setLoading(false);
    } else {
      setError('Please log in to view your assessments.');
      setLoading(false);
    }
  }, [fetchAssessments, user]);

  const openReport = useCallback(async (assessmentId) => {
    try {
      const res = await assessmentsAPI.report(assessmentId);
      setReports((prev) => ({ ...prev, [assessmentId]: res.data }));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }, []);

  const closeReport = useCallback((assessmentId) => {
    setReports((prev) => {
      const next = { ...prev };
      delete next[assessmentId];
      return next;
    });
  }, []);

  const openInviteModal = (assessmentId) => {
    setModal({
      open: true,
      assessmentId,
      emails: '',
      inviteResult: null,
      inviting: false,
    });
  };

  const closeInviteModal = () => {
    setModal({ open: false, assessmentId: null, emails: '', inviteResult: null, inviting: false });
  };

  const submitInvite = async () => {
    const emails = modal.emails
      .split(/[\s,]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) return;
    setModal((m) => ({ ...m, inviting: true }));
    try {
      const res = await assessmentsAPI.invite(modal.assessmentId, emails);
      setModal((m) => ({
        ...m,
        inviting: false,
        inviteResult: res.data.added || [],
      }));
      fetchAssessments();
    } catch (err) {
      setModal((m) => ({
        ...m,
        inviting: false,
        inviteResult: { error: err.response?.data?.error || err.message },
      }));
    }
  };

  // The server now returns inviteUrl directly on each invite (built from
  // INVITE_BASE_URL server-side). Falls back to client-side construction
  // for older responses.
  const inviteUrlFor = (row) => {
    if (row.inviteUrl) return row.inviteUrl;
    const base = process.env.REACT_APP_INVITE_BASE_URL || window.location.origin;
    return `${base}/assessments/join/${row.token}`;
  };

  if (loading) return <div className="loading">Loading assessments...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div className="assessment-dashboard">
      <div className="dashboard-container">
        <div className="dashboard-header">
          <h1>Assessments</h1>
          <p className="dashboard-subtitle">
            Create assessments, invite candidates, and review their performance across the problem set.
          </p>
        </div>

        {assessments.length === 0 ? (
          <div className="empty-state">
            <p>No assessments yet. Use the API to create one (POST /api/assessments).</p>
          </div>
        ) : (
          assessments.map((a) => {
            const report = reports[a._id];
            const reportLoading = !report && a._id in reports === false && false; // intentional: see below
            const isReportOpen = Boolean(report);

            return (
              <section key={a._id} className="assessment-card">
                <header className="assessment-card-header">
                  <div>
                    <h2>{a.title}</h2>
                    {a.description && <p className="assessment-description">{a.description}</p>}
                    <div className="assessment-meta">
                      <span>{a.problemIds.length} problem{a.problemIds.length === 1 ? '' : 's'}</span>
                      {a.timeLimit != null && <span>{a.timeLimit} min time limit</span>}
                      {a.expiresAt && (
                        <span>
                          Expires {new Date(a.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                      <span>{a.invitedCandidates.length} candidate{a.invitedCandidates.length === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <div className="assessment-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => openInviteModal(a._id)}
                    >
                      Invite candidates
                    </button>
                    {!isReportOpen ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => openReport(a._id)}
                      >
                        View report
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => closeReport(a._id)}
                      >
                        Hide report
                      </button>
                    )}
                  </div>
                </header>

                {/* Per-assessment candidate table (8C). */}
                <table className="candidates-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Invited</th>
                      <th>Started</th>
                      <th>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(a.invitedCandidates || []).map((c, idx) => (
                      <tr key={idx}>
                        <td>{c.email}</td>
                        <td><span className={`status-pill status-${c.status}`}>{c.status}</span></td>
                        <td>{c.invitedAt ? new Date(c.invitedAt).toLocaleDateString() : '—'}</td>
                        <td>{c.startedAt ? new Date(c.startedAt).toLocaleDateString() : '—'}</td>
                        <td>{c.completedAt ? new Date(c.completedAt).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {isReportOpen && report && (
                  <div className="report-panel">
                    <h3>Candidate Report</h3>
                    <p className="report-summary">
                      {report.reports.length} candidate{report.reports.length === 1 ? '' : 's'} ·{' '}
                      {report.assessment.problemIds.length} problem{report.assessment.problemIds.length === 1 ? '' : 's'}
                    </p>
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Status</th>
                          <th>Solved</th>
                          <th>Attempts</th>
                          <th>Total runtime</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.reports.map((r, idx) => (
                          <tr key={idx}>
                            <td>{r.email}</td>
                            <td><span className={`status-pill status-${r.status}`}>{r.status}</span></td>
                            <td>{r.solvedCount}/{r.totalProblems}</td>
                            <td>{r.totalAttempts}</td>
                            <td>
                              {r.totalRuntime != null ? `${Math.round(r.totalRuntime)} ms` : '—'}
                            </td>
                            <td>
                              <Link
                                to={`/assessments/${a._id}/report/${encodeURIComponent(r.email)}`}
                                className="link"
                              >
                                Open full report
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      {modal.open && (
        <div className="modal-backdrop" onClick={closeInviteModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h2>Invite candidates</h2>
              <button type="button" className="modal-close" onClick={closeInviteModal}>×</button>
            </header>
            <div className="modal-body">
              <label htmlFor="invite-emails" className="modal-label">
                Email addresses (comma- or whitespace-separated)
              </label>
              <textarea
                id="invite-emails"
                rows={4}
                value={modal.emails}
                onChange={(e) => setModal((m) => ({ ...m, emails: e.target.value }))}
                placeholder="alice@example.com, bob@example.com"
                className="modal-textarea"
              />
              <button
                type="button"
                className="btn-primary"
                disabled={modal.inviting || !modal.emails.trim()}
                onClick={submitInvite}
              >
                {modal.inviting ? 'Generating tokens...' : 'Generate invite links'}
              </button>

              {modal.inviteResult && !modal.inviteResult.error && (
                <div className="invite-results">
                  <h4>Generated invites ({modal.inviteResult.length})</h4>
                  <p className="invite-results-hint">
                    Each link is single-use. The candidate receives an email automatically if SMTP is configured; otherwise share the link manually.
                  </p>
                  <ul>
                    {modal.inviteResult.map((r, idx) => (
                      <li key={idx}>
                        <span className="invite-email">{r.email}</span>
                        <input
                          type="text"
                          readOnly
                          value={inviteUrlFor(r)}
                          className="invite-url"
                          onClick={(e) => e.target.select()}
                        />
                        {r.email && (
                          <span
                            className={`email-status ${
                              r.email.skipped ? 'email-skipped' : r.email.error ? 'email-error' : 'email-ok'
                            }`}
                            title={
                              r.email.skipped
                                ? 'SMTP not configured; share the link manually'
                                : r.email.error
                                ? `Email failed: ${r.email.error}`
                                : `Email sent (id: ${r.email.messageId || 'n/a'})`
                            }
                          >
                            {r.email.skipped ? 'no SMTP' : r.email.error ? 'email failed' : 'email sent'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {modal.inviteResult && modal.inviteResult.error && (
                <div className="error-banner">{modal.inviteResult.error}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AssessmentDashboard;

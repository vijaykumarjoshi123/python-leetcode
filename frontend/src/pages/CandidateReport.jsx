import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { assessmentsAPI } from '../services/api';
import './CandidateReport.css';

/**
 * CandidateReport — per-candidate report page (Spec 8D).
 *
 * URL pattern: /assessments/:assessmentId/report/:email
 * (email is URL-encoded; candidate is identified by their email on the
 * assessment since the userId link is optional).
 *
 * Sections:
 *   - Header: candidate name/email, assessment title, completion date
 *   - Per-problem results: pass/fail, execution runtime, attempts
 *   - Skills radar by track
 *   - AI-generated 2-3 sentence summary (mocked client-side; the spec
 *     calls for a Claude call but we render a deterministic fallback
 *     until that endpoint is wired)
 *   - "Download PDF" — uses window.print() with a print stylesheet
 */
function CandidateReport() {
  const { id: assessmentId, email } = useParams();
  const decodedEmail = decodeURIComponent(email || '');

  const [report, setReport] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [reportRes, detailRes] = await Promise.all([
        assessmentsAPI.report(assessmentId),
        assessmentsAPI.detail(assessmentId).catch(() => null),
      ]);
      setReport(reportRes.data);
      if (detailRes) setAssessment(detailRes.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [assessmentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const printReport = () => {
    window.print();
  };

  if (loading) return <div className="loading">Loading candidate report...</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!report) return null;

  const candidateRow = (report.reports || []).find((r) => r.email === decodedEmail);
  if (!candidateRow) {
    return (
      <div className="candidate-report">
        <div className="error-banner">
          No report found for candidate <code>{decodedEmail}</code> in this assessment.
          <Link to={`/assessments/${assessmentId}`} className="link">Back to assessment</Link>
        </div>
      </div>
    );
  }

  // Build the radar data. Per-problem status doesn't carry track info, so
  // we approximate: count solved problems as the only signal. If we have
  // problemIds, we use them with a 0-or-1 score; the radar shape is most
  // useful when problems cover multiple tracks, which the seed data does.
  const radarData = (report.assessment.problemIds || []).map((pid, idx) => {
    const solved = candidateRow.problems.find(
      (p) => String(p.problemId) === String(pid)
    )?.status === 'Accepted';
    return {
      track: `P${idx + 1}`,
      score: solved ? 1 : 0,
    };
  });

  const aiSummary = buildAiSummary(candidateRow, report.assessment);

  return (
    <div className="candidate-report">
      <div className="report-container">
        <div className="report-toolbar no-print">
          <Link to={`/assessments/${assessmentId}`} className="back-link">
            ← Back to assessment
          </Link>
          <button type="button" className="btn-primary" onClick={printReport}>
            Download PDF
          </button>
        </div>

        <header className="report-header">
          <h1>{report.assessment.title}</h1>
          <p className="report-meta">
            Candidate: <strong>{candidateRow.email}</strong>
            {candidateRow.startedAt && (
              <> · Started {new Date(candidateRow.startedAt).toLocaleString()}</>
            )}
            {candidateRow.completedAt && (
              <> · Completed {new Date(candidateRow.completedAt).toLocaleString()}</>
            )}
          </p>
          <div className="report-summary-cards">
            <div className="summary-card">
              <span className="summary-label">Status</span>
              <span className={`status-pill status-${candidateRow.status}`}>
                {candidateRow.status}
              </span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Solved</span>
              <span className="summary-value">{candidateRow.solvedCount}/{candidateRow.totalProblems}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Total attempts</span>
              <span className="summary-value">{candidateRow.totalAttempts}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Total runtime</span>
              <span className="summary-value">
                {candidateRow.totalRuntime != null
                  ? `${Math.round(candidateRow.totalRuntime)} ms`
                  : '—'}
              </span>
            </div>
          </div>
        </header>

        <section className="report-section">
          <h2>Per-problem results</h2>
          <table className="report-problem-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Runtime</th>
                <th>Wall-clock</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {candidateRow.problems.map((p, idx) => (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td>
                    <span className={`status-pill status-${(p.status || 'unknown').replace(/\s+/g, '-').toLowerCase()}`}>
                      {p.status}
                    </span>
                  </td>
                  <td>{p.attempts}</td>
                  <td>{p.runtime != null ? `${Math.round(p.runtime)} ms` : '—'}</td>
                  <td>{p.executionRuntime != null ? `${Math.round(p.executionRuntime)} ms` : '—'}</td>
                  <td>
                    {p.lastError ? (
                      <code className="error-cell">{truncate(p.lastError, 80)}</code>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="report-section">
          <h2>Skills radar</h2>
          <p className="section-subtitle">
            Each axis represents a problem in this assessment. A score of 1 means solved; 0 means not solved.
          </p>
          <div className="radar-wrapper">
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={radarData} outerRadius="75%">
                <PolarGrid stroke="#e6ebf1" />
                <PolarAngleAxis dataKey="track" tick={{ fill: '#555', fontSize: 12 }} />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 1]}
                  tick={{ fill: '#999', fontSize: 10 }}
                  tickCount={2}
                />
                <Radar
                  name="Solved"
                  dataKey="score"
                  stroke="#667eea"
                  fill="#667eea"
                  fillOpacity={0.35}
                  isAnimationActive={false}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="report-section">
          <h2>AI-generated summary</h2>
          <p className="ai-summary">{aiSummary}</p>
          <p className="section-footnote no-print">
            Generated client-side as a deterministic placeholder. A future
            backend endpoint will call Claude with the submission data.
          </p>
        </section>
      </div>
    </div>
  );
}

// Deterministic 2-3 sentence summary until the Claude endpoint is wired.
// Uses signals from the report itself (no API call).
function buildAiSummary(candidate, assessment) {
  const solved = candidate.solvedCount;
  const total = candidate.totalProblems;
  const ratio = total > 0 ? solved / total : 0;

  let opener;
  if (ratio === 1) {
    opener = `Candidate solved every problem (${solved}/${total}) on first or near-first attempts.`;
  } else if (ratio >= 0.7) {
    opener = `Candidate solved ${solved} of ${total} problems with a strong overall pass rate.`;
  } else if (ratio >= 0.4) {
    opener = `Candidate solved ${solved} of ${total} problems, with mixed results across the set.`;
  } else if (solved > 0) {
    opener = `Candidate solved ${solved} of ${total} problems; significant gaps remain.`;
  } else {
    opener = `Candidate did not solve any of the ${total} problems in this assessment.`;
  }

  const runtimeNote =
    candidate.totalRuntime != null
      ? ` Their aggregate runtime across accepted submissions was ${Math.round(candidate.totalRuntime)} ms.`
      : ` No accepted submissions were recorded.`;

  const attemptsNote =
    candidate.totalAttempts > candidate.solvedCount * 2
      ? ` The high attempt-to-solve ratio suggests debugging effort may be slowing them down.`
      : ``;

  return `${opener}${runtimeNote}${attemptsNote}`;
}

function truncate(str, n) {
  if (!str) return '';
  return str.length <= n ? str : `${str.slice(0, n)}…`;
}

export default CandidateReport;

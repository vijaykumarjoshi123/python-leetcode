import React, { useState, useEffect, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { pipelinesAPI } from '../services/api';
import './PipelineIndex.css';

/**
 * PipelineIndex — landing page for the pipeline simulator (Section 11H).
 *
 * Lists every seeded PipelineProblem (fetched from /api/pipelines/problems)
 * and the current user's last few PipelineRuns (cross-problem activity).
 * The server returns a sanitised view of each problem (title, difficulty,
 * tracks, stage count) — no fixture paths or grading secrets.
 *
 * Access: open on the client. The /api/pipelines/run endpoint gates writes
 * behind user.pipelineEnabled; this page only reads, so we let anyone
 * browse the catalog and surface a friendly "ask an admin to enable the
 * Pipelines feature" message for users without the flag.
 */
function PipelineIndex() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const [problems, setProblems] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const problemsRes = await pipelinesAPI.listProblems();
      setProblems(problemsRes.data.problems || []);
      if (user?.id) {
        try {
          const runsRes = await pipelinesAPI.listRuns({ limit: 10 });
          setRuns(runsRes.data.runs || []);
        } catch (e) {
          // Listing runs requires auth — silent for non-logged-in users.
          setRuns([]);
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const getDifficultyColor = (d) => {
    switch (d) {
      case 'Easy': return '#52c41a';
      case 'Medium': return '#faad14';
      case 'Hard': return '#f5222d';
      default: return '#666';
    }
  };

  if (!user) return <Navigate to="/login" replace />;
  if (!user.pipelineEnabled) {
    return (
      <div className="pipeline-index">
        <div className="pipeline-index-container">
          <div className="pipeline-disabled-banner">
            <h2>Pipelines feature is not enabled for your account</h2>
            <p>
              The pipeline simulator is opt-in. Ask an administrator to flip
              <code> pipelineEnabled</code> on your user record to access it.
            </p>
            <Link to="/problems" className="btn-primary">Back to problems</Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="loading">Loading pipelines...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div className="pipeline-index">
      <div className="pipeline-index-container">
        <header className="pipeline-index-header">
          <h1>Pipeline Simulator</h1>
          <p className="pipeline-index-subtitle">
            End-to-end multi-tool pipelines with scenario-based failure injection.
            Pick a problem to write per-stage code, or load a past run to diagnose.
          </p>
        </header>

        <section className="pipeline-index-section">
          <h2>Available pipelines</h2>
          {problems.length === 0 ? (
            <p className="placeholder-text">
              No pipelines seeded yet. Run <code>node seeds/pipeline_problems.js</code> to load the
              clickstream sample.
            </p>
          ) : (
            <div className="pipeline-problem-grid">
              {problems.map((p) => (
                <Link
                  to={`/pipelines/${p.id}`}
                  key={p.id}
                  className="pipeline-problem-card"
                >
                  <div className="pipeline-problem-card-header">
                    <span
                      className="pipeline-difficulty"
                      style={{ color: getDifficultyColor(p.difficulty) }}
                    >
                      {p.difficulty}
                    </span>
                    <span className="pipeline-stage-count">
                      {p.stageCount} {p.stageCount === 1 ? 'stage' : 'stages'}
                    </span>
                  </div>
                  <h3 className="pipeline-problem-title">{p.title}</h3>
                  <p className="pipeline-problem-desc">{p.description}</p>
                  <div className="pipeline-tracks">
                    {(p.tracks || []).map((t) => (
                      <span key={t} className="pipeline-track-pill">{t}</span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="pipeline-index-section">
          <h2>Recent runs</h2>
          {runs.length === 0 ? (
            <p className="placeholder-text">No runs yet. Open a pipeline above and click Run.</p>
          ) : (
            <table className="pipeline-runs-table">
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Pipeline</th>
                  <th>Scenario</th>
                  <th>Status</th>
                  <th>Runtime</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r._id}>
                    <td>{new Date(r.submittedAt).toLocaleString()}</td>
                    <td><code>{String(r.pipelineProblemId).slice(-6)}</code></td>
                    <td>{r.scenarioId ? <code>{r.scenarioId}</code> : <em>clean</em>}</td>
                    <td>
                      <span className={`pipeline-status-pill ${r.passed ? 'passed' : 'failed'}`}>
                        {r.passed ? '✓ passed' : '✗ failed'}
                      </span>
                    </td>
                    <td>{r.totalRuntimeMs != null ? `${Math.round(r.totalRuntimeMs)} ms` : '—'}</td>
                    <td>
                      <Link to={`/pipelines/run/${r._id}`} className="pipeline-run-link">
                        View report →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

export default PipelineIndex;

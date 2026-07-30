import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { pipelinesAPI } from '../services/api';
import AIHintPanel from '../components/AIHintPanel';
import './PipelineReport.css';

/**
 * PipelineReport — per-run report page (Section 11H).
 *
 * URL: /pipelines/run/:runId
 *
 * Sections:
 *   - Header: pipeline title (resolved via a separate list call),
 *     scenario badge, pass/fail pill, runtime
 *   - Per-stage results table with status/runtime/error + injected
 *     failures chip
 *   - Skills radar: one axis per stage (passed = 1, failed/skipped/error = 0)
 *   - AI hint panel in pipeline mode (so the user can iterate from the
 *     report page using their current submission as history)
 */
function PipelineReport() {
  const { runId } = useParams();

  const user = JSON.parse(localStorage.getItem('user') || 'null');

  const [run, setRun] = useState(null);
  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchRun = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await pipelinesAPI.getRun(runId);
      setRun(res.data);
      // Fetch the problem metadata so we can show the title + DAG labels
      // and build a stage-id-keyed radar.
      try {
        const problemRes = await pipelinesAPI.getProblem(res.data.pipelineProblemId);
        setProblem(problemRes.data);
      } catch {
        setProblem(null);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (user?.id) fetchRun();
  }, [fetchRun, user?.id]);

  if (!user) return <Navigate to="/login" replace />;
  if (loading) return <div className="loading">Loading pipeline report...</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!run) return null;

  const stages = run.stageResults || [];
  const passedStages = stages.filter((s) => s.status === 'passed').length;
  const failedStages = stages.filter((s) => s.status === 'failed' || s.status === 'error').length;
  const skippedStages = stages.filter((s) => s.status === 'skipped').length;

  // Build radar data: one axis per stage id. Score = 1 if passed, else 0.
  const radarData = stages.map((s) => ({
    stage: s.stageId,
    score: s.status === 'passed' ? 1 : 0,
  }));

  // Build a lookup of stage ids to executorType for the failure-chips.
  const executorByStage = (problem?.stages || []).reduce((acc, s) => {
    acc[s.id] = s.executorType;
    return acc;
  }, {});

  return (
    <div className="pipeline-report">
      <div className="pipeline-report-container">
        <div className="report-toolbar">
          <Link
            to={run.pipelineProblemId ? `/pipelines/${run.pipelineProblemId}` : '/pipelines'}
            className="back-link"
          >
            ← Back to pipeline
          </Link>
        </div>

        <header className="report-header">
          <h1>{problem?.title || 'Pipeline run'}</h1>
          <p className="report-meta">
            Run <code>{runId}</code>
            {run.scenarioId && (
              <> · Scenario <code>{run.scenarioId}</code></>
            )}
            {' · '}Submitted {new Date(run.submittedAt).toLocaleString()}
          </p>
          <div className="report-summary-cards">
            <div className="summary-card">
              <span className="summary-label">Status</span>
              <span className={`pipeline-status-pill ${run.passed ? 'passed' : 'failed'}`}>
                {run.passed ? '✓ passed' : '✗ failed'}
              </span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Stages passed</span>
              <span className="summary-value">{passedStages}/{stages.length}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Failed / skipped</span>
              <span className="summary-value">{failedStages} / {skippedStages}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Total runtime</span>
              <span className="summary-value">
                {run.totalRuntimeMs != null ? `${Math.round(run.totalRuntimeMs)} ms` : '—'}
              </span>
            </div>
          </div>
        </header>

        <section className="report-section">
          <h2>Per-stage results</h2>
          {stages.length === 0 ? (
            <p className="placeholder-text">No stages recorded.</p>
          ) : (
            <table className="pipeline-report-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Stage</th>
                  <th>Tool</th>
                  <th>Status</th>
                  <th>Runtime</th>
                  <th>Error</th>
                  <th>Injected</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s, idx) => (
                  <tr key={s.stageId || idx}>
                    <td>{idx + 1}</td>
                    <td><code>{s.stageId}</code></td>
                    <td>
                      <span className="pipeline-tool-cell">
                        {s.executorType || executorByStage[s.stageId] || '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`pipeline-stage-status status-${s.status}`}>
                        {s.status}
                      </span>
                    </td>
                    <td>{s.runtimeMs != null ? `${Math.round(s.runtimeMs)} ms` : '—'}</td>
                    <td>
                      {s.error ? (
                        <code className="error-cell">{truncate(s.error, 120)}</code>
                      ) : (
                        <span className="placeholder-text">—</span>
                      )}
                    </td>
                    <td>
                      <div className="pipeline-failure-chips">
                        {(s.failures || [])
                          .filter((f) => f && f.applied)
                          .map((f, i) => (
                            <span key={i} className="pipeline-failure-chip" title={f.note || ''}>
                              {f.type}
                            </span>
                          ))}
                        {(s.failures || []).filter((f) => f && f.applied).length === 0 && (
                          <span className="placeholder-text">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="report-section">
          <h2>Skills radar</h2>
          <p className="section-subtitle">
            One axis per stage. Score is 1 if the stage passed, 0 otherwise.
          </p>
          <div className="radar-wrapper">
            {radarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData} outerRadius="75%">
                  <PolarGrid stroke="#e6ebf1" />
                  <PolarAngleAxis dataKey="stage" tick={{ fill: '#555', fontSize: 12 }} />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 1]}
                    tick={{ fill: '#999', fontSize: 10 }}
                    tickCount={2}
                  />
                  <Radar
                    name="Passed"
                    dataKey="score"
                    stroke="#667eea"
                    fill="#667eea"
                    fillOpacity={0.35}
                    isAnimationActive={false}
                  />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <p className="placeholder-text">No stage data to plot.</p>
            )}
          </div>
        </section>

        <section className="report-section">
          <h2>Get a hint</h2>
          <p className="section-subtitle">
            Ask the AI tutor for a diagnosis based on this run. The hint
            engine reads the failing stage and the injected failure types
            (Section 11G).
          </p>
          <AIHintPanel
            problemId={run.pipelineProblemId}
            code=""
            executorType="pipeline"
            isPipeline
            submissionHistory={[{
              status: run.passed ? 'passed' : 'failed',
              runtime: run.totalRuntimeMs,
              error: '',
              executorType: 'pipeline',
              stageResults: run.stageResults,
            }]}
            isExecuting={false}
          />
        </section>
      </div>
    </div>
  );
}

function truncate(str, n) {
  if (!str) return '';
  return str.length <= n ? str : `${str.slice(0, n)}…`;
}

export default PipelineReport;

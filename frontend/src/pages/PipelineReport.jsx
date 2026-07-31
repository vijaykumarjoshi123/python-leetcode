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
            {/* Section 11J — pipeline-aware score. Surfaced as a 5th
                summary card so the score is visible without scrolling
                down to the breakdown section. */}
            {run.score && (
              <div className="summary-card summary-card-score">
                <span className="summary-label">Score</span>
                <span
                  className="summary-value summary-value-score"
                  style={{ color: scoreColor(run.score.total) }}
                >
                  {(run.score.total * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Section 11J — score breakdown. Only renders when score is
            present (older PipelineRuns from before 11J won't have it).
            Shows the four sub-scores + per-criterion detail so the
            user can see exactly where their points went. */}
        {run.score && (
          <section className="report-section">
            <h2>Score breakdown</h2>
            <p className="section-subtitle">
              Score = correctness × operational quality. Operational
              combines attempt efficiency, time-to-diagnose, and a
              shotgun-debugging detector (drops when identical code is
              re-submitted).
            </p>
            <ScoreBreakdown score={run.score} />
          </section>
        )}

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
          <h2>Diagnostics</h2>
          <p className="section-subtitle">
            Per-stage observability (Section 11I). Only stages that
            failed carry diagnostics — clean stages were skipped to keep
            Mongo writes bounded.
          </p>
          {stages.some((s) => s.diagnostics) ? (
            <DiagnosticsList stages={stages} />
          ) : (
            <p className="placeholder-text">
              No diagnostic data captured for this run. (Clean runs and
              runs without diagnostics capture enabled don't surface
              anything here.)
            </p>
          )}
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

/**
 * Section 11J — pick a colour for the total score. Green at 1.0,
 * red at 0.0, amber in the middle. Used by both the header summary
 * card and the breakdown bars.
 */
function scoreColor(value) {
  if (value == null) return '#888';
  if (value >= 0.8) return '#389e0d'; // green
  if (value >= 0.5) return '#ad6800'; // amber
  return '#a8071a'; // red
}

/**
 * ScoreBreakdown — renders the four sub-scores with bar charts so the
 * user can see exactly where their points came from.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │ Correctness            ████████░░   1.00     │
 *   │ Operational            ███████░░░   0.73     │
 *   │   ├ Attempt efficiency ███████░░░   0.60     │
 *   │   ├ Time efficiency    ███████░░░   0.60     │
 *   │   └ No shotgun         ██████████   1.00     │
 *   │ Total = 1.00 × 0.73 = 0.73                  │
 *   └─────────────────────────────────────────────┘
 *
 * Plus a metadata strip (attempt #N, previous attempts).
 */
function ScoreBreakdown({ score }) {
  const b = score.breakdown || {};
  return (
    <div className="score-breakdown">
      <ScoreRow
        label="Correctness"
        value={score.correctness}
        note={`${b.stagesPassed || 0} passed / ${b.stagesSkipped || 0} skipped / ${b.stagesFailed || 0} failed`}
      />
      <ScoreRow
        label="Operational"
        value={score.operational}
        note={`attempt #${b.attemptNumber || 1} (${b.previousAttempts || 0} previous)`}
        isSubtotal
      />
      <ScoreRow
        label="↳ Attempt efficiency"
        value={b.attemptEfficiency}
        note="1.0 first try; -0.1 per extra attempt"
      />
      <ScoreRow
        label="↳ Time efficiency"
        value={b.timeEfficiency}
        note="<60s first try scores 1.0; multi-attempt or slow run degrades"
      />
      <ScoreRow
        label="↳ No shotgun"
        value={b.noShotgun}
        note="1.0 if stageCode changed; 0.5 if identical code across attempts"
      />
      <div className="score-total">
        <span className="score-total-label">Total</span>
        <span
          className="score-total-value"
          style={{ color: scoreColor(score.total) }}
        >
          {(score.total * 100).toFixed(0)}%
        </span>
        <span className="score-total-formula">
          = {(score.correctness * 100).toFixed(0)}% × {(score.operational * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function ScoreRow({ label, value, note, isSubtotal }) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100;
  return (
    <div className={`score-row ${isSubtotal ? 'score-row-subtotal' : ''}`}>
      <div className="score-row-label">{label}</div>
      <div className="score-row-track">
        <div
          className="score-row-bar"
          style={{
            width: `${pct}%`,
            background: scoreColor(value),
          }}
        />
      </div>
      <div className="score-row-value">{((value || 0) * 100).toFixed(0)}%</div>
      {note && <div className="score-row-note">{note}</div>}
    </div>
  );
}

/**
 * DiagnosticsList — renders per-stage diagnostics (Section 11I).
 *
 * Each failing stage carries a `diagnostics` object whose shape
 * depends on the executor type:
 *   - pyspark:   sparkStages[], sparkEventLogTail, oomMarker
 *   - dbt:       runResults[], tests[], modelTimings[]
 *   - kafka:     consumerLag, topicStats[]
 *   - airflow:   taskTimings[], dagId, structuralIssues[]
 *
 * Stages without diagnostics (clean stages, or stages where the
 * orchestrator chose not to persist) are omitted — see
 * `shouldPersistDiagnostics` in pipelineOrchestrator.js for the
 * cost-limit policy.
 */
function DiagnosticsList({ stages }) {
  const failing = stages.filter((s) => s && s.diagnostics);
  if (failing.length === 0) return null;

  return (
    <div className="diagnostics-list">
      {failing.map((s) => (
        <div key={s.stageId} className="diagnostics-stage">
          <h3 className="diagnostics-stage-header">
            <code>{s.stageId}</code>
            <span className="diagnostics-tool">{s.executorType}</span>
          </h3>
          {s.executorType === 'pyspark' && <SparkDiagnostics diag={s.diagnostics} />}
          {s.executorType === 'dbt' && <DbtDiagnostics diag={s.diagnostics} />}
          {s.executorType === 'kafka' && <KafkaDiagnostics diag={s.diagnostics} />}
          {s.executorType === 'airflow' && <AirflowDiagnostics diag={s.diagnostics} />}
          {!['pyspark', 'dbt', 'kafka', 'airflow'].includes(s.executorType) && (
            <p className="placeholder-text">
              No diagnostics renderer for {s.executorType} yet.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function SparkDiagnostics({ diag }) {
  const stages = diag.sparkStages || [];
  const tail = diag.sparkEventLogTail || [];
  return (
    <div className="diagnostics-body">
      {diag.oomMarker && (
        <div className="diagnostics-banner diagnostics-banner-danger">
          ⚠️ Out-of-memory signature detected in stderr
          (Container killed by YARN or <code>java.lang.OutOfMemoryError</code>).
          Reduce partition size or ask for more memory via
          <code> memoryMbOverride</code>.
        </div>
      )}
      {stages.length > 0 ? (
        <>
          <h4>Stage table</h4>
          <table className="diagnostics-table">
            <thead>
              <tr><th>Stage</th><th>Tasks</th><th>Duration</th><th>Status</th></tr>
            </thead>
            <tbody>
              {stages.map((stg, idx) => (
                <tr key={idx}>
                  <td><code>{stg.stageId}</code></td>
                  <td>{stg.taskCount}</td>
                  <td>{stg.durationMs} ms</td>
                  <td><span className={`pipeline-stage-status status-${stg.status}`}>{stg.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="placeholder-text">No Spark stage markers found in stderr.</p>
      )}
      {tail.length > 0 && (
        <>
          <h4>Event log tail</h4>
          <pre className="diagnostics-log">{tail.join('\n')}</pre>
        </>
      )}
    </div>
  );
}

function DbtDiagnostics({ diag }) {
  const tests = diag.tests || [];
  const failingTests = tests.filter((t) => t.status !== 'pass' && t.status !== 'success');
  const timings = diag.modelTimings || [];
  return (
    <div className="diagnostics-body">
      {tests.length > 0 ? (
        <>
          <h4>Tests ({tests.length} — {failingTests.length} failing)</h4>
          <table className="diagnostics-table">
            <thead>
              <tr><th>Test</th><th>Status</th><th>Time</th></tr>
            </thead>
            <tbody>
              {tests.map((t, idx) => (
                <tr key={idx}>
                  <td><code>{truncate(t.unique_id, 60)}</code></td>
                  <td>
                    <span className={`pipeline-stage-status status-${t.status}`}>{t.status}</span>
                  </td>
                  <td>{t.totalTimeMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="placeholder-text">No dbt test results captured.</p>
      )}
      {timings.length > 0 && (
        <>
          <h4>Model timings</h4>
          <ul className="diagnostics-list-plain">
            {timings.map((m, idx) => (
              <li key={idx}>
                <code>{truncate(m.unique_id, 60)}</code>
                {' — '}{m.totalTimeMs} ms
                <span className={`pipeline-stage-status status-${m.status}`}>{m.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function KafkaDiagnostics({ diag }) {
  const topicStats = diag.topicStats || [];
  return (
    <div className="diagnostics-body">
      <div className="diagnostics-banner diagnostics-banner-info">
        Consumer lag at run completion:&nbsp;
        {diag.consumerLag != null ? (
          <strong>{diag.consumerLag} messages behind</strong>
        ) : (
          <em>0 (or no consumer group)</em>
        )}
      </div>
      {topicStats.length > 0 ? (
        <>
          <h4>Topic stats</h4>
          <table className="diagnostics-table">
            <thead>
              <tr><th>Topic</th><th>Partition</th><th>End offset</th><th>Messages</th></tr>
            </thead>
            <tbody>
              {topicStats.map((t, idx) => (
                <tr key={idx}>
                  <td><code>{t.topic}</code></td>
                  <td>{t.partition}</td>
                  <td>{t.logEndOffset}</td>
                  <td>{t.messageCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="placeholder-text">No topic stats captured (broker may have shut down).</p>
      )}
    </div>
  );
}

function AirflowDiagnostics({ diag }) {
  const timings = diag.taskTimings || [];
  const issues = diag.structuralIssues || [];
  const max = timings.reduce((m, t) => Math.max(m, t.durationMs || 0), 0);
  return (
    <div className="diagnostics-body">
      {diag.dagId && (
        <div className="diagnostics-banner diagnostics-banner-info">
          DAG: <code>{diag.dagId}</code>
        </div>
      )}
      {issues.length > 0 && (
        <div className="diagnostics-banner diagnostics-banner-warning">
          ⚠️ Structural issues:
          <ul className="diagnostics-list-plain">
            {issues.map((iss, idx) => <li key={idx}>{iss}</li>)}
          </ul>
        </div>
      )}
      {timings.length > 0 ? (
        <>
          <h4>Task timings (Gantt-style)</h4>
          <div className="diagnostics-gantt">
            {timings.map((t, idx) => {
              const widthPct = max > 0 ? Math.max(2, ((t.durationMs || 0) / max) * 100) : 100;
              return (
                <div key={idx} className="diagnostics-gantt-row">
                  <code className="diagnostics-gantt-label">{t.taskId}</code>
                  <div className="diagnostics-gantt-track">
                    <div
                      className={`diagnostics-gantt-bar status-${t.status}`}
                      style={{ width: `${widthPct}%` }}
                      title={`${t.durationMs} ms`}
                    />
                  </div>
                  <span className="diagnostics-gantt-ms">{t.durationMs} ms</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="placeholder-text">No task timings captured.</p>
      )}
    </div>
  );
}

export default PipelineReport;

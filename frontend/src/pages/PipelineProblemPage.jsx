import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { pipelinesAPI } from '../services/api';
import AIHintPanel from '../components/AIHintPanel';
// Section 11K — first-visit tutorial modal. Imports the component
// plus the localStorage-gate helpers so we can show it on first load
// and expose a "Replay tutorial" affordance for returning users.
import PipelineTutorial, {
  shouldShowTutorial,
  resetTutorialGate,
} from '../components/PipelineTutorial';
import './PipelineProblemPage.css';

// Default per-stage starter. We seed a comment block so the user knows
// which tool they're targeting. Real fixtures + reference implementations
// are out of scope for the UI; the orchestrator mounts /fixtures/ and
// the per-tool runner hands the user a starter inside the container.
const DEFAULT_STARTER = (stageId) => `# ${stageId}\n# Write your code here.\n`;

const EXECUTOR_LANGUAGE = {
  python: 'python',
  sql: 'sql',
  dbt: 'sql',
  pyspark: 'python',
  airflow: 'python',
  kafka: 'python',
  iceberg: 'python',
};

const EXECUTOR_PILL_COLORS = {
  python: '#3b82f6',
  sql: '#22c55e',
  pyspark: '#f97316',
  dbt: '#14b8a6',
  airflow: '#a855f7',
  kafka: '#ef4444',
  iceberg: '#f59e0b',
};

/**
 * PipelineProblemPage — per-problem editor for the pipeline simulator
 * (Section 11H).
 *
 * URL: /pipelines/:id
 *
 * Layout:
 *   - Left:  problem description + DAG strip + scenario picker
 *   - Center: tabbed Monaco editor (one tab per stage, in topo order)
 *   - Right: AI hint panel in pipeline mode (Section 11G)
 *   - Bottom: Run / Run-with-scenario buttons + last run link
 *
 * On submit we POST /api/pipelines/run with { pipelineProblemId,
 * stageCode, scenarioId }. The orchestrator returns the persisted
 * PipelineRun document synchronously (Section 11D's MVP behaviour), and
 * we redirect to /pipelines/run/:runId.
 */
function PipelineProblemPage() {
  const { id: problemId } = useParams();
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem('user') || 'null');

  const [problem, setProblem] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [scenarioId, setScenarioId] = useState('');
  const [stageCode, setStageCode] = useState({});
  const [activeStage, setActiveStage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  // Section 11K — tutorial modal state. Opens automatically on first
  // visit (gated by localStorage via shouldShowTutorial); can also be
  // reopened manually via the "Replay tutorial" button on the page.
  const [tutorialOpen, setTutorialOpen] = useState(false);
  // Sample-diagnosis panel state — when the user clicks "View sample
  // diagnosis" we expand a card showing the tutorial scenario's
  // expectedDiagnosis text. Separated from the picker so the user
  // doesn't see it accidentally; explicit opt-in only.
  const [showSampleDiagnosis, setShowSampleDiagnosis] = useState(false);

  const fetchProblem = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const res = await pipelinesAPI.getProblem(problemId);
      setProblem(res.data);
      // Initialise stageCode with per-stage starters (topo order from
      // the server response — the server computes topo via Kahn's
      // algorithm, see backend/services/pipelineOrchestrator.js).
      const stages = res.data.stages || [];
      const init = {};
      stages.forEach((s) => { init[s.id] = DEFAULT_STARTER(s.id); });
      setStageCode(init);
      setActiveStage(stages[0]?.id || null);
      // Load the scenario catalog in parallel — if it fails (e.g.
      // none seeded) we just show an empty picker.
      try {
        const sc = await pipelinesAPI.listScenarios(problemId);
        setScenarios(sc.data.scenarios || []);
      } catch {
        setScenarios([]);
      }
      // Most-recent run for the "View last run" link.
      try {
        const runs = await pipelinesAPI.listRuns({ limit: 50 });
        const mine = (runs.data.runs || []).filter(
          (r) => String(r.pipelineProblemId) === String(problemId),
        );
        setLastRun(mine[0] || null);
      } catch {
        setLastRun(null);
      }
    } catch (err) {
      setFetchError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [problemId]);

  useEffect(() => {
    if (user?.id) fetchProblem();
  }, [fetchProblem, user?.id]);

  // Section 11K — auto-open the tutorial modal on first visit. We
  // gate on the localStorage key inside shouldShowTutorial(); existing
  // users (key set) won't see it. The check fires once per page mount
  // — re-running fetchProblem doesn't re-trigger the modal.
  useEffect(() => {
    if (loading) return; // wait for the problem to load so the modal
                        // doesn't open over a half-rendered page
    if (shouldShowTutorial()) setTutorialOpen(true);
  }, [loading]);

  // Build the DAG strip data: one row per stage with its dependsOn
  // edges. Rendered as a left-to-right chain of pills; dependsOn edges
  // are read by the tooltip but not drawn as arrows (the chain order
  // is already topo order, so the visual conveys the order).
  const orderedStages = useMemo(
    () => (problem && problem.stages) ? problem.stages : [],
    [problem],
  );

  const handleSubmit = async () => {
    if (!user?.id) {
      setSubmitError('Please login to run a pipeline.');
      return;
    }
    try {
      setSubmitting(true);
      setSubmitError(null);
      const res = await pipelinesAPI.run({
        pipelineProblemId: problemId,
        stageCode,
        scenarioId: scenarioId || null,
      });
      // The orchestrator returns the persisted run; navigate to the
      // report page so the user can inspect per-stage verdicts.
      navigate(`/pipelines/run/${res.data._id}`);
    } catch (err) {
      setSubmitError(
        err.response?.data?.error ||
        err.message ||
        'Pipeline run failed',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return <Navigate to="/login" replace />;
  if (!user.pipelineEnabled) {
    return (
      <div className="pipeline-problem-page">
        <div className="pipeline-disabled-banner">
          <h2>Pipelines feature is not enabled</h2>
          <Link to="/pipelines" className="back-link">← Back to Pipelines</Link>
        </div>
      </div>
    );
  }
  if (loading) return <div className="loading">Loading pipeline...</div>;
  if (fetchError) return <div className="error-banner">{fetchError}</div>;
  if (!problem) return null;

  const currentStage = orderedStages.find((s) => s.id === activeStage) || orderedStages[0];

  return (
    <div className="pipeline-problem-page">
      {/* Section 11K — first-visit tutorial modal. Rendered outside
          the page container so the backdrop covers the whole viewport.
          onClose writes the localStorage gate so the modal won't open
          again on subsequent visits unless the user clicks
          "Replay tutorial". */}
      <PipelineTutorial
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
      />
      <div className="pipeline-page-container">
        {/* Left column: description + DAG + scenario picker */}
        <div className="pipeline-info-panel">
          <Link to="/pipelines" className="back-link">← All pipelines</Link>
          <h1>{problem.title}</h1>
          <div className="pipeline-meta">
            <span className={`difficulty difficulty-${(problem.difficulty || '').toLowerCase()}`}>
              {problem.difficulty}
            </span>
            <span className="pipeline-fixture-version">fixture v{problem.fixtureVersion}</span>
            {(problem.tracks || []).map((t) => (
              <span key={t} className="pipeline-track-pill">{t}</span>
            ))}
          </div>

          <div className="pipeline-description">
            <pre>{problem.description}</pre>
          </div>

          <div className="pipeline-dag">
            <h3>Pipeline topology</h3>
            <div className="pipeline-dag-strip">
              {orderedStages.map((s, idx) => (
                <React.Fragment key={s.id}>
                  <button
                    type="button"
                    className={`pipeline-dag-node ${activeStage === s.id ? 'active' : ''}`}
                    onClick={() => setActiveStage(s.id)}
                    title={(s.dependsOn || []).length
                      ? `Depends on: ${s.dependsOn.join(', ')}`
                      : 'No upstream dependencies'}
                  >
                    <span
                      className="pipeline-dag-tool"
                      style={{ background: EXECUTOR_PILL_COLORS[s.executorType] || '#666' }}
                    >
                      {s.executorType}
                    </span>
                    <span className="pipeline-dag-id">{s.id}</span>
                  </button>
                  {idx < orderedStages.length - 1 && (
                    <span className="pipeline-dag-arrow">→</span>
                  )}
                </React.Fragment>
              ))}
            </div>
            <p className="pipeline-dag-hint">
              Click a stage to focus its editor. Each stage runs in a
              dedicated container with the corresponding tool.
            </p>
          </div>

          <div className="pipeline-scenarios">
            <h3>Failure scenarios</h3>
            <select
              className="pipeline-scenario-picker"
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              disabled={submitting}
            >
              <option value="">Clean run (no scenario)</option>
              {/* Section 11K — filter the "tutorial" scenario out of the
                  picker. It's reachable only through the first-visit
                  tutorial modal (which pre-selects it via the
                  scenarioId state on close) and the "View sample
                  diagnosis" affordance below. Showing it alongside
                  the real scenarios would clutter the picker. */}
              {scenarios
                .filter((sc) => sc.slug !== 'tutorial')
                .map((sc) => (
                  <option key={sc.slug} value={sc.slug}>
                    {sc.name} ({sc.slug})
                  </option>
                ))}
            </select>
            {scenarioId && (
              <div className="pipeline-scenario-detail">
                {(() => {
                  const sc = scenarios.find((x) => x.slug === scenarioId);
                  if (!sc) return null;
                  return (
                    <>
                      <p className="pipeline-scenario-desc">{sc.description}</p>
                      <p className="pipeline-scenario-failures">
                        Injects: {sc.failures.map((f) =>
                          `${f.type} → ${f.stageId}`).join('; ')}
                      </p>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Section 11K — "View sample diagnosis" affordance. Reads
                the tutorial scenario's expectedDiagnosis from the
                scenarios list (filtered out of the picker above). The
                user has to opt in explicitly — the diagnosis is
                hidden by default so the exercise isn't trivially
                spoiled. */}
            <div className="pipeline-tutorial-actions">
              <button
                type="button"
                className="pipeline-tutorial-link"
                onClick={() => setShowSampleDiagnosis((v) => !v)}
              >
                {showSampleDiagnosis ? 'Hide sample diagnosis' : 'View sample diagnosis'}
              </button>
              <button
                type="button"
                className="pipeline-tutorial-link pipeline-tutorial-link-muted"
                onClick={() => {
                  resetTutorialGate();
                  setTutorialOpen(true);
                }}
              >
                Replay tutorial
              </button>
            </div>
            {showSampleDiagnosis && (() => {
              const tutorialSc = scenarios.find((x) => x.slug === 'tutorial');
              if (!tutorialSc) {
                return (
                  <div className="pipeline-sample-diagnosis pipeline-sample-diagnosis-missing">
                    Tutorial scenario not seeded. Run
                    <code> node seeds/pipeline_scenarios.js</code> to load it.
                  </div>
                );
              }
              return (
                <div className="pipeline-sample-diagnosis">
                  <h4>Sample diagnosis (tutorial)</h4>
                  <p>{tutorialSc.expectedDiagnosis}</p>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Center: stage editor */}
        <div className="pipeline-editor-panel">
          <div className="pipeline-editor-header">
            <span className="pipeline-stage-label">
              Stage: <strong>{currentStage?.id}</strong>
            </span>
            <span
              className="pipeline-stage-tool"
              style={{ background: EXECUTOR_PILL_COLORS[currentStage?.executorType] || '#666' }}
            >
              {currentStage?.executorType}
            </span>
          </div>

          <div className="pipeline-stage-desc">
            {currentStage?.description}
          </div>

          <div className="pipeline-monaco">
            <Editor
              height="100%"
              language={EXECUTOR_LANGUAGE[currentStage?.executorType] || 'python'}
              theme="vs-dark"
              value={stageCode[currentStage?.id] || ''}
              onChange={(value) => setStageCode((prev) => ({
                ...prev,
                [currentStage.id]: value || '',
              }))}
              options={{
                fontSize: 13,
                lineNumbers: 'on',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 4,
                insertSpaces: true,
                wordWrap: 'on',
                padding: { top: 8 },
                suggest: { showKeywords: true },
              }}
            />
          </div>

          <div className="pipeline-editor-footer">
            <button
              type="button"
              className="btn-pipeline-run"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Running...' : '▶ Run pipeline'}
            </button>
            {lastRun && (
              <Link to={`/pipelines/run/${lastRun._id}`} className="pipeline-last-run-link">
                Last run: {new Date(lastRun.submittedAt).toLocaleString()} →
              </Link>
            )}
            {submitError && (
              <div className="pipeline-submit-error">
                <strong>Run failed:</strong> {submitError}
              </div>
            )}
          </div>
        </div>

        {/* Right: AI hint panel (Section 11G/11H) */}
        <div className="pipeline-hint-column">
          <AIHintPanel
            problemId={problemId}
            code={stageCode[currentStage?.id] || ''}
            executorType="pipeline"
            isPipeline
            submissionHistory={[]}
            isExecuting={submitting}
          />
        </div>
      </div>
    </div>
  );
}

export default PipelineProblemPage;

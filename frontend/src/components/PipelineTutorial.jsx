import React, { useState, useEffect, useCallback } from 'react';
import './PipelineTutorial.css';

const STORAGE_KEY = 'pipelineTutorialSeen';

const STEPS = [
  {
    title: 'Welcome to pipelines',
    body: `A pipeline is a sequence of stages. Each stage runs in its own container with one of the seven data-engineering tools you already know (Kafka, PySpark, Iceberg, dbt, Airflow, SQL, Python).

The clickstream pipeline has four stages:

  kafka (ingest) → pyspark (enrich) → iceberg (load) → dbt (report)

Stages run in topological order — downstream stages only run when all their dependencies pass.`,
  },
  {
    title: 'Failures propagate',
    body: `When a stage fails, downstream stages are skipped. The pipeline's overall verdict is the conjunction of every stage's verdict.

A failure can come from any of three places:

  • Your code (syntax, logic, off-by-one)
  • Scenario-injected fixture mutations (late data, schema drift, poison messages, OOM)
  • The inter-stage contract (your output shape doesn't match what the next stage expects)

Section 11I's diagnostics panel on the report page tells you which.`,
  },
  {
    title: 'Run a scenario',
    body: `Scenarios inject a known failure so you can practise diagnosing it. Pick one from the dropdown and click Run.

Start with the "tutorial" scenario: it injects an OOM into the enrichment stage. The fix is small (one line on the PipelineProblem schema), the diagnosis is short, and you'll see the full report → hint → score loop in one round-trip.

Each scenario lists which stages and which failure types are injected so you know what to look for.`,
  },
  {
    title: 'Read the report',
    body: `The report page has four sections:

  1. Per-stage results — status, runtime, error, injected failures
  2. Score breakdown — correctness × operational quality. A first-try fix scores higher than a five-attempt shotgun.
  3. Diagnostics — Spark stage table, dbt test results, Kafka lag, Airflow Gantt
  4. Get a hint — the AI tutor reads stageResults[] and proposes a single Socratic nudge

Use these together: the report tells you WHICH stage failed, the diagnostics tell you WHY, the hint tells you WHAT to look up.`,
  },
  {
    title: 'Iterate',
    body: `Each Run produces a new PipelineRun document with its own score. The orchestrator tracks attempts per (problem, scenario) pair and applies the operational score:

  • First-try fix → 1.00 operational
  • Each retry → -0.10
  • Re-submitting identical code → 0.50 (shotgun-debugging penalty)

The score is a multiplier on correctness. A 5th-attempt shotgun scores 0.28; a 5th-attempt code-fix scores 0.73. Aim for first-try fixes.

Ready? Open the scenario dropdown, pick "tutorial", and click Run.`,
  },
];

/**
 * PipelineTutorial — 5-step modal shown the first time a user opens
 * PipelineProblemPage. Subsequent visits skip the modal entirely.
 *
 * Gating:
 *   - Reads localStorage["pipelineTutorialSeen"] on mount.
 *   - Writes "1" when the user clicks "Got it" or finishes the last step.
 *   - Exposes a `seen` callback so the parent can re-trigger (e.g. a
 *     "Replay tutorial" button) by clearing localStorage.
 *
 * The modal is dismissable: clicking the backdrop or pressing Escape
 * counts as "seen" so the user doesn't see it again. The "Skip" link
 * inside the footer is also a dismiss.
 */
function PipelineTutorial({ open, onClose }) {
  const [stepIdx, setStepIdx] = useState(0);

  const close = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
    onClose();
  }, [onClose]);

  // Keyboard: Escape closes, ArrowRight / ArrowLeft navigate.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setStepIdx((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;
  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  return (
    <div
      className="pipeline-tutorial-backdrop"
      onClick={(e) => {
        // Only close when the backdrop itself is clicked, not the dialog.
        if (e.target === e.currentTarget) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pipeline-tutorial-title"
    >
      <div className="pipeline-tutorial-dialog">
        <header className="pipeline-tutorial-header">
          <span className="pipeline-tutorial-step-label">
            Step {stepIdx + 1} of {STEPS.length}
          </span>
          <button
            type="button"
            className="pipeline-tutorial-close"
            onClick={close}
            aria-label="Close tutorial"
          >
            ×
          </button>
        </header>

        <div className="pipeline-tutorial-body">
          <h2 id="pipeline-tutorial-title">{step.title}</h2>
          <p>{step.body}</p>
        </div>

        <div className="pipeline-tutorial-progress">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`pipeline-tutorial-dot ${i === stepIdx ? 'active' : ''} ${i < stepIdx ? 'done' : ''}`}
            />
          ))}
        </div>

        <footer className="pipeline-tutorial-footer">
          <button
            type="button"
            className="pipeline-tutorial-skip"
            onClick={close}
          >
            Skip
          </button>
          <div className="pipeline-tutorial-nav">
            <button
              type="button"
              className="pipeline-tutorial-prev"
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              disabled={stepIdx === 0}
            >
              ← Back
            </button>
            <button
              type="button"
              className="pipeline-tutorial-next"
              onClick={() => {
                if (isLast) close();
                else setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
              }}
            >
              {isLast ? 'Got it ✓' : 'Next →'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Helper for the parent: should we show the tutorial on this mount?
 * Returns true iff the localStorage key is absent or falsy. The
 * caller is expected to render the modal conditionally on this.
 */
export function shouldShowTutorial() {
  try {
    return !localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

/**
 * Helper for the parent: clear the gate so the tutorial will show
 * again on next visit. Used by an optional "Replay tutorial" affordance
 * — the parent can expose this as a button on PipelineProblemPage.
 */
export function resetTutorialGate() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export default PipelineTutorial;

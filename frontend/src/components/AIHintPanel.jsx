import React, { useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import './AIHintPanel.css';

/**
 * AIHintPanel — collapsible right-side panel that streams AI hints for the
 * current problem. Spec section 6D.
 *
 *   - "Get hint" button (disabled while a submission is running)
 *   - POST /api/hints with { problemId, code, executorType, submissionHistory, isPipeline? }
 *   - SSE-style streaming via fetch + ReadableStream (text/event-stream)
 *   - Markdown rendered with react-markdown
 *   - Warns: "Hints are disabled during timed assessments"
 *
 * The panel is intentionally a self-contained component so ProblemSolver can
 * drop it in without knowing about the streaming protocol.
 *
 * Section 11H — the `isPipeline` flag flips the panel into pipeline-hint
 * mode. The backend uses it to load from PipelineProblem / PipelineRun
 * and produce stage-aware hints (Section 11G). The flag is optional and
 * defaults to false, so the existing single-tool flow is unchanged.
 */
function AIHintPanel({
  problemId,
  code,
  executorType,
  submissionHistory,
  isExecuting,
  isTimedAssessment,
  isPipeline,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const fetchHint = useCallback(async () => {
    // Wipe state from any previous hint.
    setHint('');
    setError(null);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = localStorage.getItem('token');
      const apiBase = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${apiBase}/api/hints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          problemId,
          code,
          executorType,
          // Section 11H — opt into pipeline-hint mode. The backend
          // routes PipelineProblem / PipelineRun when this is true.
          isPipeline: !!isPipeline,
          // Spec 6D: stream the last 3 submissions. submissionHistory is
          // expected to be an array of submission objects in chronological
          // order; we take the tail and trim to the executor-aware fields.
          submissionHistory: (submissionHistory || [])
            .slice(-3)
            .map(s => ({
              status: s.status,
              runtime: s.runtime,
              error: s.error,
              executorType: s.executorType,
              toolVersion: s.toolVersion,
              // Section 11G — pipeline runs carry stageResults[]; pass it
              // through so the system prompt can branch on the failing
              // stage. Non-pipeline history items don't have it.
              stageResults: s.stageResults,
            })),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          text || `Hint request failed: ${response.status} ${response.statusText}`
        );
      }

      // The backend sends SSE: lines beginning with "data: " carrying
      // chunks of the hint. We accumulate text between data lines until
      // the stream closes. If the backend ever switches to plain text
      // streaming (no SSE framing), the same loop still works because
      // each non-empty line just gets appended.
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Hint response had no readable stream');
      }
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by blank lines; within a message,
        // multiple `data:` lines concatenate. For a simple chunked-text
        // stream we just split on newlines and consume any non-empty
        // lines as chunks.
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx).trimEnd();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;
          if (line.startsWith('data:')) {
            const payload = line.slice(5).trimStart();
            if (payload === '[DONE]') break;
            if (payload.startsWith('{')) {
              // JSON event — only handle {text|error|done} for forward
              // compatibility with structured event payloads.
              try {
                const evt = JSON.parse(payload);
                if (typeof evt.text === 'string') {
                  setHint(prev => prev + evt.text);
                } else if (typeof evt.error === 'string') {
                  setError(evt.error);
                } else if (evt.done) {
                  break;
                }
              } catch {
                setHint(prev => prev + payload);
              }
            } else if (payload) {
              setHint(prev => prev + payload);
            }
          } else if (line) {
            // No SSE prefix — treat as raw text chunk.
            setHint(prev => prev + line);
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Failed to get hint');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [problemId, code, executorType, submissionHistory, isPipeline]);

  const cancel = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  };

  return (
    <aside className={`ai-hint-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="ai-hint-header">
        <button
          type="button"
          className="ai-hint-collapse"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expand hints' : 'Collapse hints'}
        >
          {collapsed ? '◀' : '▶'}
        </button>
        <h3 className="ai-hint-title">AI Hints</h3>
        {!collapsed && (
          <button
            type="button"
            className="ai-hint-get"
            onClick={fetchHint}
            disabled={loading || isExecuting || isTimedAssessment}
          >
            {loading ? 'Thinking...' : 'Get hint'}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="ai-hint-body">
          {isTimedAssessment && (
            <div className="ai-hint-warning">
              Hints are disabled during timed assessments.
            </div>
          )}

          {isExecuting && (
            <div className="ai-hint-info">
              Wait for the current run to finish before requesting a hint.
            </div>
          )}

          {loading && (
            <button
              type="button"
              className="ai-hint-cancel"
              onClick={cancel}
            >
              Cancel
            </button>
          )}

          {error && (
            <div className="ai-hint-error">
              <strong>Error:</strong> {error}
            </div>
          )}

          {hint && (
            <div className="ai-hint-content">
              <ReactMarkdown
                components={{
                  // Tighten up the prose within the panel.
                  p: ({ children }) => <p className="ai-hint-p">{children}</p>,
                  code: ({ inline, children }) =>
                    inline ? (
                      <code className="ai-hint-inline-code">{children}</code>
                    ) : (
                      <pre className="ai-hint-code">
                        <code>{children}</code>
                      </pre>
                    ),
                  ul: ({ children }) => <ul className="ai-hint-ul">{children}</ul>,
                  ol: ({ children }) => <ol className="ai-hint-ol">{children}</ol>,
                  li: ({ children }) => <li className="ai-hint-li">{children}</li>,
                  h1: ({ children }) => <h4 className="ai-hint-h1">{children}</h4>,
                  h2: ({ children }) => <h4 className="ai-hint-h2">{children}</h4>,
                  h3: ({ children }) => <h4 className="ai-hint-h3">{children}</h4>,
                }}
              >
                {hint}
              </ReactMarkdown>
            </div>
          )}

          {!hint && !error && !loading && !isExecuting && !isTimedAssessment && (
            <p className="ai-hint-placeholder">
              Need a nudge? Click <strong>Get hint</strong> for a Socratic hint tailored to your current code and submission history.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

export default AIHintPanel;

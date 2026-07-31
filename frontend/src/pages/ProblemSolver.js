import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { problemsAPI, submissionsAPI, forumAPI } from '../services/api';
import AIHintPanel from '../components/AIHintPanel';
import './ProblemSolver.css';

const DEFAULT_CODE = `# Write your solution here
def solution():
    pass
`;

// Per-executor Monaco language. Spec 6B: `python` → `python`; `sql`, `dbt`
// → `sql`; everything else (pyspark, airflow, kafka, iceberg) → `python`.
const EXECUTOR_LANGUAGE = {
  python: 'python',
  sql: 'sql',
  dbt: 'sql',
  pyspark: 'python',
  airflow: 'python',
  kafka: 'python',
  iceberg: 'python',
};

// Human-readable toolVersion per executor for the "Running on" badge.
// Mirrors the toolVersion strings in backend/services/executorRouter.js.
const EXECUTOR_TOOL_VERSION = {
  python: 'Python 3.11',
  sql: 'DuckDB 0.10 (Snowflake-compatible SQL)',
  pyspark: 'PySpark 3.5',
  dbt: 'dbt-core 1.7 (DuckDB adapter)',
  airflow: 'Apache Airflow 2.9',
  kafka: 'Kafka 3.7 (KRaft mode)',
  iceberg: 'PyIceberg 0.7 / DuckDB (Databricks-Iceberg)',
};

function ProblemSolver() {
  const { id } = useParams();
  const [problem, setProblem] = useState(null);
  const [code, setCode] = useState(DEFAULT_CODE);
  const [output, setOutput] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('description');

  // Submissions tab state
  const [submissions, setSubmissions] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);

  // Discuss tab state
  const [discussions, setDiscussions] = useState([]);
  const [discLoading, setDiscLoading] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newComment, setNewComment] = useState('');
  const [activeDiscussion, setActiveDiscussion] = useState(null);
  const [discussionComment, setDiscussionComment] = useState('');

  const user = JSON.parse(localStorage.getItem('user') || 'null');

  const fetchProblem = useCallback(async () => {
    try {
      setLoading(true);
      const response = await problemsAPI.getById(id);
      const p = response.data;
      setProblem(p);

      // Spec 6B: fetch the executorType-specific starterCode, not the
      // generic solution.code (which is the model answer). Fall back to
      // DEFAULT_CODE if neither is present so the editor is never blank.
      const executorType = p.executorType || 'python';
      const starterCodeMap = p.starterCode || {};
      const perTypeStarter = starterCodeMap[executorType];
      if (typeof perTypeStarter === 'string' && perTypeStarter.length > 0) {
        setCode(perTypeStarter);
      } else if (p.solution?.code) {
        setCode(p.solution.code + '\n\n# Write your test and submit');
      } else {
        setCode(DEFAULT_CODE);
      }
    } catch (err) {
      console.error('Error fetching problem:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProblem();
  }, [fetchProblem]);

  const fetchSubmissions = useCallback(async () => {
    if (!user?.id) return;
    try {
      setSubsLoading(true);
      const response = await submissionsAPI.getProblemSubmissions(id, user.id);
      setSubmissions(response.data);
    } catch (err) {
      console.error('Error fetching submissions:', err);
    } finally {
      setSubsLoading(false);
    }
  }, [id, user?.id]);

  const fetchDiscussions = useCallback(async () => {
    try {
      setDiscLoading(true);
      const response = await forumAPI.getDiscussions(id);
      setDiscussions(response.data);
    } catch (err) {
      console.error('Error fetching discussions:', err);
    } finally {
      setDiscLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (activeTab === 'submissions' && user?.id) {
      fetchSubmissions();
    }
    if (activeTab === 'discuss') {
      fetchDiscussions();
    }
  }, [activeTab, fetchSubmissions, fetchDiscussions, user?.id]);

  // Bug 3 fix: keep the polling timer IDs in a ref so the unmount
  // cleanup can clear them. Without this, navigating away mid-poll
  // would leak setInterval ticks (and React state-set-on-unmounted warnings).
  const pollHandlesRef = useRef({ interval: null, timeout: null });

  useEffect(() => {
    return () => {
      const { interval, timeout } = pollHandlesRef.current;
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async () => {
    if (!user?.id) {
      setOutput({ error: 'Please login to submit code' });
      return;
    }

    // Bug 3 fix: submissions are now async via BullMQ, so the POST
    // returns the freshly-created Submission with status='Pending'.
    // The actual result lands after the worker picks up the job, so
    // we poll the per-submission GET endpoint until status is no
    // longer 'Pending' (or we hit a 2-minute ceiling).

    const stopPolling = () => {
      if (pollHandlesRef.current.interval) clearInterval(pollHandlesRef.current.interval);
      if (pollHandlesRef.current.timeout) clearTimeout(pollHandlesRef.current.timeout);
      pollHandlesRef.current.interval = null;
      pollHandlesRef.current.timeout = null;
    };

    try {
      setSubmitting(true);
      setOutput({ status: 'Pending', message: 'Queued — waiting for execution...' });

      // Spec 6B: include executorType so the router picks the right image
      // (python/sql/pyspark/dbt/airflow/kafka/iceberg). Falls back to
      // 'python' for legacy problems that don't have the field.
      const response = await submissionsAPI.submit({
        userId: user.id,
        problemId: id,
        code,
        language: 'python',
        executorType: problem?.executorType || 'python',
      });

      const submissionId = response.data._id;

      const finishWithSubmission = (submission) => {
        let results = [];
        try {
          results = typeof submission.output === 'string'
            ? JSON.parse(submission.output)
            : (submission.output || []);
        } catch (e) {
          results = [];
        }
        setOutput({
          status: submission.status,
          testCasesPassed: submission.testCasesPassed,
          totalTestCases: submission.totalTestCases,
          runtime: submission.runtime,
          executionRuntime: submission.executionRuntime,
          toolVersion: submission.toolVersion,
          executorType: submission.executorType,
          results,
          error: submission.error,
        });
      };

      // Poll every 2s until status leaves 'Pending'. Backend updates the
      // submission doc atomically when the worker finishes, so a single
      // fetch gives us the full terminal state.
      pollHandlesRef.current.interval = setInterval(async () => {
        try {
          const statusRes = await submissionsAPI.getById(submissionId, {
            userId: user.id,
          });
          const sub = statusRes.data;
          if (sub && sub.status && sub.status !== 'Pending') {
            stopPolling();
            finishWithSubmission(sub);
            setSubmitting(false);
          }
        } catch (pollErr) {
          // Network blip on one poll — keep trying until the timeout.
          // Don't surface to the user; the next tick might succeed.
          console.warn('Polling submission status failed:', pollErr.message);
        }
      }, 2000);

      // Give up after 2 minutes. The worker may still be processing,
      // but the user shouldn't see a spinner forever — surface a TLE
      // and let them retry from the Submissions tab.
      pollHandlesRef.current.timeout = setTimeout(() => {
        stopPolling();
        setSubmitting(false);
        setOutput({
          status: 'Time Limit Exceeded',
          error: 'Execution took longer than 2 minutes. Try a simpler approach.',
        });
      }, 120000);

    } catch (err) {
      stopPolling();
      setSubmitting(false);
      setOutput({
        error: err.response?.data?.error || err.message || 'Submission failed'
      });
    }
  };

  const handleCreateDiscussion = async () => {
    if (!newTitle.trim() || !user?.id) return;
    try {
      await forumAPI.createDiscussion({
        problemId: id,
        userId: user.id,
        title: newTitle.trim()
      });
      setNewTitle('');
      fetchDiscussions();
    } catch (err) {
      console.error('Error creating discussion:', err);
    }
  };

  const handleAddComment = async (discussionId, content) => {
    if (!content.trim() || !user?.id) return;
    try {
      await forumAPI.addComment(discussionId, {
        userId: user.id,
        content: content.trim()
      });
      setDiscussionComment('');
      fetchDiscussions();
    } catch (err) {
      console.error('Error adding comment:', err);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Accepted': return '#52c41a';
      case 'Wrong Answer': return '#f5222d';
      case 'Time Limit Exceeded': return '#faad14';
      case 'Runtime Error': return '#ff7a45';
      default: return '#999';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Accepted': return '✓';
      case 'Wrong Answer': return '✗';
      case 'Time Limit Exceeded': return '⏱';
      case 'Runtime Error': return '⚠';
      default: return '○';
    }
  };

  if (loading) return <div className="loading">Loading problem...</div>;

  return (
    <div className="problem-solver">
      <div className="solver-container">
        {/* Left Panel: Problem Description / Tabs */}
        <div className="problem-panel">
          <div className="problem-tabs">
            <button
              className={`tab ${activeTab === 'description' ? 'active' : ''}`}
              onClick={() => setActiveTab('description')}
            >
              Description
            </button>
            <button
              className={`tab ${activeTab === 'submissions' ? 'active' : ''}`}
              onClick={() => setActiveTab('submissions')}
            >
              Submissions
            </button>
            <button
              className={`tab ${activeTab === 'discuss' ? 'active' : ''}`}
              onClick={() => setActiveTab('discuss')}
            >
              Discuss
            </button>
            <button
              className={`tab ${activeTab === 'solution' ? 'active' : ''}`}
              onClick={() => setActiveTab('solution')}
            >
              Solution
            </button>
          </div>

          <div className="problem-content">
            {/* Description Tab */}
            {activeTab === 'description' && (
              <div className="description">
                <h1>{problem?.title}</h1>
                <div className="problem-meta">
                  <span className={`difficulty difficulty-${problem?.difficulty?.toLowerCase()}`}>
                    {problem?.difficulty}
                  </span>
                  {problem?.executorType && (
                    <span className={`executor-tag executor-${problem.executorType}`}>
                      {problem.executorType}
                    </span>
                  )}
                  {problem?.track && (
                    <span className="track-tag">{problem.track}</span>
                  )}
                  <span className="category">{problem?.category}</span>
                  <span className="acceptance">{problem?.acceptanceRate}% Acceptance</span>
                  <span className="submission-count">{problem?.submissions} submissions</span>
                </div>

                <div className="problem-description">
                  <h3>Problem Description</h3>
                  <pre className="desc-text">{problem?.description}</pre>
                </div>

                {problem?.examples?.length > 0 && (
                  <div className="examples">
                    <h3>Examples</h3>
                    {problem.examples.map((ex, idx) => (
                      <div key={idx} className="example">
                        <div className="example-item">
                          <strong>Input:</strong>
                          <code>{ex.input}</code>
                        </div>
                        <div className="example-item">
                          <strong>Output:</strong>
                          <code>{ex.output}</code>
                        </div>
                        {ex.explanation && (
                          <div className="example-item">
                            <strong>Explanation:</strong>
                            <p>{ex.explanation}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {problem?.constraints && (
                  <div className="constraints">
                    <h3>Constraints</h3>
                    <p>{problem.constraints}</p>
                  </div>
                )}

                {problem?.hints?.length > 0 && (
                  <div className="hints">
                    <h3>Hints</h3>
                    {problem.hints.map((hint, idx) => (
                      <div key={idx} className="hint-card">
                        {String.fromCodePoint(0x1F4A1)} {hint}
                      </div>
                    ))}
                  </div>
                )}

                {problem?.tags?.length > 0 && (
                  <div className="tags-section">
                    <h3>Related Topics</h3>
                    <div className="tags">
                      {problem.tags.map((tag, idx) => (
                        <span key={idx} className="tag">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Submissions Tab */}
            {activeTab === 'submissions' && (
              <div className="submissions-tab">
                <h3>Your Submissions</h3>
                {!user?.id ? (
                  <p className="placeholder-text">Please login to view your submissions.</p>
                ) : subsLoading ? (
                  <p className="placeholder-text">Loading submissions...</p>
                ) : submissions.length === 0 ? (
                  <p className="placeholder-text">No submissions yet. Write your code and submit!</p>
                ) : (
                  <div className="submissions-list">
                    {submissions.map((sub) => (
                      <div key={sub._id} className="submission-item">
                        <div className="submission-header">
                          <span
                            className="submission-status"
                            style={{ color: getStatusColor(sub.status) }}
                          >
                            {getStatusIcon(sub.status)} {sub.status}
                          </span>
                          <span className="submission-time">
                            {new Date(sub.submittedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="submission-details">
                          <span>Tests: {sub.testCasesPassed}/{sub.totalTestCases}</span>
                          {sub.runtime != null && <span>Runtime: {sub.runtime} ms</span>}
                          {sub.executionRuntime != null && (
                            <span>Wall-clock: {sub.executionRuntime} ms</span>
                          )}
                          <span>Language: {sub.language}</span>
                          {sub.executorType && (
                            <span className={`executor-tag executor-${sub.executorType}`}>
                              {sub.executorType}
                            </span>
                          )}
                          {sub.toolVersion && <span>on {sub.toolVersion}</span>}
                        </div>
                        {sub.error && (
                          <div className="submission-error">
                            <pre>{sub.error}</pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Discuss Tab */}
            {activeTab === 'discuss' && (
              <div className="discuss-tab">
                <h3>Discussion</h3>

                {user?.id && (
                  <div className="new-discussion">
                    <input
                      type="text"
                      placeholder="Start a new discussion..."
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateDiscussion()}
                    />
                    <button onClick={handleCreateDiscussion} disabled={!newTitle.trim()}>
                      Post
                    </button>
                  </div>
                )}

                {discLoading ? (
                  <p className="placeholder-text">Loading discussions...</p>
                ) : discussions.length === 0 ? (
                  <p className="placeholder-text">No discussions yet. Be the first to start one!</p>
                ) : (
                  <div className="discussions-list">
                    {discussions.map((disc) => (
                      <div key={disc._id} className="discussion-card">
                        <div className="discussion-header">
                          <strong>{disc.userId?.username || 'Anonymous'}</strong>
                          <span className="discussion-time">
                            {new Date(disc.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <h4>{disc.title}</h4>

                        {disc.comments?.length > 0 && (
                          <div className="comments-section">
                            {disc.comments.map((comment, ci) => (
                              <div key={comment._id || ci} className="comment">
                                <div className="comment-header">
                                  <strong>{comment.userId?.username || 'Anonymous'}</strong>
                                  <span>{new Date(comment.createdAt).toLocaleString()}</span>
                                </div>
                                <p>{comment.content}</p>

                                {comment.replies?.length > 0 && (
                                  <div className="replies">
                                    {comment.replies.map((reply, ri) => (
                                      <div key={reply._id || ri} className="reply">
                                        <strong>{reply.userId?.username || 'Anonymous'}</strong>
                                        <span>{new Date(reply.createdAt).toLocaleString()}</span>
                                        <p>{reply.content}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {user?.id && (
                          <div className="add-comment">
                            <input
                              type="text"
                              placeholder="Add a comment..."
                              value={activeDiscussion === disc._id ? discussionComment : ''}
                              onFocus={() => setActiveDiscussion(disc._id)}
                              onChange={(e) => {
                                setActiveDiscussion(disc._id);
                                setDiscussionComment(e.target.value);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && activeDiscussion === disc._id) {
                                  handleAddComment(disc._id, discussionComment);
                                }
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Solution Tab */}
            {activeTab === 'solution' && (
              <div className="solution-tab">
                <h3>Official Solution</h3>
                {problem?.solution?.explanation ? (
                  <>
                    <div className="solution-explanation">
                      <h4>Approach</h4>
                      <p>{problem.solution.explanation}</p>
                    </div>
                    {problem.solution.complexity && (
                      <div className="solution-complexity">
                        <h4>Complexity</h4>
                        <div className="complexity-badges">
                          <span className="complexity-badge time">
                            Time: {problem.solution.complexity.time}
                          </span>
                          <span className="complexity-badge space">
                            Space: {problem.solution.complexity.space}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="solution-code">
                      <h4>Solution Code</h4>
                      <pre><code>{problem.solution.code}</code></pre>
                    </div>
                  </>
                ) : (
                  <p className="placeholder-text">
                    Solution will be available after you solve this problem.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Code Editor */}
        <div className="editor-panel">
          <div className="editor-header">
            <span className="language-badge">
              {/* Spec 6B: "Running on: PySpark 3.5 · DuckDB 0.10" badge */}
              Running on: {EXECUTOR_TOOL_VERSION[problem?.executorType || 'python'] || 'Python 3.11'}
            </span>
            <div className="editor-actions">
              <button
                className="btn-reset"
                onClick={() => {
                  // Reset back to the per-executor starterCode (the model
                  // answer isn't what we want here — spec says the editor
                  // pre-fills with the boilerplate for that tool).
                  const starter = problem?.starterCode?.[problem?.executorType || 'python'];
                  setCode(typeof starter === 'string' && starter.length > 0 ? starter : DEFAULT_CODE);
                }}
              >
                Reset
              </button>
            </div>
          </div>

          <div className="monaco-wrapper">
            <Editor
              // Bug 5 fix: key={problem._id} forces Monaco to fully
              // remount when navigating between problems. Without it
              // the editor's internal state (selection, undo history,
              // cursor position) carries over from the previous
              // problem — `value={code}` updates the visible text but
              // doesn't reset Monaco's internal buffers.
              key={problem?._id}
              height="100%"
              language={EXECUTOR_LANGUAGE[problem?.executorType || 'python'] || 'python'}
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value || '')}
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
                bracketPairColorization: { enabled: true },
              }}
            />
          </div>

          <div className="editor-footer">
            <button
              className="btn-run"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Running...' : '▶ Run Code'}
            </button>
            <button
              className="btn-submit"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : '✓ Submit'}
            </button>
          </div>

          {/* Output Panel */}
          <div className="output-panel">
            <div className="output-header">
              <h4>Output</h4>
              {output?.status && (
                <span
                  className="output-status"
                  style={{ color: getStatusColor(output.status) }}
                >
                  {getStatusIcon(output.status)} {output.status}
                </span>
              )}
            </div>
            <div className="output-content">
              {!output ? (
                <span className="output-placeholder">Run your code to see output here...</span>
              ) : output.status === 'Pending' ? (
                // Bug 3 fix: while polling the BullMQ result, surface a
                // "waiting" message instead of trying to render an empty
                // results table (which would show "Passed 0/0 test cases"
                // and confuse the user).
                <div className="output-pending">
                  <span className="spinner" aria-hidden="true">⏳</span>
                  <span>{output.message || 'Execution in progress...'}</span>
                </div>
              ) : output.error && !output.results ? (
                <div className="output-error">
                  <pre>{output.error}</pre>
                </div>
              ) : (
                <div className="test-results">
                  <div className="results-summary">
                    Passed {output.testCasesPassed}/{output.totalTestCases} test cases
                    {output.runtime != null && (
                      <span className="runtime-info">
                        {' | '}Runtime: {output.runtime} ms (avg)
                      </span>
                    )}
                  </div>

                  {output.results?.map((result, idx) => (
                    <div
                      key={idx}
                      className={`test-case-result ${result.passed ? 'passed' : 'failed'}`}
                    >
                      <div className="test-case-header">
                        <span className="test-case-number">Test Case {idx + 1}</span>
                        <span
                          className="test-case-status"
                          style={{ color: result.passed ? '#52c41a' : '#f5222d' }}
                        >
                          {result.passed ? '✓ Passed' : '✗ Failed'}
                        </span>
                      </div>
                      <div className="test-case-detail">
                        <div><strong>Input:</strong> {result.input}</div>
                        <div><strong>Expected:</strong> {result.expected}</div>
                        <div>
                          <strong>Actual:</strong>{' '}
                          <span style={{ color: result.passed ? '#52c41a' : '#f5222d' }}>
                            {result.actual ?? 'null'}
                          </span>
                        </div>
                        {result.error && (
                          <div className="test-case-error">
                            <strong>Error:</strong> <pre>{result.error}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right of the editor: AI hint panel (Spec 6D). Wraps with the
            editor-panel in a flex container so the hint panel collapses
            without disturbing the editor's layout. */}
        <div className="hint-column">
          <AIHintPanel
            problemId={id}
            code={code}
            executorType={problem?.executorType}
            submissionHistory={submissions}
            isExecuting={submitting}
            // Assessments aren't wired yet (Section 8); the prop defaults
            // to false so hints are usable everywhere for now.
            isTimedAssessment={false}
          />
        </div>
      </div>
    </div>
  );
}

export default ProblemSolver;
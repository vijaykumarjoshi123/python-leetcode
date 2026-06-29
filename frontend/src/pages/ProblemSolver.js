import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { problemsAPI, submissionsAPI, forumAPI } from '../services/api';
import './ProblemSolver.css';

const DEFAULT_CODE = `# Write your solution here
def solution():
    pass
`;

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
      setProblem(response.data);
      // Set starter code with the problem's function signature if available
      if (response.data.solution?.code) {
        setCode(response.data.solution.code + '\n\n# Write your test and submit');
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

  const handleSubmit = async () => {
    if (!user?.id) {
      setOutput({ error: 'Please login to submit code' });
      return;
    }

    try {
      setSubmitting(true);
      setOutput(null);
      const response = await submissionsAPI.submit({
        userId: user.id,
        problemId: id,
        code,
        language: 'python'
      });

      const submission = response.data;
      let results = [];
      try {
        results = typeof submission.output === 'string'
          ? JSON.parse(submission.output)
          : submission.output;
      } catch (e) {
        results = [];
      }

      setOutput({
        status: submission.status,
        testCasesPassed: submission.testCasesPassed,
        totalTestCases: submission.totalTestCases,
        runtime: submission.runtime,
        results,
        error: submission.error
      });
    } catch (err) {
      setOutput({
        error: err.response?.data?.error || err.message || 'Submission failed'
      });
    } finally {
      setSubmitting(false);
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
                          <span>Language: {sub.language}</span>
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
            <span className="language-badge">Python 3</span>
            <div className="editor-actions">
              <button
                className="btn-reset"
                onClick={() => setCode(problem?.solution?.code || DEFAULT_CODE)}
              >
                Reset
              </button>
            </div>
          </div>

          <div className="monaco-wrapper">
            <Editor
              height="100%"
              defaultLanguage="python"
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
      </div>
    </div>
  );
}

export default ProblemSolver;
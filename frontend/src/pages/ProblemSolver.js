import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import './ProblemSolver.css';

function ProblemSolver() {
  const { id } = useParams();
  const [problem, setProblem] = useState(null);
  const [code, setCode] = useState('# Write your solution here\n');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('description');

  useEffect(() => {
    fetchProblem();
  }, [id]);

  const fetchProblem = async () => {
    try {
      const response = await axios.get(`/api/problems/${id}`);
      setProblem(response.data);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching problem:', err);
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      const userId = JSON.parse(localStorage.getItem('user'))?.id;
      const response = await axios.post('/api/submissions/submit', {
        userId,
        problemId: id,
        code,
        language: 'python'
      });
      
      setOutput(JSON.stringify(response.data, null, 2));
    } catch (err) {
      setOutput('Error: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading">Loading problem...</div>;

  return (
    <div className="problem-solver">
      <div className="solver-container">
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
          </div>

          <div className="problem-content">
            {activeTab === 'description' && (
              <div className="description">
                <h1>{problem?.title}</h1>
                <div className="problem-meta">
                  <span className={`difficulty difficulty-${problem?.difficulty.toLowerCase()}`}>
                    {problem?.difficulty}
                  </span>
                  <span className="category">{problem?.category}</span>
                  <span className="acceptance">{problem?.acceptanceRate}% Acceptance</span>
                </div>

                <div className="problem-description">
                  <h3>Description</h3>
                  <p>{problem?.description}</p>
                </div>

                <div className="examples">
                  <h3>Examples</h3>
                  {problem?.examples?.map((ex, idx) => (
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

                <div className="hints">
                  <h3>Hints</h3>
                  {problem?.hints?.map((hint, idx) => (
                    <div key={idx} className="hint-card">
                      💡 {hint}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'submissions' && (
              <div className="submissions">
                <p>Your submission history will appear here</p>
              </div>
            )}

            {activeTab === 'discuss' && (
              <div className="discuss">
                <p>Community discussions will appear here</p>
              </div>
            )}
          </div>
        </div>

        <div className="editor-panel">
          <div className="editor-header">
            <span className="language-badge">Python</span>
            <div className="editor-actions">
              <button className="btn-hint">💡 Hint</button>
              <button className="btn-reset" onClick={() => setCode('# Write your solution here\n')}>
                Reset
              </button>
            </div>
          </div>

          <textarea
            className="code-editor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck="false"
          />

          <div className="editor-footer">
            <button 
              className="btn-submit" 
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : '✓ Submit Solution'}
            </button>
          </div>

          <div className="output-panel">
            <h4>Output</h4>
            <pre className="output-content">{output || 'Output will appear here...'}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProblemSolver;

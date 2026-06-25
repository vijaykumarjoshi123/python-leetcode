import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import './Problem.css';

function Problem() {
  const { id } = useParams();
  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProblem();
  }, [id]);

  const fetchProblem = async () => {
    try {
      const response = await axios.get(`/api/problems/${id}`);
      setProblem(response.data);
    } catch (err) {
      console.error('Error fetching problem:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="problem-view">
      <div className="problem-view-container">
        <h1>{problem?.title}</h1>
        <div className="problem-meta">
          <span className={`difficulty difficulty-${problem?.difficulty.toLowerCase()}`}>
            {problem?.difficulty}
          </span>
          <span className="category">{problem?.category}</span>
        </div>

        <div className="problem-description">
          {problem?.description}
        </div>

        <div className="examples">
          <h3>Examples</h3>
          {problem?.examples?.map((ex, idx) => (
            <div key={idx} className="example">
              <strong>Input:</strong> {ex.input}<br/>
              <strong>Output:</strong> {ex.output}
            </div>
          ))}
        </div>

        <Link to={`/solve/${id}`} className="btn-solve">
          Solve This Problem
        </Link>
      </div>
    </div>
  );
}

export default Problem;

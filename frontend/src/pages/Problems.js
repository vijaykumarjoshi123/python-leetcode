import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { problemsAPI } from '../services/api';
import './Problems.css';

function Problems() {
  const [problems, setProblems] = useState([]);
  const [filters, setFilters] = useState({ difficulty: '', category: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState([]);

  const fetchProblems = useCallback(async () => {
    try {
      setLoading(true);
      const params = { ...filters, page, limit: 20 };
      Object.keys(params).forEach(key => {
        if (!params[key]) delete params[key];
      });
      const response = await problemsAPI.getAll(params);
      setProblems(response.data.problems);
      setTotalPages(response.data.pages || 1);
    } catch (err) {
      console.error('Error fetching problems:', err);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await problemsAPI.getCategories();
      setCategories(response.data);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  }, []);

  useEffect(() => {
    fetchProblems();
  }, [fetchProblems]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setPage(1);
  };

  const getDifficultyColor = (difficulty) => {
    switch (difficulty) {
      case 'Easy': return '#52c41a';
      case 'Medium': return '#faad14';
      case 'Hard': return '#f5222d';
      default: return '#666';
    }
  };

  const isSolved = (problemId) => {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!user) return false;
    // This will be updated when the user data includes solvedProblems
    return false;
  };

  return (
    <div className="problems-page">
      <div className="problems-container">
        <div className="problems-header">
          <h1>Problems</h1>
          <p className="problems-subtitle">Practice Python with {problems.length}+ curated challenges</p>
        </div>

        <div className="filters">
          <div className="filter-group">
            <label>Difficulty</label>
            <select
              name="difficulty"
              value={filters.difficulty}
              onChange={handleFilterChange}
            >
              <option value="">All Difficulties</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Category</label>
            <select
              name="category"
              value={filters.category}
              onChange={handleFilterChange}
            >
              <option value="">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Search</label>
            <input
              type="text"
              name="search"
              value={filters.search}
              onChange={handleFilterChange}
              placeholder="Search by title or description..."
            />
          </div>
        </div>

        {loading ? (
          <div className="loading">Loading problems...</div>
        ) : problems.length === 0 ? (
          <div className="no-results">
            <p>No problems found matching your filters.</p>
            <button onClick={() => { setFilters({ difficulty: '', category: '', search: '' }); setPage(1); }}>
              Clear Filters
            </button>
          </div>
        ) : (
          <>
            <div className="problems-list">
              <table>
                <thead>
                  <tr>
                    <th className="col-status">Status</th>
                    <th className="col-title">Title</th>
                    <th className="col-difficulty">Difficulty</th>
                    <th className="col-category">Category</th>
                    <th className="col-acceptance">Acceptance</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map(problem => (
                    <tr key={problem._id}>
                      <td>
                        <div className={`status-icon ${isSolved(problem._id) ? 'solved' : ''}`}>
                          {isSolved(problem._id) ? '✓' : ''}
                        </div>
                      </td>
                      <td>
                        <Link to={`/problem/${problem._id}`} className="problem-link">
                          {problem.title}
                        </Link>
                      </td>
                      <td>
                        <span
                          className="difficulty-badge"
                          style={{ color: getDifficultyColor(problem.difficulty) }}
                        >
                          {problem.difficulty}
                        </span>
                      </td>
                      <td className="category-cell">{problem.category}</td>
                      <td>{problem.acceptanceRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="pagination-btn"
              >
                Previous
              </button>
              <span className="page-info">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className="pagination-btn"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Problems;
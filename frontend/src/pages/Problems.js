import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import './Problems.css';

function Problems() {
  const [problems, setProblems] = useState([]);
  const [filters, setFilters] = useState({ difficulty: '', category: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    fetchProblems();
    fetchCategories();
  }, [filters, page]);

  const fetchProblems = async () => {
    try {
      setLoading(true);
      const params = { ...filters, page, limit: 20 };
      const response = await axios.get('/api/problems', { params });
      setProblems(response.data.problems);
    } catch (err) {
      console.error('Error fetching problems:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await axios.get('/api/problems/categories');
      setCategories(response.data);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters({ ...filters, [name]: value });
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

  return (
    <div className="problems-page">
      <div className="problems-container">
        <h1>Solve Problems</h1>
        
        <div className="filters">
          <div className="filter-group">
            <label>Difficulty:</label>
            <select 
              name="difficulty" 
              value={filters.difficulty} 
              onChange={handleFilterChange}
            >
              <option value="">All</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Category:</label>
            <select 
              name="category" 
              value={filters.category} 
              onChange={handleFilterChange}
            >
              <option value="">All</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Search:</label>
            <input 
              type="text" 
              name="search" 
              value={filters.search} 
              onChange={handleFilterChange}
              placeholder="Search problems..."
            />
          </div>
        </div>

        {loading ? (
          <div className="loading">Loading problems...</div>
        ) : (
          <div className="problems-list">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Title</th>
                  <th>Difficulty</th>
                  <th>Category</th>
                  <th>Acceptance</th>
                </tr>
              </thead>
              <tbody>
                {problems.map(problem => (
                  <tr key={problem._id}>
                    <td><div className="status-icon">✓</div></td>
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
                    <td>{problem.category}</td>
                    <td>{problem.acceptanceRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <button 
            onClick={() => setPage(Math.max(1, page - 1))} 
            disabled={page === 1}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}

export default Problems;

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { problemsAPI } from '../services/api';
import './Problems.css';

// Tracks shown in the sidebar. "all" is a meta-value rendered first.
const TRACKS = [
  { id: 'all', label: 'All problems' },
  { id: 'foundations', label: 'Foundations (Python, SQL)' },
  { id: 'data-engineering', label: 'Data engineering (PySpark, dbt)' },
  { id: 'orchestration', label: 'Orchestration (Airflow)' },
  { id: 'streaming', label: 'Streaming (Kafka)' },
  { id: 'lakehouse', label: 'Lakehouse (Iceberg, Delta)' },
];

// Pill colours per executorType. Sub-section 6A spec: "blue for Python,
// green for SQL, orange for PySpark, teal for dbt, purple for Airflow, red
// for Kafka, amber for Iceberg."
const EXECUTOR_PILL_COLORS = {
  python: '#3b82f6',
  sql: '#22c55e',
  pyspark: '#f97316',
  dbt: '#14b8a6',
  airflow: '#a855f7',
  kafka: '#ef4444',
  iceberg: '#f59e0b',
};

function Problems() {
  const [searchParams] = useSearchParams();
  // Initial activeTrack honours a deep link like /problems?track=lakehouse.
  // The backend honours the same query param so the filtered list is
  // server-correct (see routes/problems.js). Falls back to 'all' when
  // the URL doesn't carry a track or the value is unknown.
  const initialTrack = (() => {
    const t = searchParams.get('track');
    return t && TRACKS.some(track => track.id === t) ? t : 'all';
  })();
  const [problems, setProblems] = useState([]);
  const [filters, setFilters] = useState({ difficulty: '', category: '', search: '' });
  const [activeTrack, setActiveTrack] = useState(initialTrack);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState([]);

  const fetchProblems = useCallback(async () => {
    try {
      setLoading(true);
      // We always fetch the full set (limit: 100) regardless of the
      // active track — the sidebar counts (trackCounts memo below) are
      // derived from this set. Client-side filtering then narrows the
      // visible list when the user clicks a track. Server-side track
      // filtering is supported by the backend (see routes/problems.js)
      // and used by direct URL navigation (?track=lakehouse), but the
      // interactive sidebar drives the visible list without a
      // round-trip so the counts stay stable.
      const params = { ...filters, page, limit: 100 };
      Object.keys(params).forEach(key => {
        if (params[key] === undefined || params[key] === '' || params[key] === null) {
          delete params[key];
        }
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

  // Counts per track, computed from the full fetched set. Memoised so we
  // don't recompute on every render.
  const trackCounts = useMemo(() => {
    const counts = { all: problems.length };
    for (const t of TRACKS) {
      if (t.id !== 'all') counts[t.id] = 0;
    }
    for (const p of problems) {
      const t = p.track || 'foundations';
      if (counts[t] !== undefined) counts[t] += 1;
    }
    return counts;
  }, [problems]);

  // Track filter is applied client-side; the existing server filters
  // (difficulty, category, search) still apply.
  const visibleProblems = useMemo(() => {
    if (activeTrack === 'all') return problems;
    return problems.filter(p => (p.track || 'foundations') === activeTrack);
  }, [problems, activeTrack]);

  return (
    <div className="problems-page">
      <div className="problems-container">
        <div className="problems-header">
          <h1>Problems</h1>
          <p className="problems-subtitle">
            Practice data engineering with {problems.length}+ curated challenges across Python, SQL, Spark, dbt, Airflow, Kafka, and Iceberg.
          </p>
        </div>

        <div className="problems-layout">
          {/* Left sidebar: track filter (sub-section 6A) */}
          <aside className="track-sidebar">
            <h3 className="track-sidebar-title">Tracks</h3>
            <ul className="track-list">
              {TRACKS.map(track => (
                <li key={track.id}>
                  <button
                    type="button"
                    className={`track-button ${activeTrack === track.id ? 'active' : ''}`}
                    onClick={() => setActiveTrack(track.id)}
                  >
                    <span className="track-label">{track.label}</span>
                    <span className="track-count">{trackCounts[track.id] ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Main: filters + table */}
          <div className="problems-main">
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
              // Bug 2 fix: when the database itself is empty (no seed
              // has run), show guidance instead of a "Clear Filters"
              // button that wouldn't help. The shell command works
              // both inside the dev container and on a fresh clone
              // that runs docker-compose up + this seed step.
              <div className="no-results">
                <p>No problems found.</p>
                <p>Run: <code>docker-compose exec backend npm run seed</code></p>
              </div>
            ) : visibleProblems.length === 0 ? (
              <div className="no-results">
                <p>No problems found matching your filters.</p>
                <button onClick={() => {
                  setFilters({ difficulty: '', category: '', search: '' });
                  setActiveTrack('all');
                  setPage(1);
                }}>
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
                        <th className="col-executor">Tool</th>
                        <th className="col-category">Category</th>
                        <th className="col-acceptance">Acceptance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleProblems.map(problem => (
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
                          <td className="executor-cell">
                            {problem.executorType && (
                              <span
                                className="executor-pill"
                                style={{ background: EXECUTOR_PILL_COLORS[problem.executorType] || '#666' }}
                              >
                                {problem.executorType}
                              </span>
                            )}
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
      </div>
    </div>
  );
}

export default Problems;

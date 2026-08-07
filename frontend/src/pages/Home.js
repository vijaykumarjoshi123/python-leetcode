import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { problemsAPI, leaderboardAPI } from '../services/api';
import './Home.css';

function Home() {
  // Real counts fetched from the API so the landing page never shows
  // fabricated numbers (previously hard-coded "1000+ / 50K+ / 100K+"
  // regardless of actual DB state). Falls back to a qualitative label
  // if the API is unreachable.
  const [problemCount, setProblemCount] = useState(null);
  const [userCount, setUserCount] = useState(null);

  useEffect(() => {
    problemsAPI.getAll({ limit: 1 })
      .then((res) => setProblemCount(res.data.total))
      .catch(() => setProblemCount(null));
    leaderboardAPI.getGlobal({ limit: 1 })
      .then((res) => setUserCount(res.data.total))
      .catch(() => setUserCount(null));
  }, []);

  const problemLabel = problemCount == null ? 'Curated' : `${problemCount}`;
  const userLabel = userCount == null ? 'Active' : `${userCount}`;

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-content">
          <h1>Master Data Engineering</h1>
          <p>Sharpen your ETL and data-engineering skills with hands-on problems across Python, SQL, Spark, dbt, Airflow, Kafka, and Iceberg — executed in real sandboxed tool environments.</p>
          <div className="hero-buttons">
            <Link to="/problems" className="btn btn-primary">Start Training</Link>
            <Link to="/leaderboard" className="btn btn-secondary">View Leaderboard</Link>
          </div>
        </div>
      </section>

      <section className="features">
        <h2>Why ETLninja?</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🥷</div>
            <h3>Real-Tool Sandboxes</h3>
            <p>Every submission runs in an isolated Docker container with the actual tool — Spark, dbt, Kafka, Iceberg — not a toy simulator.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">⚡</div>
            <h3>Instant Verdicts</h3>
            <p>Submit code and get pass/fail with per-test-case feedback in seconds.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🏆</div>
            <h3>Leaderboards</h3>
            <p>Compete with other engineers and track your progress across tracks.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔗</div>
            <h3>Multi-Stage Pipelines</h3>
            <p>Practice end-to-end pipelines (Kafka → Spark → Iceberg → dbt) with injected failure scenarios to diagnose.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📚</div>
            <h3>Solutions &amp; Hints</h3>
            <p>Socratic AI hints and reference solutions help you learn the why, not just the what.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <h3>Skills Radar</h3>
            <p>Track your per-track proficiency and earn certificates as you solve.</p>
          </div>
        </div>
      </section>

      <section className="stats">
        <div className="stat-item">
          <h3>{problemLabel}</h3>
          <p>Problems</p>
        </div>
        <div className="stat-item">
          <h3>{userLabel}</h3>
          <p>Users</p>
        </div>
        <div className="stat-item">
          <h3>8</h3>
          <p>Tools (Python, SQL, Spark, dbt, Airflow, Kafka, Iceberg, …)</p>
        </div>
        <div className="stat-item">
          <h3>24/7</h3>
          <p>Available</p>
        </div>
      </section>
    </div>
  );
}

export default Home;

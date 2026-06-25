import React from 'react';
import { Link } from 'react-router-dom';
import './Home.css';

function Home() {
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-content">
          <h1>Master Python Programming</h1>
          <p>Level up your coding skills with 1000+ handpicked problems</p>
          <div className="hero-buttons">
            <Link to="/problems" className="btn btn-primary">Start Coding</Link>
            <Link to="/leaderboard" className="btn btn-secondary">View Leaderboard</Link>
          </div>
        </div>
      </section>

      <section className="features">
        <h2>Why PythonCode?</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🎯</div>
            <h3>Curated Problems</h3>
            <p>1000+ problems organized by difficulty and category</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">⚡</div>
            <h3>Real-time Execution</h3>
            <p>Execute code instantly and get immediate feedback</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🏆</div>
            <h3>Leaderboards</h3>
            <p>Compete with others and track your progress</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">💬</div>
            <h3>Community Forum</h3>
            <p>Discuss solutions and learn from the community</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📚</div>
            <h3>Solutions</h3>
            <p>Understand multiple approaches to each problem</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <h3>Analytics</h3>
            <p>Track your progress with detailed statistics</p>
          </div>
        </div>
      </section>

      <section className="stats">
        <div className="stat-item">
          <h3>1000+</h3>
          <p>Problems</p>
        </div>
        <div className="stat-item">
          <h3>50K+</h3>
          <p>Users</p>
        </div>
        <div className="stat-item">
          <h3>100K+</h3>
          <p>Submissions</p>
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

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Leaderboard.css';

function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchLeaderboard();
  }, [filter]);

  const fetchLeaderboard = async () => {
    try {
      setLoading(true);
      const endpoint = filter === 'all' 
        ? '/api/leaderboard' 
        : `/api/leaderboard/difficulty/${filter}`;
      const response = await axios.get(endpoint, { params: { limit: 100 } });
      setLeaderboard(response.data.users || response.data);
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="leaderboard-page">
      <div className="leaderboard-container">
        <h1>🏆 Leaderboard</h1>
        
        <div className="leaderboard-filters">
          <button 
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            Overall
          </button>
          <button 
            className={`filter-btn ${filter === 'easy' ? 'active' : ''}`}
            onClick={() => setFilter('easy')}
          >
            Easy
          </button>
          <button 
            className={`filter-btn ${filter === 'medium' ? 'active' : ''}`}
            onClick={() => setFilter('medium')}
          >
            Medium
          </button>
          <button 
            className={`filter-btn ${filter === 'hard' ? 'active' : ''}`}
            onClick={() => setFilter('hard')}
          >
            Hard
          </button>
        </div>

        {loading ? (
          <div className="loading">Loading leaderboard...</div>
        ) : (
          <div className="leaderboard-table">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>User</th>
                  <th>Solved</th>
                  <th>Easy</th>
                  <th>Medium</th>
                  <th>Hard</th>
                  <th>Acceptance Rate</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((user, idx) => (
                  <tr key={user._id} className={idx < 3 ? 'top-3' : ''}>
                    <td className="rank">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </td>
                    <td className="user-name">{user.username}</td>
                    <td className="stat">{user.stats?.totalSolved || 0}</td>
                    <td className="stat easy">{user.stats?.easyCount || 0}</td>
                    <td className="stat medium">{user.stats?.mediumCount || 0}</td>
                    <td className="stat hard">{user.stats?.hardCount || 0}</td>
                    <td className="stat">
                      {user.stats?.totalAttempts > 0 
                        ? ((user.stats?.totalSolved / user.stats?.totalAttempts) * 100).toFixed(1)
                        : 0
                      }%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Leaderboard;

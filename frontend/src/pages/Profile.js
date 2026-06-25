import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import './Profile.css';

function Profile() {
  const { userId } = useParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser();
  }, [userId]);

  const fetchUser = async () => {
    try {
      const response = await axios.get(`/api/leaderboard/user/${userId}`);
      setUser(response.data);
    } catch (err) {
      console.error('Error fetching user:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading profile...</div>;

  return (
    <div className="profile-page">
      <div className="profile-container">
        <div className="profile-header">
          <div className="profile-avatar">
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="profile-info">
            <h1>{user?.username}</h1>
            <p className="profile-rank">#{user?.rank}</p>
            {user?.bio && <p className="profile-bio">{user.bio}</p>}
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <h3>Problems Solved</h3>
            <p className="stat-value">{user?.stats?.totalSolved}</p>
          </div>
          <div className="stat-card">
            <h3>Easy</h3>
            <p className="stat-value easy">{user?.stats?.easyCount}</p>
          </div>
          <div className="stat-card">
            <h3>Medium</h3>
            <p className="stat-value medium">{user?.stats?.mediumCount}</p>
          </div>
          <div className="stat-card">
            <h3>Hard</h3>
            <p className="stat-value hard">{user?.stats?.hardCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Profile;

import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { leaderboardAPI } from '../services/api';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import './Profile.css';

// The five tracks the radar visualises. Order is the order the axes appear
// on the chart. Names must match the `track` enum on the Problem model.
const TRACK_LABELS = [
  { key: 'foundations', label: 'Foundations' },
  { key: 'data-engineering', label: 'Data Eng.' },
  { key: 'streaming', label: 'Streaming' },
  { key: 'orchestration', label: 'Orchestration' },
  { key: 'lakehouse', label: 'Lakehouse' },
];

function Profile() {
  const { userId } = useParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser();
  }, [userId]);

  const fetchUser = async () => {
    try {
      // Bug 4 fix: route through the shared api instance. See
      // Login.js for the full rationale.
      const response = await leaderboardAPI.getUserRank(userId);
      setUser(response.data);
    } catch (err) {
      console.error('Error fetching user:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading profile...</div>;

  // Build the radar data from solvedByTrack. Tracks with zero solves show
  // up with score 0 so the chart shape is consistent across users.
  //
  // Spec 6C calls for difficulty weighting (Easy=1, Medium=2, Hard=3
  // points). The User schema currently stores `solvedByTrack` as raw
  // counts and global `stats.{easy,medium,hard}Count`. We don't store a
  // per-(track, difficulty) breakdown, so the radar uses raw counts per
  // track here. A more accurate radar would need a per-track difficulty
  // breakdown, which would be a future schema addition.
  const solvedByTrack = user?.solvedByTrack || {};
  const radarData = TRACK_LABELS.map(({ key, label }) => ({
    track: label,
    score: solvedByTrack[key] || 0,
    fullMark: Math.max(
      10,
      ...TRACK_LABELS.map(({ key: k }) => solvedByTrack[k] || 0),
    ),
  }));

  const certificates = Array.isArray(user?.certificates) ? user.certificates : [];

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

        {/* Spec 6C: Skills Radar. recharts RadarChart, one axis per track. */}
        <section className="profile-section">
          <h2 className="section-title">Skills Radar</h2>
          <p className="section-subtitle">
            Problems solved per track. Strive for a balanced shape across all five.
          </p>
          <div className="radar-wrapper">
            <ResponsiveContainer width="100%" height={360}>
              <RadarChart data={radarData} outerRadius="75%">
                <PolarGrid stroke="#e6ebf1" />
                <PolarAngleAxis
                  dataKey="track"
                  tick={{ fill: '#555', fontSize: 13 }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, radarData[0].fullMark]}
                  tick={{ fill: '#999', fontSize: 11 }}
                />
                <Radar
                  name="Solved"
                  dataKey="score"
                  stroke="#667eea"
                  fill="#667eea"
                  fillOpacity={0.35}
                  isAnimationActive={false}
                />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Spec 6C: Certificates section. Display-only — no verification
            link per the master plan constraints. */}
        <section className="profile-section">
          <h2 className="section-title">Certificates</h2>
          {certificates.length === 0 ? (
            <p className="section-empty">
              No certificates yet. Solve enough problems in a track to earn one.
            </p>
          ) : (
            <div className="certificates-grid">
              {certificates.map((cert, idx) => (
                <div key={idx} className="certificate-card">
                  <div className="certificate-icon">★</div>
                  <div className="certificate-body">
                    <h3 className="certificate-title">
                      {cert.track
                        ? cert.track.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                        : 'Track'}{' '}
                      Certificate
                    </h3>
                    <p className="certificate-meta">
                      {cert.problemCount} problem{cert.problemCount === 1 ? '' : 's'} solved
                    </p>
                    <p className="certificate-date">
                      Awarded{' '}
                      {cert.awardedAt
                        ? new Date(cert.awardedAt).toLocaleDateString()
                        : 'recently'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Profile;

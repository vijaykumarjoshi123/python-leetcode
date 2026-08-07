import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authAPI } from '../services/api';
import './Auth.css';

function Register() {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    accountType: 'individual',
    companyName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.accountType === 'company' && !formData.companyName.trim()) {
      setError('Company name is required for company accounts');
      return;
    }

    try {
      setLoading(true);
      // Bug 4 fix: route through the shared api instance — see
      // Login.js for the full rationale (raw axios with a relative
      // URL resolves against the frontend origin and never reaches
      // the backend).
      const response = await authAPI.register({
        username: formData.username,
        email: formData.email,
        password: formData.password,
        accountType: formData.accountType,
        ...(formData.accountType === 'company' ? { companyName: formData.companyName } : {}),
      });
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      // Company accounts land on the assessments dashboard; everyone else
      // goes to the problems list.
      window.location.href = formData.accountType === 'company' ? '/assessments' : '/problems';
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-card">
          <h1>Join ETLninja</h1>
          <p className="auth-subtitle">Create your account and start training</p>

          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label>Account type</label>
              <select name="accountType" value={formData.accountType} onChange={handleChange}>
                <option value="individual">Individual (practice &amp; solve problems)</option>
                <option value="company">Company (hire via assessments)</option>
              </select>
            </div>

            {formData.accountType === 'company' && (
              <div className="form-group">
                <label>Company name</label>
                <input
                  type="text"
                  name="companyName"
                  value={formData.companyName}
                  onChange={handleChange}
                  placeholder="Acme Corp"
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                placeholder="your_username"
                required
              />
            </div>

            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                required
              />
            </div>

            <div className="form-group">
              <label>Confirm Password</label>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="••••••••"
                required
              />
            </div>

            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="auth-footer">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;

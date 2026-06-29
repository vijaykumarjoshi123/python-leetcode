import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401 globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    return Promise.reject(error);
  }
);

// ==================== Auth API ====================

export const authAPI = {
  register: (data) => api.post('/api/auth/register', data),
  login: (data) => api.post('/api/auth/login', data),
  getMe: () => api.get('/api/auth/me'),
};

// ==================== Problems API ====================

export const problemsAPI = {
  getAll: (params) => api.get('/api/problems', { params }),
  getById: (id) => api.get(`/api/problems/${id}`),
  getCategories: () => api.get('/api/problems/categories'),
};

// ==================== Submissions API ====================

export const submissionsAPI = {
  submit: (data) => api.post('/api/submissions/submit', data),
  getUserSubmissions: (userId, params) => api.get(`/api/submissions/user/${userId}`, { params }),
  getProblemSubmissions: (problemId, userId) =>
    api.get(`/api/submissions/problem/${problemId}/user/${userId}`),
};

// ==================== Leaderboard API ====================

export const leaderboardAPI = {
  getGlobal: (params) => api.get('/api/leaderboard', { params }),
  getUserRank: (userId) => api.get(`/api/leaderboard/user/${userId}`),
  getByDifficulty: (difficulty, params) =>
    api.get(`/api/leaderboard/difficulty/${difficulty}`, { params }),
};

// ==================== Forum API ====================

export const forumAPI = {
  getDiscussions: (problemId) => api.get(`/api/forum/problem/${problemId}`),
  createDiscussion: (data) => api.post('/api/forum', data),
  addComment: (discussionId, data) => api.post(`/api/forum/${discussionId}/comment`, data),
  likeComment: (commentId) => api.put(`/api/forum/comment/${commentId}/like`),
};

export default api;
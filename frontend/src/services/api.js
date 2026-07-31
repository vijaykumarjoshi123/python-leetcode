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
  // Bug 3 fix: poll this after POST /submit until status !== 'Pending'.
  // Backend also accepts ?userId=... for the owner check.
  getById: (id, params) => api.get(`/api/submissions/${id}`, { params }),
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

// ==================== Assessments API (Spec 8B) ====================
// Company-facing. Wrappers stay thin — see backend/routes/assessments.js
// for the wire protocol.
export const assessmentsAPI = {
  list: () => api.get('/api/assessments'),
  create: (data) => api.post('/api/assessments', data),
  detail: (id) => api.get(`/api/assessments/${id}`),
  invite: (id, emails) => api.post(`/api/assessments/${id}/invite`, { emails }),
  report: (id) => api.get(`/api/assessments/${id}/report`),
  // Public route used by the candidate via the emailed link.
  joinByToken: (token) => api.get(`/api/assessments/join/${token}`),
};

// ==================== Pipelines API (Tier 3 / Section 11H) ====================
// Wraps the multi-tool pipeline endpoints (see backend/routes/pipelines.js).
// `run` is synchronous — the orchestrator blocks until all stages finish,
// then returns the persisted PipelineRun document. `getRun` is owner-only;
// `getProblem` is public metadata (no fixture paths leaked).
//   - run({ pipelineProblemId, stageCode, scenarioId })   POST /api/pipelines/run
//   - getRun(runId)                                       GET  /api/pipelines/run/:runId
//   - getProblem(problemId)                               GET  /api/pipelines/problem/:problemId
//   - listProblems()                                      GET  /api/pipelines/problems
//   - listRuns({ limit })                                 GET  /api/pipelines/runs
//   - listScenarios(problemId)                            GET  /api/pipelines/problem/:problemId/scenarios
export const pipelinesAPI = {
  run: (data) => api.post('/api/pipelines/run', data),
  getRun: (runId) => api.get(`/api/pipelines/run/${runId}`),
  getProblem: (problemId) => api.get(`/api/pipelines/problem/${problemId}`),
  listProblems: () => api.get('/api/pipelines/problems'),
  listRuns: ({ limit } = {}) => api.get('/api/pipelines/runs', { params: { limit } }),
  listScenarios: (problemId) => api.get(`/api/pipelines/problem/${problemId}/scenarios`),
};

export default api;
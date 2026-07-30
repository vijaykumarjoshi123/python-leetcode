import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Problems from './pages/Problems';
import Problem from './pages/Problem';
import ProblemSolver from './pages/ProblemSolver';
import Leaderboard from './pages/Leaderboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Profile from './pages/Profile';
import AssessmentDashboard from './pages/AssessmentDashboard';
import CandidateReport from './pages/CandidateReport';
// Tier 3 / Section 11H — pipeline simulator frontend surfaces.
import PipelineIndex from './pages/PipelineIndex';
import PipelineProblemPage from './pages/PipelineProblemPage';
import PipelineReport from './pages/PipelineReport';
import './App.css';

function App() {
  const token = localStorage.getItem('token');

  return (
    <Router>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/problems" element={<Problems />} />
        <Route path="/problem/:id" element={<Problem />} />
        <Route
          path="/solve/:id"
          element={token ? <ProblemSolver /> : <Navigate to="/login" />}
        />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/profile/:userId" element={<Profile />} />
        {/* Spec 8C + 8D: company dashboard + per-candidate report. The
            dashboard does its own accountType check; the report is also
            gated server-side. */}
        <Route path="/assessments" element={<AssessmentDashboard />} />
        <Route path="/assessments/:id/report/:email" element={<CandidateReport />} />
        {/* Tier 3 / Section 11H — pipeline simulator frontend routes.
            All three routes are open on the client; the server gates
            /run behind user.pipelineEnabled and 401s unauthenticated
            callers. The navbar link is the only place we hide this
            from non-flagged users. */}
        <Route path="/pipelines" element={<PipelineIndex />} />
        <Route path="/pipelines/:id" element={<PipelineProblemPage />} />
        <Route path="/pipelines/run/:runId" element={<PipelineReport />} />
      </Routes>
    </Router>
  );
}

export default App;

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
      </Routes>
    </Router>
  );
}

export default App;

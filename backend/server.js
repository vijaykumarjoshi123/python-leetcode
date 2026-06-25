const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/python-leetcode')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

// Routes
const authRoutes = require('./routes/auth');
const problemRoutes = require('./routes/problems');
const submissionRoutes = require('./routes/submissions');
const leaderboardRoutes = require('./routes/leaderboard');
const forumRoutes = require('./routes/forum');

app.use('/api/auth', authRoutes);
app.use('/api/problems', problemRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/forum', forumRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Socket.io for real-time features
io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);
  
  socket.on('join-discussion', (problemId) => {
    socket.join(`problem-${problemId}`);
  });
  
  socket.on('new-comment', (data) => {
    io.to(`problem-${data.problemId}`).emit('comment-update', data);
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;

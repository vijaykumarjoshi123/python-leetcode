const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');

dotenv.config();

const app = express();
const server = http.createServer(app);

// CORS hardening (#13 in TESTING_REPORT.md). In development we accept any
// origin (the CRA dev server, container frontend, etc.); in production we
// restrict to the configured frontend origin(s) so a random site can't
// read authenticated responses. Set CORS_ORIGIN to a single origin or a
// comma-separated list in prod.
const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : null;
const corsOptions = isProd && allowedOrigins
  ? {
      origin: (origin, cb) => {
        // Allow same-origin / no-origin (curl, server-to-server) and any
        // whitelisted origin; reject the rest.
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS: origin ${origin} not allowed`));
      },
    }
  : {};
const io = socketIo(server, { cors: { origin: isProd ? (allowedOrigins || '*') : '*' } });

// JWT secret hardening (#14). Refuse to boot in production with the weak
// default 'secret' — that default let anyone forge tokens. In dev the
// default is kept so local setup stays zero-config.
if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16)) {
  console.error('FATAL: JWT_SECRET must be set to a strong (>=16 char) value in production.');
  process.exit(1);
}

app.use(cors(corsOptions));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/etlninja')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

// Routes
const authRoutes = require('./routes/auth');
const problemRoutes = require('./routes/problems');
const submissionRoutes = require('./routes/submissions');
const leaderboardRoutes = require('./routes/leaderboard');
const forumRoutes = require('./routes/forum');
const hintRoutes = require('./routes/hints');
const assessmentRoutes = require('./routes/assessments');
// Tier 3 / Section 11D — pipeline simulator routes. Sibling of the
// submission route; this one handles multi-stage pipeline attempts
// (Kafka → Spark → Iceberg → dbt and similar). The single-tool
// submission flow at /api/submissions is unchanged.
const pipelineRoutes = require('./routes/pipelines');

// Initialize Submission Queue Worker
require('./services/submissionQueue');

app.use('/api/auth', authRoutes);
app.use('/api/problems', problemRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/hints', hintRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/pipelines', pipelineRoutes);

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

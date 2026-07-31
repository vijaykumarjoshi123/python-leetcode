/**
 * Worker process — Tier 3 / Section 11Z (Bug 1 fix).
 *
 * The BullMQ worker that consumes submissions from the 'submissions'
 * queue runs OUT of the backend container. The backend API only
 * enqueues jobs; this worker spawns docker containers for execution.
 *
 * Why this exists:
 *   The backend container has no Docker CLI and no /var/run/docker.sock
 *   mount. Calling `docker run` from inside the backend either fails
 *   with ENOENT (docker not installed) or ENOENT on the socket path.
 *   Fix: separate service with both.
 *
 * Connection shape:
 *   - MongoDB: same MONGODB_URI as the backend
 *   - Redis: same REDIS_URL as the backend (BullMQ broker)
 *   - Docker: via /var/run/docker.sock bind mount
 *
 * Run via:
 *   docker-compose up worker      (production)
 *   node worker.js                 (local dev — needs Docker CLI installed)
 *
 * The worker auto-shuts down on SIGTERM so docker-compose stop cleanly
 * drains in-flight jobs.
 */

'use strict';

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/python-leetcode';
const REDIS_URL   = process.env.REDIS_URL   || 'redis://localhost:6379';

async function start() {
  console.log('[worker] Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('[worker] MongoDB connected');

  // The RUN_WORKER=1 gate tells submissionQueue.js to start its BullMQ
  // Worker on import. Without this, only the Queue singleton is
  // created (which is what server.js wants — enqueue without
  // executing).
  process.env.RUN_WORKER = '1';

  // Import after mongoose connects so models register correctly.
  console.log('[worker] Starting submission queue worker...');
  require('./services/submissionQueue');
  console.log('[worker] Ready — waiting for jobs');

  process.on('SIGTERM', async () => {
    console.log('[worker] SIGTERM received — shutting down...');
    try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[worker] SIGINT received — shutting down...');
    try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
    process.exit(0);
  });
}

start().catch((err) => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});

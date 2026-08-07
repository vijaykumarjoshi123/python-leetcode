/**
 * Pipeline queue — BullMQ producer (Queue) + optional consumer (Worker).
 *
 * Why this exists (Bug #2 in TESTING_REPORT.md): the pipeline route used to
 * call runPipeline() synchronously inside the BACKEND process. runPipeline
 * spawns executor containers via `child_process.spawn('docker', ...)`, but
 * the backend container has NO Docker socket mounted — only the worker
 * does (the whole reason the worker exists). So every pipeline run failed
 * at stage 1 with "Cannot connect to the Docker daemon".
 *
 * Fix shape — same producer/consumer split as submissionQueue.js:
 *   - The backend API (routes/pipelines.js) creates a PipelineRun document
 *     in 'pending' state, enqueues a job here, and returns the pending doc
 *     immediately (HTTP 202). The frontend polls GET /run/:runId.
 *   - The worker process (worker.js, which has /var/run/docker.sock) starts
 *     the BullMQ Worker on import (RUN_WORKER=1) and runs runPipeline()
 *     against the job, which updates the same doc to 'completed'/'error'.
 *
 * The Queue is created unconditionally so the backend can enqueue even when
 * the Worker isn't running in the same process. The Worker only starts when
 * RUN_WORKER=1 (set by worker.js), preventing the backend from spawning
 * Docker containers it has no socket for.
 */

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const mongoose = require('mongoose');
const { runPipeline } = require('./pipelineOrchestrator');
const PipelineRun = require('../models/PipelineRun');

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const pipelineQueue = new Queue('pipelines', { connection });

// Optional Worker — only the worker process (RUN_WORKER=1) starts it.
if (process.env.RUN_WORKER === '1') {
  console.log('[pipelineQueue] RUN_WORKER=1 — starting BullMQ Worker');

  const worker = new Worker('pipelines', async (job) => {
    const { runId, pipelineProblemId, userId, stageCode, scenarioId } = job.data || {};

    if (!runId || !pipelineProblemId || !userId) {
      throw new Error('pipeline job missing runId/pipelineProblemId/userId');
    }

    // Mark the pre-allocated run as in-flight (defensive — the route already
    // set status:'pending', but a requeued job after crash may have it set
    // differently). Helps the frontend distinguish "running" from "queued".
    try {
      await PipelineRun.updateOne({ _id: runId }, { $set: { status: 'pending' } });
    } catch (e) {
      console.warn('[pipelineQueue] could not mark run pending:', e.message);
    }

    try {
      await runPipeline({
        pipelineProblemId,
        userId,
        stageCode: stageCode || {},
        scenarioId: scenarioId || null,
        runId, // thread the pre-allocated _id so runPipeline updates this doc
      });
    } catch (err) {
      // Orchestrator blew up (bad problem, docker spawn failure, etc.).
      // Record a top-level error on the run so the report page can show it
      // instead of the run hanging in 'pending' forever.
      console.error(`[pipelineQueue] runPipeline failed for run ${runId}:`, err);
      try {
        await PipelineRun.findByIdAndUpdate(runId, {
          $set: { status: 'error', error: err.message || String(err), passed: false },
        });
      } catch (e) {
        console.error('[pipelineQueue] could not persist error state:', e.message);
      }
      // Don't rethrow: BullMQ would retry and re-run the (expensive) pipeline.
      // The error is already persisted for the user to see.
    }
  }, { connection, concurrency: 1 }); // pipelines are heavy; one at a time

  worker.on('failed', (job, err) => {
    console.error(`[pipelineQueue] job ${job && job.id} FAILED:`, err.message);
  });

  worker.on('ready', () => {
    console.log('[pipelineQueue] BullMQ Worker ready — concurrency=1');
  });

  worker.on('error', (err) => {
    console.error('[pipelineQueue] BullMQ Worker error:', err);
  });
}

// Keep mongoose happy in the worker process (models are registered on
// import; this is a no-op if already connected).
module.exports = { pipelineQueue };

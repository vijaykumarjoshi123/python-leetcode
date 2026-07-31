/**
 * Submission queue — BullMQ producer (Queue) + optional consumer (Worker).
 *
 * Bug 1 fix (Section 11Z): the Worker MUST NOT start when this module
 * is imported by the backend API container (server.js). The Worker
 * spawns Docker containers, which requires /var/run/docker.sock access
 * the backend container doesn't have.
 *
 * Gating strategy:
 *   - server.js requires this module to obtain the `submissionQueue`
 *     singleton (for `queue.add()` from /api/submissions/submit).
 *   - worker.js requires this module to start the Worker (the actual
 *     docker-spawning consumer).
 *
 * Both processes set `RUN_WORKER=1` to start the Worker; only the
 * worker process does. The backend process sets nothing (or any other
 * value), so only the Queue singleton is created on import.
 *
 * The Queue is created unconditionally so server.js can enqueue jobs
 * even when the Worker isn't running in the same process. The Worker
 * only starts when the RUN_WORKER env var is set.
 */

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { executeCode } = require('./pythonExecutor');
const Submission = require('../models/Submission');
const Problem = require('../models/Problem');
const User = require('../models/User');
const { isValidExecutorType } = require('./executorRouter');

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const submissionQueue = new Queue('submissions', { connection });

// Optional: the Worker only starts when RUN_WORKER=1. The worker
// process sets this; the backend API does not. This prevents the
// backend from trying to spawn Docker containers when it imports
// this module just to obtain the queue singleton.
if (process.env.RUN_WORKER === '1') {
  console.log('[submissionQueue] RUN_WORKER=1 — starting BullMQ Worker');

  const workerConcurrency = parseInt(
    process.env.MAX_CONCURRENT_EXECUTIONS || '5',
    10,
  );

  const worker = new Worker('submissions', async (job) => {
    // executorType was added to the job payload in Section 1C. Older
    // queued jobs from before that change won't carry it — fall back
    // to 'python' for backward compatibility. Unknown values are
    // coerced to 'python' rather than rejected, so a corrupt payload
    // doesn't silently lose a submission.
    const rawExecutorType = job.data?.executorType;
    const executorType = isValidExecutorType(rawExecutorType) ? rawExecutorType : 'python';

    const { submissionId } = job.data;
    const submission = await Submission.findById(submissionId);
    if (!submission) throw new Error('Submission not found');

    const problem = await Problem.findById(submission.problemId);
    const user = await User.findById(submission.userId);

    try {
      const summary = await executeCode(
      submission.code,
      [...(problem.testCases || []), ...(problem.hiddenTestCases || [])],
      executorType,
    );
      const { results, passed, totalTestCases, firstError, executionRuntime, toolVersion } = summary;

      let accepted = true;
      let totalRuntime = 0;
      let firstErrorForStatus = null;

      for (let i = 0; i < results.length; i++) {
        totalRuntime += results[i].runtime || 0;
        if (results[i].passed) {
          // no-op; counted via `passed` from the summary
        } else {
          accepted = false;
          if (!firstErrorForStatus && results[i].error) firstErrorForStatus = results[i].error;
        }
      }

      submission.status = accepted ? 'Accepted' : 'Wrong Answer';
      if (!accepted && firstErrorForStatus && firstErrorForStatus.includes('Time Limit Exceeded')) {
        submission.status = 'Time Limit Exceeded';
      } else if (!accepted && firstErrorForStatus && firstErrorForStatus.includes('Error')) {
        submission.status = 'Runtime Error';
      }

      submission.testCasesPassed = passed;
      submission.totalTestCases = totalTestCases;
      // Prefer the executor-reported runtime (sum of per-test-case)
      // when available; fall back to the wall-clock summary value
      // otherwise.
      const perCaseAvg = results.length > 0 ? totalRuntime / results.length : 0;
      submission.runtime = Math.round((perCaseAvg || executionRuntime) * 100) / 100;
      submission.output = JSON.stringify(results);
      submission.error = firstErrorForStatus;

      // Tool metadata. These fields land on the Submission schema in
      // Section 2A; Mongoose drops unknown fields silently until
      // then, so storing now is safe.
      submission.executorType = executorType;
      submission.toolVersion = toolVersion;
      submission.executionRuntime = executionRuntime;

      if (accepted) {
        const problemId = submission.problemId;
        if (!user.solvedProblems.includes(problemId)) {
          user.solvedProblems.push(problemId);
          user.stats.totalSolved += 1;
          if (problem.difficulty === 'Easy') user.stats.easyCount += 1;
          else if (problem.difficulty === 'Medium') user.stats.mediumCount += 1;
          else if (problem.difficulty === 'Hard') user.stats.hardCount += 1;
        }
      }

      problem.submissions += 1;
      if (submission.status === 'Accepted') problem.accepted += 1;
      problem.acceptanceRate = parseFloat((problem.accepted / problem.submissions * 100).toFixed(2));

      await user.save();
      await problem.save();
      await submission.save();

    } catch (err) {
      // Spec 10: distinguish queue-full failures from generic runtime
      // errors so the UI can suggest a retry rather than treating it
      // as a code-level failure.
      if (err && err.status === 'Queue full') {
        submission.status = 'Queue Full';
      } else {
        submission.status = 'Runtime Error';
      }
      submission.error = err.message || String(err);
      await submission.save();
    }
  }, { connection, concurrency: workerConcurrency });

  worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.id} FAILED:`, err.message);
  });

  worker.on('ready', () => {
    console.log(`[worker] BullMQ Worker ready — concurrency=${workerConcurrency}`);
  });

  worker.on('error', (err) => {
    console.error('[worker] BullMQ Worker error:', err);
  });
}

module.exports = { submissionQueue };

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

const worker = new Worker('submissions', async (job) => {
  // executorType was added to the job payload in Section 1C. Older queued
  // jobs from before that change won't carry it — fall back to 'python'
  // for backward compatibility. Unknown values are coerced to 'python'
  // rather than rejected, so a corrupt payload doesn't silently lose
  // a submission.
  const rawExecutorType = job.data?.executorType;
  const executorType = isValidExecutorType(rawExecutorType) ? rawExecutorType : 'python';

  const { submissionId } = job.data;
  const submission = await Submission.findById(submissionId);
  if (!submission) throw new Error('Submission not found');

  const problem = await Problem.findById(submission.problemId);
  const user = await User.findById(submission.userId);

  try {
    const summary = await executeCode(submission.code, problem.testCases, executorType);
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
    // Prefer the executor-reported runtime (sum of per-test-case) when
    // available; fall back to the wall-clock summary value otherwise.
    const perCaseAvg = results.length > 0 ? totalRuntime / results.length : 0;
    submission.runtime = Math.round((perCaseAvg || executionRuntime) * 100) / 100;
    submission.output = JSON.stringify(results);
    submission.error = firstErrorForStatus;

    // Tool metadata. These fields land on the Submission schema in Section 2A;
    // Mongoose drops unknown fields silently until then, so storing now is safe.
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
    submission.status = 'Runtime Error';
    submission.error = err.message;
    await submission.save();
  }
}, { connection });

module.exports = { submissionQueue };

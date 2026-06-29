const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { executeCode } = require('./pythonExecutor');
const Submission = require('../models/Submission');
const Problem = require('../models/Problem');
const User = require('../models/User');

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const submissionQueue = new Queue('submissions', { connection });

const worker = new Worker('submissions', async (job) => {
  const { submissionId } = job.data;
  const submission = await Submission.findById(submissionId);
  if (!submission) throw new Error('Submission not found');

  const problem = await Problem.findById(submission.problemId);
  const user = await User.findById(submission.userId);

  try {
    const results = await executeCode(submission.code, problem.testCases);
    
    let passed = 0;
    let accepted = true;
    let totalRuntime = 0;
    let firstError = null;

    for (let i = 0; i < results.length; i++) {
      totalRuntime += results[i].runtime || 0;
      if (results[i].passed) {
        passed++;
      } else {
        accepted = false;
        if (!firstError && results[i].error) firstError = results[i].error;
      }
    }

    submission.status = accepted ? 'Accepted' : 'Wrong Answer';
    if (!accepted && firstError && firstError.includes('Time Limit Exceeded')) {
      submission.status = 'Time Limit Exceeded';
    } else if (!accepted && firstError && firstError.includes('Error')) {
      submission.status = 'Runtime Error';
    }
    
    submission.testCasesPassed = passed;
    submission.totalTestCases = problem.testCases.length;
    submission.runtime = Math.round(totalRuntime / results.length * 100) / 100;
    submission.output = JSON.stringify(results);
    submission.error = firstError;

    if (accepted) {
      if (!user.solvedProblems.includes(problemId = submission.problemId)) {
        user.solvedProblems.push(submission.problemId);
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

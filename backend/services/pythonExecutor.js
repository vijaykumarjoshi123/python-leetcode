const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getExecutorConfig, isValidExecutorType } = require('./executorRouter');

/**
 * Execute user-submitted code against test cases inside the appropriate
 * Docker sandbox (python, sql, pyspark, dbt, airflow, kafka, iceberg).
 *
 * The image, run command, timeout, and memory limit are resolved from the
 * executorRouter so adding a new tool means adding a new entry there only.
 *
 * Returns a summary object whose `results` array preserves the original
 * per-test-case shape (so existing callers like submissionQueue that index
 * `results[i].passed` / `.runtime` / `.error` keep working) plus
 * submission-level fields the queue needs to persist.
 *
 *   {
 *     executorType, toolVersion, executionRuntime, results,
 *     passed, totalTestCases, firstError
 *   }
 */
async function executeCode(code, testCases, executorType = 'python') {
  const config = getExecutorConfig(executorType);

  const overallStart = process.hrtime.bigint();
  const results = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const result = await runSingleTestCase(code, testCase, i, config);
    results.push(result);
  }

  const overallEnd = process.hrtime.bigint();
  const executionRuntimeMs = Number(overallEnd - overallStart) / 1_000_000;

  let passed = 0;
  let firstError = null;
  for (const r of results) {
    if (r.passed) passed++;
    else if (!firstError && r.error) firstError = r.error;
  }

  return {
    executorType,
    toolVersion: config.toolVersion,
    executionRuntime: Math.round(executionRuntimeMs * 100) / 100,
    results,
    passed,
    totalTestCases: results.length,
    firstError,
  };
}

function runSingleTestCase(code, testCase, index, config) {
  return new Promise((resolve) => {
    const startTime = process.hrtime.bigint();

    // Each tool has its own submission-file extension. Default to .py because
    // it's the most common; the router can override via a future
    // `fileExt` field if needed. For now the run command treats the path as
    // opaque, so extension is purely cosmetic.
    const extension = pickExtension(config.image);
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(
      tmpDir,
      `lc_exec_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}${extension}`
    );
    fs.writeFileSync(tmpFile, code, 'utf-8');

    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, config.timeout);

    // Production-grade sandboxing:
    //   --rm           remove container after run
    //   --net none     disable network access to prevent SSRF/exfiltration
    //   --memory       limit RAM (from router config — Spark needs 1GB+)
    //   --cpus         limit CPU
    //   --gpus all     only when the executor declares useGpu (router-driven)
    //   -v             mount the specific temp file as read-only
    const dockerArgs = [
      'run', '--rm',
      '--net', 'none',
      '--memory', `${config.memoryMb}m`,
      '--cpus', '1.0',
      '-v', `${tmpFile}:/sandbox/solution${extension}:ro`,
    ];

    if (config.useGpu) {
      dockerArgs.push('--gpus', 'all');
    }

    // The image name and the run argv both come from the router so a new
    // executor type doesn't need a code change here. buildCmd already returns
    // an argv array — no shell quoting required.
    const inContainerPath = `/sandbox/solution${extension}`;
    dockerArgs.push(config.image, ...config.buildCmd(inContainerPath));

    const proc = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      const endTime = process.hrtime.bigint();
      const runtimeMs = Number(endTime - startTime) / 1_000_000;

      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

      if (timedOut) {
        resolve({
          input: testCase.input,
          expected: testCase.output,
          actual: null,
          passed: false,
          error: 'Time Limit Exceeded',
          runtime: config.timeout,
          memory: 0,
        });
        return;
      }

      if (exitCode !== 0 || stderr) {
        const cleanedStderr = stderr
          .replace(/File ".*", line \d+/g, 'File "<your code>"')
          .replace(new RegExp(inContainerPath.replace(/\./g, '\\.'), 'g'), '<your code>')
          .trim();
        resolve({
          input: testCase.input,
          expected: testCase.output,
          actual: null,
          passed: false,
          error: cleanedStderr || `Exit code: ${exitCode}`,
          runtime: Math.round(runtimeMs * 100) / 100,
          memory: 0,
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        const actual = normalizeResult(parsed.result);
        const expected = normalizeResult(testCase.output);

        resolve({
          input: testCase.input,
          expected: testCase.output,
          actual: JSON.stringify(parsed.result),
          passed: actual === expected,
          error: null,
          runtime: parsed.runtime || Math.round(runtimeMs * 100) / 100,
          memory: parsed.memory || 0,
        });
      } catch (parseErr) {
        resolve({
          input: testCase.input,
          expected: testCase.output,
          actual: stdout.trim(),
          passed: false,
          error: 'Could not parse output: ' + stdout.trim().slice(0, 200),
          runtime: Math.round(runtimeMs * 100) / 100,
          memory: 0,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
      resolve({
        input: testCase.input,
        expected: testCase.output,
        actual: null,
        passed: false,
        error: 'Execution error: ' + err.message,
        runtime: 0,
        memory: 0,
      });
    });
  });
}

/**
 * Pick a sensible file extension for the temp submission file based on the
 * executor's docker image. The python harness reads JSON from stdout regardless
 * of extension, but mounting a `.sql` file as `.sql` (not `.py`) keeps the
 * runner scripts in Sections 3B/3C honest about what they receive.
 */
function pickExtension(image) {
  if (image.startsWith('duckdb') || image.startsWith('dbt')) return '.sql';
  return '.py';
}

/**
 * Normalize result string for comparison.
 * Handles list formatting, nested structures, and type coercion.
 */
function normalizeResult(val) {
  if (val === null || val === undefined) return 'null';

  let str;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return normalizeResult(parsed);
    } catch (e) {
      str = val;
    }
  } else if (Array.isArray(val)) {
    return '[' + val.map(normalizeResult).join(',') + ']';
  } else if (typeof val === 'object') {
    const entries = Object.entries(val)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${normalizeResult(v)}`)
      .join(',');
    return '{' + entries + '}';
  } else if (typeof val === 'boolean') {
    return val.toString().toLowerCase();
  } else if (typeof val === 'number') {
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  } else {
    str = String(val);
  }

  str = str.replace(/\s+/g, '');
  str = str.replace(/'/g, '"');

  return str;
}

module.exports = {
  executeCode,
  isValidExecutorType,
};

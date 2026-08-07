const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getExecutorConfig, isValidExecutorType } = require('./executorRouter');
const { runWithGuard } = require('./concurrencyGuard');

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

  // Spec 10: cap concurrent docker spawns. The whole submission runs
  // under one semaphore permit; release happens in runWithGuard's
  // finally. If the queue is full we throw an Error with .status
  // === 'Queue full' — submissionQueue.js catches it and records the
  // submission with a distinct status.
  const results = await runWithGuard(async () => {
    const out = [];
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const result = await runSingleTestCase(code, testCase, i, config);
      out.push(result);
    }
    return out;
  });

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

    // ---- File exchange between worker and executor ----
    //
    // The worker writes each job's solution + test-case files into a shared
    // location, then mounts that same location (read-only) into the executor
    // container it spawns. Two modes are supported:
    //
    //   1. Named Docker volume (recommended, docker-compose default).
    //      CODE_EXCHANGE_VOLUME names the volume; the worker mounts it at
    //      CODE_EXCHANGE_DIR inside itself, and passes
    //      `-v <volume>:/code-exchange:ro` to the executor. Because BOTH
    //      sides reference the same named volume, there is NO host path to
    //      compute — this is what makes it robust regardless of which host
    //      directory `docker compose` was invoked from.
    //
    //   2. Host bind-mount (legacy / bare-metal dev). CODE_EXCHANGE_HOST_DIR
    //      gives the host-side absolute path of CODE_EXCHANGE_DIR; the worker
    //      passes `-v <hostDir>/<file>:/sandbox/solution.*:ro` per file.
    //      Kept for the case where the worker runs natively (no compose).
    //
    // The previous implementation relied solely on mode 2 with a `${PWD}`
    // expansion that depended on the shell's CWD when compose ran — if that
    // wasn't the repo root, the host path was wrong, Docker silently created
    // an empty dir, and the executor found no solution file. Every submission
    // failed. Mode 1 removes that failure mode entirely.
    const codeExchangeDir = process.env.CODE_EXCHANGE_DIR || os.tmpdir();
    const exchangeVolume = process.env.CODE_EXCHANGE_VOLUME || null;
    const hostExchangeDir = process.env.CODE_EXCHANGE_HOST_DIR || null;

    // Ensure the exchange directory exists (inside the worker/container).
    try { fs.mkdirSync(codeExchangeDir, { recursive: true }); } catch (e) { /* ignore */ }

    const filename = `lc_exec_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}${extension}`;
    const containerPath = path.join(codeExchangeDir, filename);
    fs.writeFileSync(containerPath, code, 'utf-8');

    // Also write a test_cases.json file alongside the solution so executor
    // runners that expect /sandbox/test_cases.json can read the specific
    // test case for this invocation.
    const testFilename = `${filename}.tc.json`;
    const containerTestPath = path.join(codeExchangeDir, testFilename);
    try { fs.writeFileSync(containerTestPath, JSON.stringify([testCase]), 'utf-8'); } catch (e) { /* ignore */ }

    // Decide how the executor will see these files:
    //   - Volume mode: both files live under /code-exchange/<filename> inside
    //     the executor (the volume is mounted there), and we mount the whole
    //     volume read-only.
    //   - Bind mode: mount each file individually at the legacy /sandbox/...
    //     paths; the host path is hostExchangeDir + filename.
    const useVolume = !!exchangeVolume;
    const execSolutionPath = useVolume
      ? path.join('/code-exchange', filename)
      : `/sandbox/solution${extension}`;
    const execTestPath = useVolume
      ? path.join('/code-exchange', testFilename)
      : '/sandbox/test_cases.json';

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
    //   -v             mount the code-exchange volume (read-only), OR per-file
    //                  bind-mounts in legacy host-dir mode.
    //   --hostname localhost  the container's own hostname resolves to
    //                  127.0.0.1. Without this, the JVM (Spark/Airflow)
    //                  crashes on startup with UnknownHostException because
    //                  --net none has no DNS and the default hostname (the
    //                  random container id) can't be resolved.
    const dockerArgs = [
      'run', '--rm',
      '--net', 'none',
      '--hostname', 'localhost',
      '--memory', `${config.memoryMb}m`,
      '--cpus', '1.0',
    ];

    if (useVolume) {
      // One named-volume mount, read-only. The executor reads the specific
      // job file by its path under /code-exchange.
      dockerArgs.push('-v', `${exchangeVolume}:/code-exchange:ro`);
    } else {
      // Legacy per-file bind-mounts against the host dir.
      const hostSolutionPath = hostExchangeDir
        ? path.join(hostExchangeDir, filename)
        : containerPath;
      const hostTestPath = hostExchangeDir
        ? path.join(hostExchangeDir, testFilename)
        : containerTestPath;
      dockerArgs.push(
        '-v', `${hostSolutionPath}:/sandbox/solution${extension}:ro`,
        '-v', `${hostTestPath}:/sandbox/test_cases.json:ro`,
      );
    }

    if (config.useGpu) {
      dockerArgs.push('--gpus', 'all');
    }

    // Tell the runner where to find the solution + test-case files via env.
    // python/iceberg/airflow runners read SUBMISSION_FILE / TEST_CASES_PATH
    // (defaulting to /sandbox/...); in volume mode the files live under
    // /code-exchange/<file>, so we override the defaults here. The shell
    // runners (sql/spark/dbt/kafka) take the path as $1, which buildCmd
    // already receives as execSolutionPath — the env is harmless for them.
    dockerArgs.push(
      '-e', `SUBMISSION_FILE=${execSolutionPath}`,
      '-e', `TEST_CASES_PATH=${execTestPath}`,
    );

    // The image name and the run argv both come from the router so a new
    // executor type doesn't need a code change here. buildCmd already returns
    // an argv array — no shell quoting required. In volume mode we pass the
    // executor-side solution path (/code-exchange/<file>) so runners that
    // take the file path as an argument read the right file; in bind mode
    // we pass /sandbox/solution.* as before.
    dockerArgs.push(config.image, ...config.buildCmd(execSolutionPath));

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

      try { fs.unlinkSync(containerPath); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(containerTestPath); } catch (e) { /* ignore */ }

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
          .replace(new RegExp(execSolutionPath.replace(/\./g, '\\.'), 'g'), '<your code>')
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

        const actualValue = parsed.hasOwnProperty('result')
          ? parsed.result
          : parsed.hasOwnProperty('output')
            ? parsed.output
            : null;

        const actual = normalizeResult(actualValue);
        const expected = normalizeResult(testCase.output);

        // The runner just runs the code and reports what happened.
        // It doesn't compare actual vs expected (and historically has
        // emitted passed:true unconditionally). The comparison is the
        // worker's job — that's where the expected output lives.
        const passed = actual === expected;

        resolve({
          input: testCase.input,
          expected: testCase.output,
          actual: actualValue === null ? null : JSON.stringify(actualValue),
          passed,
          error: parsed.error || null,
          runtime: parsed.runtime_ms || parsed.runtime || Math.round(runtimeMs * 100) / 100,
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
    try { fs.unlinkSync(containerPath); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(containerTestPath); } catch (e) { /* ignore */ }
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

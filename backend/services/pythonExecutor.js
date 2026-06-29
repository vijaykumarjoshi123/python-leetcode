const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Execute Python code against test cases using a real Python subprocess.
 * Returns detailed per-test-case results with timing and memory info.
 */
const TIME_LIMIT_MS = 5000; // 5 second timeout

async function executeCode(code, testCases) {
  const results = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const result = await runSingleTestCase(code, testCase, i);
    results.push(result);
  }

  return results;
}

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Execute Python code against test cases using a Docker sandbox.
 * Returns detailed per-test-case results with timing and memory info.
 */
const TIME_LIMIT_MS = 5000; // 5 second timeout

async function executeCode(code, testCases) {
  const results = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const result = await runSingleTestCase(code, testCase, i);
    results.push(result);
  }

  return results;
}

function runSingleTestCase(code, testCase, index) {
  return new Promise((resolve) => {
    const startTime = process.hrtime.bigint();

    const wrappedCode = wrapCodeForExecution(code, testCase.input);
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `lc_exec_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}.py`);
    fs.writeFileSync(tmpFile, wrappedCode, 'utf-8');

    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, TIME_LIMIT_MS);

    // Production-grade Sandboxing: Run in a Docker container
    // --rm: remove container after run
    // --net none: disable network access to prevent SSRF/Exfiltration
    // --memory: limit RAM
    // --cpus: limit CPU
    // --gpus all: provide GPU access for cuDF/cuOpt acceleration
    // -v: mount only the specific temp file as read-only
    const proc = spawn('docker', [
      'run', '--rm',
      '--gpus', 'all',
      '--net', 'none',
      '--memory', '1g', // Increased memory for GPU workloads
      '--cpus', '1.0',  // Increased CPU for GPU coordination
      '-v', `${tmpFile}:/sandbox/solution.py:ro`,
      'python-executor',
      'python3', '/sandbox/solution.py'
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
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
      const runtimeNs = endTime - startTime;
      const runtimeMs = Number(runtimeNs) / 1_000_000;

      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

      if (timedOut) {
        resolve({
          input: testCase.input,
          expected: testCase.output,
          actual: null,
          passed: false,
          error: 'Time Limit Exceeded',
          runtime: TIME_LIMIT_MS,
          memory: 0
        });
        return;
      }

      if (exitCode !== 0 || stderr) {
        const cleanedStderr = stderr
          .replace(/File ".*", line \d+/g, 'File "<your code>"')
          .replace(new RegExp('/sandbox/solution.py', 'g'), '<your code>')
          .trim();
        resolve({
          input: testCase.input,
          expected: testCase.output,
          actual: null,
          passed: false,
          error: cleanedStderr || `Exit code: ${exitCode}`,
          runtime: Math.round(runtimeMs * 100) / 100,
          memory: 0
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
          memory: parsed.memory || 0
        });
      } catch (parseErr) {
        resolve({
          input: testCase.input,
          expected: testCase.output,
          actual: stdout.trim(),
          passed: false,
          error: 'Could not parse output: ' + stdout.trim().slice(0, 200),
          runtime: Math.round(runtimeMs * 100) / 100,
          memory: 0
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
        memory: 0
      });
    });
  });
}

/**
 * Wrap the user's code into a complete Python script that:
 * 1. Imports necessary modules safely
 * 2. Defines the user's solution
 * 3. Extracts the function name
 * 4. Parses test input from string format
 * 5. Calls the function and prints JSON result
 */
function wrapCodeForExecution(code, inputStr) {
  // Extract the function name from the code
  const funcMatch = code.match(/def\s+(\w+)\s*\(/);
  const funcName = funcMatch ? funcMatch[1] : 'solution';

  // Build parser for the input based on its format
  const parsedInput = buildInputParser(inputStr);

  return `
import json
import sys
import time
import traceback

# -- User's solution --
${code}

# -- Test harness --
def _normalize(val):
    """Convert values to a canonical string for comparison."""
    if isinstance(val, bool):
        return str(val).lower()
    if isinstance(val, float):
        return str(round(val, 6))
    if isinstance(val, list):
        return '[' + ', '.join(_normalize(v) for v in val) + ']'
    if isinstance(val, str):
        # If it looks like it should be a number or list,
        # try to parse for comparison purposes
        return str(val)
    if isinstance(val, dict):
        items = sorted((str(k), _normalize(v)) for k, v in val.items())
        return '{' + ', '.join(f'{k}: {v}' for k, v in items) + '}'
    return str(val)

try:
    start = time.time()
    _input = ${parsedInput}

    # Call the function with the parsed input
    if isinstance(_input, tuple):
        result = ${funcName}(*_input)
    elif isinstance(_input, list):
        result = ${funcName}(*_input)
    else:
        result = ${funcName}(_input)

    end = time.time()
    runtime = round((end - start) * 1000, 2)

    print(json.dumps({
        "result": result,
        "runtime": runtime,
        "memory": 0
    }))
except Exception as e:
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
`.trim();
}

/**
 * Parse input strings like:
 *   "[2,7,11,15], 9" -> ( [2,7,11,15], 9 )
 *   '["h","e","l","l","o"]' -> ( ["h","e","l","l","o"] )
 *   '"abcabcbb"' -> ( "abcabcbb" )
 * Handles the LeetCode-style input format.
 */
function buildInputParser(inputStr) {
  if (!inputStr) return 'None';

  // Check if it looks like multiple arguments separated by commas at top level
  // We need to be careful with commas inside brackets
  const parts = splitTopLevel(inputStr);

  if (parts.length === 1) {
    return tryParseValue(parts[0]);
  }

  const parsedParts = parts.map(tryParseValue);
  return '[' + parsedParts.join(', ') + ']';
}

function splitTopLevel(str) {
  const parts = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inString) {
      current += ch;
      if (ch === stringChar && str[i - 1] !== '\\') {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }

    if (ch === '[' || ch === '{' || ch === '(') {
      depth++;
      current += ch;
      continue;
    }

    if (ch === ']' || ch === '}' || ch === ')') {
      depth--;
      current += ch;
      continue;
    }

    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function tryParseValue(val) {
  const trimmed = val.trim();

  // None/null
  if (trimmed === 'None' || trimmed === 'null') return 'None';

  // Boolean
  if (trimmed === 'True' || trimmed === 'true') return 'True';
  if (trimmed === 'False' || trimmed === 'false') return 'False';

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;

  // String (already quoted)
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed;
  }

  // List/array bracket notation - convert to Python list literal
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    // Keep as-is, Python can parse this
    return trimmed;
  }

  return trimmed;
}

/**
 * Normalize result string for comparison.
 * Handles list formatting, nested structures, and type coercion.
 */
function normalizeResult(val) {
  if (val === null || val === undefined) return 'null';

  let str;
  if (typeof val === 'string') {
    // Try to parse as JSON first
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

  // Normalize spacing: remove all whitespace
  str = str.replace(/\s+/g, '');

  // Normalize quotes
  str = str.replace(/'/g, '"');

  return str;
}

module.exports = { executeCode };
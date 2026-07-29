/**
 * Concurrency guard for Docker spawns. Spec section 10.
 *
 * Why: under load, naive `docker run` calls can pile up and exhaust the
 * host kernel. This module caps the number of in-flight executions and
 * rejects submissions that wait too long for a permit.
 *
 * Semantics (spec section 10A):
 *   - Module-level Semaphore sized from MAX_CONCURRENT_EXECUTIONS env
 *     (default 10).
 *   - Each submission acquires ONE permit before its docker spawn loop
 *     starts; release in finally when the submission finishes (or fails).
 *   - If acquire() waits more than QUEUE_TIMEOUT_MS (30s), the call
 *     rejects with `{ status: 'Queue full' }` — no docker spawn happens.
 *
 * Why one permit per submission (not per docker run): a submission with
 * many test cases would otherwise monopolise one slot per case, defeating
 * the cap. One permit per submission = one in-flight job per slot,
 * regardless of how many cases it has.
 */

const Semaphore = require('async-semaphore');

const QUEUE_TIMEOUT_MS = 30_000;

// Resolved once at module load. Re-resolving would invalidate in-flight
// permits and would not be safe under load.
const MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '10', 10) || 10
);

const _semaphore = new Semaphore(MAX_CONCURRENT);

/**
 * Acquire one permit, but wait at most `timeoutMs` for it. Resolves true
 * if acquired; resolves false if the timeout fires (the caller should
 * reject the work in that case).
 *
 * async-semaphore v2's `acquire(handler)` is callback-based; we wrap it
 * in a Promise and race against a setTimeout. If the timeout fires first,
 * we set a flag so the eventual acquire callback just releases the permit
 * instead of resolving the Promise. Net effect: zero permit leakage even
 * under timeout races.
 */
function acquireWithTimeout(timeoutMs = QUEUE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    let permitHolder = null; // track ownership so we can release on race loss

    const onAcquired = () => {
      if (settled) {
        // Timer won the race — release this permit immediately so we
        // don't leak it.
        _semaphore.release();
        return;
      }
      settled = true;
      permitHolder = true;
      resolve(true);
    };

    _semaphore.acquire(onAcquired);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);

    // If we resolved with `true` before the timer fired, clear it so the
    // event loop doesn't keep the (now-pointless) timer alive.
    Promise.resolve().then(() => {
      if (permitHolder) clearTimeout(timer);
    });
  });
}

/**
 * Run a unit of work under the concurrency cap.
 *
 * Resolves with the work's return value on success.
 * Rejects with `{ status: 'Queue full' }` if a permit didn't free up
 * within `timeoutMs` (default QUEUE_TIMEOUT_MS).
 * Rejects with the work's error otherwise (and the permit is released).
 */
async function runWithGuard(work, timeoutMs = QUEUE_TIMEOUT_MS) {
  const acquired = await acquireWithTimeout(timeoutMs);
  if (!acquired) {
    const err = new Error(
      `Concurrency limit reached; no slot freed in ${timeoutMs / 1000}s`
    );
    err.status = 'Queue full';
    throw err;
  }
  try {
    return await work();
  } finally {
    _semaphore.release();
  }
}

/**
 * Test-only: inspect the current semaphore state. Exposed so future
 * tests can assert the guard isn't accidentally bypassed.
 */
function _state() {
  return {
    maxConcurrent: MAX_CONCURRENT,
    availablePermits: _semaphore.availablePermits(),
    queueLength: typeof _semaphore.getQueueLength === 'function'
      ? _semaphore.getQueueLength()
      : 0,
    queueTimeoutMs: QUEUE_TIMEOUT_MS,
  };
}

module.exports = {
  runWithGuard,
  acquireWithTimeout,
  _state,
};

/**
 * Hints service — wraps Anthropic's SDK with a Socratic, executor-aware
 * system prompt. Spec section 7.
 *
 * The service builds the prompt from the problem, the user's current code,
 * the executor type, and the last three submissions. It then streams the
 * model's response back via an async generator yielding {text} chunks;
 * the route serialises each chunk as an SSE `data:` event.
 *
 * If `ANTHROPIC_API_KEY` is unset we emit a deterministic local fallback
 * so the route still works in development without a key. Set the env var
 * to enable real Claude calls.
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 600;

// Tool-specific hints the system prompt should bias toward. These come
// straight from the spec — "For PySpark: missing .cache(), wrong join
// type for skewed data, collect() on large DataFrames" and so on.
const TOOL_FOCUS = {
  python: [
    'Time complexity on the hot path',
    'Edge cases (empty input, single-element input, very large input)',
    'Mutability and aliasing bugs',
  ],
  sql: [
    'Window function partitioning vs ORDER BY interaction',
    'NULL handling in JOINs and aggregates',
    'Whether the result needs DISTINCT to collapse duplicate keys',
  ],
  pyspark: [
    'Missing .cache() on reused DataFrames',
    'Wrong join type for skewed data (broadcast vs sort-merge vs salting)',
    '.collect() or .toPandas() pulling a large DataFrame to the driver',
    'Shuffle partitions default — set spark.sql.shuffle.partitions for the workload',
  ],
  dbt: [
    'Missing is_incremental() guard — full table rewrite instead of merge',
    'Wrong ref() usage — models without a ref are not part of the DAG',
    'Missing tests on new columns',
  ],
  airflow: [
    'Missing retries config on idempotent tasks',
    'Wrong trigger_rule (e.g. all_success when one_success was intended)',
    'Cyclic dependency between tasks',
  ],
  kafka: [
    'Missing consumer.commit() so offsets never advance',
    'Wrong auto_offset_reset (latest vs earliest)',
    'Reading from a topic that does not exist yet',
  ],
  iceberg: [
    'Time-travel via snapshot_id, not the latest snapshot',
    'Partition pruning predicates must reference partition columns',
    'Schema evolution requires a snapshot_id, not a fresh read',
  ],
};

function buildSystemPrompt(executorType) {
  const toolFocus = (TOOL_FOCUS[executorType] || TOOL_FOCUS.python)
    .map((b, i) => `  ${i + 1}. ${b}`)
    .join('\n');

  return `You are a Socratic data-engineering tutor. Your job is to give a SHORT HINT — never the answer.

Rules:
- Be brief: 2-4 sentences, max ~80 words.
- Push the user toward the answer; do not give it.
- If the user is on the right track, point at the next obstacle.
- If they are stuck, name ONE concrete concept to look up.
- Use Markdown for code references (backticks around identifiers).

Tool focus for this problem (${executorType}):
${toolFocus}

NEVER write the corrected code. NEVER paste the solution. NEVER enumerate the steps to solve it.`;
}

function buildUserPrompt({ problem, code, executorType, submissionHistory }) {
  const history = (submissionHistory || [])
    .map((s, i) => {
      const parts = [
        `Attempt ${i + 1}: status=${s.status || 'unknown'}`,
        s.runtime != null ? `runtime=${s.runtime}ms` : null,
        s.executorType ? `tool=${s.executorType}` : null,
      ].filter(Boolean);
      let line = parts.join(', ');
      if (s.error) {
        // Trim error so we don't blow the prompt budget with tracebacks.
        const trimmed = String(s.error).slice(0, 300);
        line += `\n   error: ${trimmed}`;
      }
      return line;
    })
    .join('\n');

  return `Problem: ${problem.title}
Tool: ${executorType}
Description (truncated):
${(problem.description || '').slice(0, 1200)}

User's current code:
\`\`\`
${(code || '').slice(0, 2000)}
\`\`\`

Recent submissions:
${history || '(no submissions yet)'}

Give ONE short Socratic hint.`;
}

/**
 * Local fallback when ANTHROPIC_API_KEY is not set. Useful for
 * development without burning credits.
 */
function* fallbackHintStream(executorType) {
  const focus = (TOOL_FOCUS[executorType] || [])[0] ||
    'the algorithmic complexity of the hot path';
  const text =
    `Without an Anthropic API key configured, here's a generic hint: ` +
    `think about *${focus}* before changing anything else. ` +
    `Set ANTHROPIC_API_KEY to enable real Claude-powered hints.`;
  yield { text };
}

/**
 * Stream hint chunks as an async iterable of {text} objects. Caller is
 * responsible for serialising to SSE.
 */
async function* streamHint({ problem, code, executorType, submissionHistory }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    yield* fallbackHintStream(executorType);
    return;
  }

  const client = new Anthropic();
  const system = buildSystemPrompt(executorType);
  const userPrompt = buildUserPrompt({ problem, code, executorType, submissionHistory });

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta &&
      event.delta.type === 'text_delta' &&
      event.delta.text
    ) {
      yield { text: event.delta.text };
    }
  }
}

module.exports = {
  streamHint,
  buildSystemPrompt,
  buildUserPrompt,
  TOOL_FOCUS,
  MODEL,
};

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
  // Tier 3 / Section 11G — pipeline-aware hints. A pipeline submission
  // is a multi-stage DAG; failures can come from user code, scenario-
  // injected fixture mutations, or a broken inter-stage contract.
  // The focus is on diagnosis: WHICH stage failed and WHY, before
  // trying to fix anything. The `pipeline` executorType isn't a real
  // single-tool type (it's the 8th entry in EXECUTOR_CONFIG used by
  // the orchestrator itself); it's surfaced here so the system prompt
  // can branch when a pipeline history is in play.
  pipeline: [
    'Diagnosing which stage failed (topo order, not run order)',
    'Reading stage-level errors — is it user code, fixture data, or an inter-stage contract?',
    'Distinguishing scenario-injected failures (late_data, schema_drift, poison_message, oom_on_stage, slow_consumer) from organic bugs',
    'Time-to-diagnose patterns — what to read first when a downstream stage fails after an upstream change',
  ],
};

function buildSystemPrompt(executorType) {
  const toolFocus = (TOOL_FOCUS[executorType] || TOOL_FOCUS.python)
    .map((b, i) => `  ${i + 1}. ${b}`)
    .join('\n');

  // Section 11G — pipeline hints deserve a slightly stronger "diagnose
  // first, fix second" framing than single-tool hints. The user's code
  // is a DAG of stages; pointing them at the right stage matters more
  // than pointing them at the right line.
  const isPipeline = executorType === 'pipeline';
  const diagnosisRule = isPipeline
    ? '- Always identify WHICH stage failed before suggesting any fix; reference the stage by id.'
    : '';

  return `You are a Socratic data-engineering tutor. Your job is to give a SHORT HINT — never the answer.

Rules:
- Be brief: 2-4 sentences, max ~80 words.
- Push the user toward the answer; do not give it.
- If the user is on the right track, point at the next obstacle.
- If they are stuck, name ONE concrete concept to look up.
- Use Markdown for code references (backticks around identifiers).
${diagnosisRule}

Tool focus for this problem (${executorType}):
${toolFocus}

NEVER write the corrected code. NEVER paste the solution. NEVER enumerate the steps to solve it.`;
}

function buildUserPrompt({ problem, code, executorType, submissionHistory }) {
  const isPipeline = executorType === 'pipeline';
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
      // Section 11G — for pipeline runs, the submission carries a
      // stageResults[] (one verdict per stage in topo order). Surface
      // the FIRST non-passing stage so the tutor can diagnose the
      // pipeline rather than just summarise the final verdict.
      if (isPipeline && Array.isArray(s.stageResults) && s.stageResults.length) {
        const failing = s.stageResults.find((r) =>
          r && (r.status === 'failed' || r.status === 'error')
        );
        if (failing) {
          line += `\n   failed-stage: ${failing.stageId} (${failing.executorType}) status=${failing.status}`;
          if (failing.error) {
            const trimmedStageErr = String(failing.error).slice(0, 300);
            line += `\n   stage-error: ${trimmedStageErr}`;
          }
          // Surface scenario-injected failures targeted at this stage so
          // the tutor knows whether the failure is organic or synthetic.
          if (Array.isArray(failing.failures) && failing.failures.length) {
            const injected = failing.failures
              .filter((f) => f && f.applied)
              .map((f) => `${f.type}${f.note ? ` (${f.note})` : ''}`)
              .join('; ');
            if (injected) {
              line += `\n   injected-failures: ${injected}`;
            }
          }
        }
        // Also surface how many stages ran and how many were skipped —
        // gives the tutor the run's shape in one line.
        const passed = s.stageResults.filter((r) => r && r.status === 'passed').length;
        const skipped = s.stageResults.filter((r) => r && r.status === 'skipped').length;
        line += `\n   stages: ${passed} passed / ${skipped} skipped / ${s.stageResults.length} total`;
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
  // Section 11G — pipeline fallback points at the diagnosis step
  // rather than any particular tool, matching the pipeline focus areas.
  const lead = executorType === 'pipeline'
    ? `Without an Anthropic API key configured, here's a pipeline hint: `
    : `Without an Anthropic API key configured, here's a generic hint: `;
  const text =
    lead +
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

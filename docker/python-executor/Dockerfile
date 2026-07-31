FROM python:3.11-slim

# python-executor — default sandbox for single-tool Python submissions.
#
# Reads user code from /sandbox/solution.py and (optionally) per-test
# cases from /sandbox/test_cases.json. Executes the code in-process
# (no Spark/Kafka/etc.). Writes a JSON result line to stdout.
#
# Output contract (stdout, single line, valid JSON):
#     {"passed": true|false, "output": "...", "error": "...", "runtime_ms": N}
#
# Sandbox: container runs as non-root so a Python escape can't trivially
# escalate. Network is disabled by the worker (--net none).

RUN pip install --no-cache-dir --upgrade pip

# Mount points the runner expects:
#   /sandbox/solution.py     user-submitted code (mounted read-only by the worker)
#   /sandbox/test_cases.json optional per-test-case JSON
#   /runner/                 the runner script
RUN mkdir -p /sandbox /runner
COPY runner/ /runner/

# Sandbox user. The container runs as non-root so a Python escape can't
# trivially escalate.
RUN useradd -m sandbox && chown -R sandbox /runner /sandbox
USER sandbox

WORKDIR /runner

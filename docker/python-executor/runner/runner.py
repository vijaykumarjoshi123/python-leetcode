"""
Python submission runner.

Reads the user's submitted Python file from /sandbox/solution.py,
executes it against the test cases in /sandbox/test_cases.json
(if present), and writes a single JSON result line to stdout.

Contract (stdout, single line, valid JSON):
    {"passed": true|false, "output": "...", "error": "...", "runtime_ms": N}

The worker does the row-by-row diff against expected outputs.
We just RUN the code and capture the result of the last expression
or stdout from print() calls.

Failure modes:
- File missing -> error: "submission file not provided"
- Syntax error -> error: "<python SyntaxError message>", passed=false
- Runtime error -> error: "<traceback summary>", passed=false
- Test case mismatch -> handled by the worker (it compares result.actual
  against expected), we just need to surface the actual value
"""

import json
import os
import sys
import time
import traceback


SUBMISSION_FILE = os.environ.get("SUBMISSION_FILE", "/sandbox/solution.py")
TEST_CASES_PATH = os.environ.get("TEST_CASES_PATH", "/sandbox/test_cases.json")


def emit(result: dict) -> None:
    """Print a single JSON line and exit."""
    print(json.dumps(result), flush=True)


def load_test_case() -> dict | None:
    """Read the (single) test case the worker wrote alongside the solution.

    Returns None if no test_cases.json is present — useful for smoke tests
    that just want to know if the code runs without crashing.
    """
    if not os.path.isfile(TEST_CASES_PATH):
        return None
    try:
        with open(TEST_CASES_PATH, "r", encoding="utf-8") as f:
            cases = json.load(f)
        if isinstance(cases, list) and cases:
            return cases[0]
        return None
    except Exception:
        return None


def main() -> int:
    if not os.path.isfile(SUBMISSION_FILE):
        emit({
            "passed": False,
            "output": "",
            "error": "submission file not provided",
            "runtime_ms": 0,
        })
        return 1

    test_case = load_test_case()
    test_input = (test_case or {}).get("input", "")

    start = time.time()
    try:
        # The user's code is expected to define `solution()` and call it
        # with the test input. If the code raises, surface the traceback.
        #
        # We capture stdout so print() output becomes the result.output
        # field on the Submission document — useful for debugging.
        stdout_capture = []

        # Exec the user's code in a fresh namespace so they can't
        # accidentally clobber our locals.
        user_globals = {"__name__": "__main__"}
        with open(SUBMISSION_FILE, "r", encoding="utf-8") as f:
            user_code = f.read()

        # Compile first so a SyntaxError is reported cleanly without
        # partially-binding globals.
        compiled = compile(user_code, SUBMISSION_FILE, "exec")

        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            exec(compiled, user_globals)

        captured_output = buf.getvalue()

        elapsed_ms = round((time.time() - start) * 1000, 2)

        # If the user defined `solution(input)`, call it and use the
        # return value as the test result. Otherwise the captured stdout
        # is the result.
        if "solution" in user_globals and callable(user_globals["solution"]):
            try:
                # Most leetcode-style problems take the input as a string;
                # advanced problems parse it themselves.
                actual = user_globals["solution"](test_input)
            except Exception as exc:
                elapsed_ms = round((time.time() - start) * 1000, 2)
                emit({
                    "passed": False,
                    "output": captured_output,
                    "error": f"{type(exc).__name__}: {exc}",
                    "runtime_ms": elapsed_ms,
                })
                return 0
            actual_payload = {"result": actual}
        else:
            actual_payload = {"result": captured_output}

        emit({
            "passed": True,  # worker does the comparison; we just ran the code
            "output": captured_output,
            "error": "",
            "runtime_ms": elapsed_ms,
            **actual_payload,
        })
        return 0

    except SyntaxError as se:
        elapsed_ms = round((time.time() - start) * 1000, 2)
        emit({
            "passed": False,
            "output": "",
            "error": f"SyntaxError: {se.msg} (line {se.lineno})",
            "runtime_ms": elapsed_ms,
        })
        return 0
    except Exception as exc:
        elapsed_ms = round((time.time() - start) * 1000, 2)
        tb = traceback.format_exc().splitlines()
        # Trim traceback — keep first + last 3 lines for context.
        if len(tb) > 6:
            tb = [tb[0]] + ["  ..."] + tb[-3:]
        emit({
            "passed": False,
            "output": "",
            "error": "\n".join(tb),
            "runtime_ms": elapsed_ms,
        })
        return 0


if __name__ == "__main__":
    sys.exit(main())

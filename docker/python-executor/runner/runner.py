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


class _InvocationError(Exception):
    """Wraps a TypeError from a mis-shaped call so we can detect-and-retry."""


def _parse_test_input(test_input: str):
    """Parse the test input string into a Python value the user's solution
    can consume.

    Heuristics, in order:
      1. If the string looks like JSON (`[`, `{`, `"`, digits, `null`,
         `true`, `false`), parse it as JSON.
      2. If it contains `=` signs (the "nums = [...], target = 9" format
         from the legacy Leetcode-style seed), split on commas at the top
         level and evaluate each `name = expr` pair as Python.
      3. If it contains commas at the top level (positional args
         "[2,7,11,15], 9"), split and evaluate each piece.
      4. Fall back to returning the raw string (caller will pass it
         straight through to the user's function).
    """
    s = test_input.strip()
    if not s:
        return s

    # 1. JSON-shaped
    if s[0] in "[{\"\'-0123456789ntf" or s.startswith("null") or s.startswith("true") or s.startswith("false"):
        try:
            return json.loads(s)
        except Exception:
            pass

    # 2. "name = expr, name = expr"  (legacy Leetcode input format)
    if "=" in s and "," in s:
        try:
            import ast
            # Split on top-level commas (ignoring commas inside brackets).
            pieces = []
            depth = 0
            buf = []
            for ch in s:
                if ch in "[({":
                    depth += 1
                elif ch in "])}":
                    depth -= 1
                if ch == "," and depth == 0:
                    pieces.append("".join(buf).strip())
                    buf = []
                else:
                    buf.append(ch)
            if buf:
                pieces.append("".join(buf).strip())
            # Each piece is "name = expr". Drop the name, keep the expr.
            values = []
            for piece in pieces:
                if "=" in piece:
                    expr = piece.split("=", 1)[1].strip()
                    values.append(ast.literal_eval(expr))
                else:
                    values.append(ast.literal_eval(piece))
            return values if len(values) > 1 else values[0]
        except Exception:
            pass

    # 3. Top-level positional args: "[2,7,11,15], 9"
    if "," in s:
        try:
            import ast
            depth = 0
            buf = []
            pieces = []
            for ch in s:
                if ch in "[({":
                    depth += 1
                elif ch in "])}":
                    depth -= 1
                if ch == "," and depth == 0:
                    pieces.append("".join(buf).strip())
                    buf = []
                else:
                    buf.append(ch)
            if buf:
                pieces.append("".join(buf).strip())
            values = [ast.literal_eval(p) for p in pieces]
            return values if len(values) > 1 else values[0]
        except Exception:
            pass

    # 4. Fall back to the raw string
    return s


def _invoke_solution(solution_fn, test_input):
    """Call the user's solution with an input that's likely to match.

    Tries:
      1. Pass the parsed input as a single positional arg.
         - If the function takes 1 arg, success.
         - If the function takes N args and the parsed input is a list
           of length N, splat it.
      2. Fall back to passing the raw input string as a single arg.

    Returns either the function's return value, or an _InvocationError
    if the call raised.
    """
    import inspect
    try:
        sig = inspect.signature(solution_fn)
        param_count = len(sig.parameters)
    except (TypeError, ValueError):
        param_count = 1

    parsed = _parse_test_input(test_input)

    # If parsed is a list/tuple and the function expects multiple args,
    # splat.
    if param_count > 1 and isinstance(parsed, (list, tuple)) and len(parsed) == param_count:
        try:
            return solution_fn(*parsed)
        except Exception as exc:
            return _InvocationError(f"{type(exc).__name__}: {exc}")

    # Otherwise pass parsed as a single arg. If it's a complex type
    # (list, dict), pass as-is. If it's still a string, pass that.
    try:
        return solution_fn(parsed)
    except Exception as exc:
        return _InvocationError(f"{type(exc).__name__}: {exc}")


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
            actual = _invoke_solution(user_globals["solution"], test_input)
            if isinstance(actual, _InvocationError):
                elapsed_ms = round((time.time() - start) * 1000, 2)
                emit({
                    "passed": False,
                    "output": captured_output,
                    "error": str(actual),
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

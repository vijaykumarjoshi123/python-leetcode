# QA Report — ETLninja (repo: python-leetcode)

**Tested by:** Senior QA pass (automated + manual, API + browser UI)
**Date:** 2026-08-04
**Environment:** Full dev stack via `docker-compose up` (MongoDB 6, Redis, backend, worker, frontend, 8 pre-built executor images). Data: 10 single-tool problems seeded; pipeline data was **not** seeded (see Bug #7) and had to be seeded manually to test.
**Test method:** Every public API endpoint exercised via `curl`/Python; every user-facing screen exercised via headless browser (register → login → problems → solver → submit → leaderboard → profile → forum → hints → assessments → pipelines). Backend logs and worker logs monitored throughout. Direct Docker-exec of executor images to isolate runner bugs.

> **Read this first.** The headline is that **two entire core features are completely non-functional as shipped** (single-tool submissions and pipelines), one feature is unreachable (assessments), and one feature is unusable (AI hints). Everything else (auth, problem browsing, leaderboard, profile, forum read/create) works. Details and exact fixes below, ordered by severity.

---

## Severity scale

- **S0 — Showstopper.** A core user journey is 100% broken for everyone. Fix before anything else.
- **S1 — Critical.** A whole feature is unreachable, or a serious security/data issue.
- **S2 — Major.** Feature partially broken or wrong; bad UX but workaround exists.
- **S3 — Minor.** Cosmetic, data-hygiene, or polish.

---

## S0 — Showstoppers

### 🔴 Bug #1 — Every code submission fails. No user can ever pass any problem.

**Symptom (what the user sees):** Submit a correct solution to any problem (Python, SQL, etc.). It always returns **`Wrong Answer`** with `error: "Exit code: 1"` and `testCasesPassed: 0/total`, regardless of correctness. A correct Two Sum solution fails identically to a broken one.

**Reproduction:**
```
POST /api/submissions/submit  { problemId: <Two Sum>, code: <correct solution>, executorType: "python" }
→ status: Pending
→ (worker picks it up, ~1–4s)
→ status: "Wrong Answer", testCasesPassed: 0/3, error: "Exit code: 1"
```

**Root cause (proven, not guessed):** The worker writes each submission's temp file to the **wrong directory**, then tells the host Docker daemon to bind-mount a **different host path that does not exist**. The executor container therefore mounts an empty/nonexistent path, finds no solution file, and exits non-zero with no stdout.

Exact mechanism, traced file-by-file:
1. In the worker container, `pythonExecutor.js:80` resolves `codeExchangeDir = process.env.CODE_EXCHANGE_DIR || os.tmpdir()`. The env says `/code-exchange`, but the actual `fs.writeFileSync` calls land in `/app/code-exchange/` (verified by `find /` inside the container — new submission files for timestamps `1785859*` are at `/app/code-exchange/...`, **not** `/code-exchange/`). This means the writes are going to a container-internal, **non-volume-mounted** path.
2. The worker then spawns the executor with `-v "${hostExchangeDir}/<file>:/sandbox/solution.py:ro"` (`pythonExecutor.js:126`), where `hostExchangeDir = process.env.CODE_EXCHANGE_HOST_DIR` = `/Users/Vijay/python-leetcode/backend/code-exchange` (set in `docker-compose.yml`).
3. That host path (`backend/code-exchange`) is **not** where the files were written, and didn't previously exist. When Docker bind-mounts a nonexistent host path, it silently **auto-creates it as an empty directory**. Confirmed on disk: `backend/code-exchange/lc_exec_*.py` entries are all **directories**, not files (`drwxr-xr-x`, 0 bytes inside).
4. The executor's runner reads `/sandbox/solution.py`, finds nothing, emits `{"passed": false, "error": "submission file not provided"}`, exits 1. The worker records `Wrong Answer`.

**Proof the executor image and runner are fine:** Running the identical correct solution through the executor image directly (with the file mounted at the right path) returns the correct result:
```
$ docker run --rm -v /tmp/sol.py:/sandbox/solution.py:ro -v /tmp/tc.json:/sandbox/test_cases.json:ro \
    python-executor:latest python3 /runner/runner.py
{"passed": true, "output": "", "error": "", "runtime_ms": 2.69, "result": [0, 1]}
```

**Files involved:**
- `backend/services/pythonExecutor.js` — lines 80–103 (path resolution + mount logic)
- `docker-compose.yml` — `worker` service env: `CODE_EXCHANGE_DIR: /code-exchange`, `CODE_EXCHANGE_HOST_DIR: "${PWD}/code-exchange"`, and volume `./code-exchange:/code-exchange`. Note `${PWD}` at compose-eval time is the **backend dir** (because the worker build context is `./backend` and the command runs from there), not the repo root — this is the crux of the mismatch.

**Fix direction:** Make the worker's write path and the host mount path agree. Either (a) write files to `/code-exchange` (the actual volume mount, not `/app/code-exchange`) and set `CODE_EXCHANGE_HOST_DIR` to the real repo `code-exchange` absolute path; or (b) stop relying on a host-side path at all and have the worker `docker cp` the file into a named volume the executor also mounts. Option (a) is the smaller change. The `${PWD}` expansion in compose must resolve to the repo root, not `backend/`.

**Verification step after fix:** Submit the correct Two Sum solution above and confirm `status: "Accepted"`, `testCasesPassed: 3/3`.

---

### 🔴 Bug #2 — Every pipeline run fails at stage 1. The pipeline feature is 100% broken.

**Symptom:** Open any pipeline problem, click **Run pipeline** (clean run or with a scenario). Stage 1 always errors:
> `docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?`

All downstream stages are then marked `skipped` ("upstream stage failed"). Final score: `failed`, `0/4 stages passed`.

**Root cause:** `routes/pipelines.js` runs the orchestrator **synchronously inside the backend process** (`const run = await runPipeline({...})`). `runPipeline` calls `child_process.spawn('docker', ...)` per stage. But the **backend container has no Docker socket mounted** — by design, only the `worker` service mounts `/var/run/docker.sock` (the whole reason the worker exists is that the backend deliberately has no docker access; see the docblock at the top of `worker.js`). So the backend's `docker run` cannot reach the daemon and fails immediately.

The irony: `routes/pipelines.js` has a comment "Why no queue (yet)... synchronous is fine" — but it forgot the *reason* the single-tool flow uses a worker is precisely that the backend can't spawn docker.

**Files involved:**
- `backend/routes/pipelines.js` — `POST /run` handler (line ~625) calls `runPipeline` directly in-process.
- `backend/services/pipelineOrchestrator.js` — `runPipeline` / `runSingleStage` use `cp.spawn('docker', ...)`.
- `docker-compose.yml` — `backend` service has no `docker.sock` volume; `worker` has it.

**Fix direction:** Route pipeline runs through the worker, the same way single-tool submissions do: the `/run` endpoint should enqueue a BullMQ job (new `pipeline` queue or reuse `submissions` with a payload discriminator), and the worker — which has docker access — should call `runPipeline`. Return a run id immediately; the frontend polls `GET /api/pipelines/run/:runId` until `passed`/`failed`. The existing `GET /run/:runId` owner-only endpoint already supports the poll pattern; only the submit path needs to become async.

**Note:** The pipeline *report* UI is excellent — it correctly surfaced the real docker error in the per-stage table, computed a score, and rendered the breakdown. So once execution is unblocked, the reporting layer is ready.

---

## S1 — Critical

### 🟠 Bug #3 — Answer disclosure: `GET /api/problems/:id` leaks the reference solution AND hidden test cases to anonymous users.

**Symptom:** With **no authentication at all**, fetching any problem's detail returns the full `solution.code` (the reference answer) and the `hiddenTestCases` array (the secret grading inputs).

**Reproduction:**
```
$ curl http://localhost:5000/api/problems/<any-id>      # no token, no auth header
→ 200 OK, body includes:
  "solution": { "code": "def flatten(d, prefix=''):\n    out = {}\n    ..." }   ← the answer
  "hiddenTestCases": [ { "input": "...", "output": "..." } ]                    ← secret tests
```

**Impact:** On a hiring/practice platform this defeats the entire purpose — anyone can read the official solution to every problem and the exact hidden test inputs/outputs. The list endpoint (`GET /api/problems`) correctly strips these fields; only the detail endpoint leaks.

**Files involved:** `backend/routes/problems.js` — `GET /:id` does `Problem.findById(req.params.id)` and returns the whole document.

**Fix direction:** In `GET /:id`, project out the secret fields unless the caller is an admin: `.select('-solution.code -hiddenTestCases')`. (Visible `testCases` with `visible:false` should also be filtered for non-admins — currently the detail endpoint returns the hidden visible-flagged ones too.)

---

### 🟠 Bug #4 — No way to create a company account. The entire Assessments feature is unreachable.

**Symptom:** The Assessments feature (company dashboard, candidate invites, reports) requires `User.accountType === 'company'`. But **every registered user is `individual`** — there is no way, through the API or the UI, to become a company.

**Reproduction:**
```
POST /api/auth/register { ..., "accountType":"company", "companyName":"Acme" }
→ 200, returned user.accountType === "individual"   ← the fields are SILENTLY IGNORED

POST /api/assessments { ... } (as that user)
→ 403 { "error": "company account required" }
```
Confirmed: all ~10 users currently in the DB are `individual`. The register form has no account-type selector. The frontend only *reads* `accountType === 'company'` to conditionally render the dashboard link.

**Files involved:**
- `backend/routes/auth.js` — `POST /register` destructures only `{ username, email, password }`; ignores `accountType`/`companyName`.
- `frontend/src/pages/Register.js` — no account-type field in the form.

**Fix direction:** Accept `accountType` (and `companyName` when `company`) in the register route with validation, persist them on the User, and add an account-type selector to the register UI. This unblocks the entire assessments flow (whose backend logic is otherwise complete and correct — the CRUD, invite tokens, and report aggregation all tested fine once a company user exists).

---

### 🟠 Bug #5 — `/api/hints` always returns 401 "unauthenticated" for valid tokens. AI hints are unusable.

**Symptom:** Clicking "Get hint" (or `POST /api/hints` with a valid Bearer token) always returns `401 {"error":"unauthenticated"}`. The hint feature never works for any logged-in user.

**Root cause — JWT field mismatch:**
- `routes/auth.js` signs tokens with `jwt.sign({ userId: user._id }, ...)`. So the decoded token has `req.user.userId`.
- `routes/hints.js:69` reads `const userId = req.user && req.user.id;` — but `req.user.id` is **`undefined`** (the field is `userId`, not `id`).
- The subsequent `if (!userId) return res.status(401)...` therefore fires for everyone.

**Files involved:** `backend/routes/hints.js:69`. The same `req.user.id` bug exists in `backend/routes/tutor.js:13`, though that route happened to still return (a canned) response because it doesn't gate on `userId`.

**Fix direction:** Use `req.user.userId` consistently (or add an `auth` middleware normalizer that sets `req.user.id = decoded.userId` once, so all routes can use `req.user.id`). The hints *fallback* path (deterministic local hint when `ANTHROPIC_API_KEY` is unset) is fine — only the auth-field read is broken.

---

### 🟠 Bug #6 — The test suite cannot run. Node version mismatch (Node 18 vs Vitest 4).

**Symptom:** `npm test` crashes immediately on startup:
```
SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'
```
Zero tests execute. The 414-line `pipelineOrchestrator.test.js` suite is effectively dead code.

**Root cause:** `vitest@^4.1.10` requires Node ≥ 20.12 (it uses `util.styleText`). The backend Docker image is `node:18-alpine` (`backend/Dockerfile`), and the running container is `v18.20.8`.

**Files involved:** `backend/Dockerfile` (`FROM node:18-alpine`), `backend/package.json` (`vitest@^4.1.10`).

**Fix direction:** Bump the backend base image to `node:20-alpine` (or `node:22-alpine`). Then re-run `npm test` and confirm the orchestrator suite passes. (Local host Node may already be ≥20, masking this — it only shows up in the docker runtime.)

---

## S2 — Major

### 🟡 Bug #7 — Pipeline problems and scenarios are never seeded. The feature has no content even after Bug #2 is fixed.

**Symptom:** `db.pipelineproblems.countDocuments()` and `db.pipelinescenarios.countDocuments()` are both **0** after the normal seed. The Pipelines index page lists no problems.

**Root cause:** There is a `seeds/run_problems_seed.js` runner for regular problems, but **no equivalent runner for `seeds/pipeline_problems.js` / `seeds/pipeline_scenarios.js`** — those two files are pure data modules with no script to load them, and `backend/seed.js` doesn't reference pipelines. I had to write a throwaway runner to seed 1 problem + 9 scenarios before I could test the pipeline UI at all.

**Files involved:** `backend/seeds/pipeline_problems.js`, `backend/seeds/pipeline_scenarios.js` (data only), `backend/seed.js` (doesn't load them).

**Fix direction:** Add a `seeds/run_pipelines_seed.js` (mirror `run_problems_seed.js`) that upserts both collections, and wire it into `seed.js` / an `npm run seed:pipelines` script. Note: `pipeline_scenarios.js` keys scenarios by `pipelineProblemSlug`, so the runner must resolve slug → `_id` before inserting (the throwaway runner I wrote demonstrates this).

---

### 🟡 Bug #8 — SQL executor image is stale AND its `load_fixtures` is broken. SQL problems can never pass.

This is two compounding bugs in the DuckDB executor, found by running the image directly:

**(a) The built `duckdb-executor:latest` image is out of date.** The working tree has an uncommitted `_contains_question_mark` guard in `docker/duckdb-executor/runner/sql_runner.py` (201 lines), but the image contains the old 124-line version (`grep -c _contains_question_mark` returns 0 inside the image). The image was never rebuilt after the code change. So even the finished `?`-placeholder guard isn't in effect.

**(b) `load_fixtures` itself can't run.** Even a trivial `SELECT 1 AS one` (no fixtures touched by the user) fails with `Binder Error: Unexpected prepared parameter`. The cause is `sql_runner.py`'s `load_fixtures`: it registers views via
```python
con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet(?)", [path])
```
and this DuckDB version rejects the prepared `?` in `read_parquet`. So every SQL submission fails before the user's query even runs.

**Fix direction:** (a) Rebuild the image: `docker-compose -f docker-compose.yml -f docker-compose.build.yml build duckdb-executor` (and rebuild all executor images, since staleness may affect others). (b) Replace the prepared-statement fixture registration with a safe string interpolation after validating the parquet path, e.g. `con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{path.replace(chr(39), chr(39)*2)}')")`, or use `con.register`/a parameterized API that DuckDB accepts for this version.

---

### 🟡 Bug #9 — No authentication on `/api/submissions/submit`. Anyone can submit as any user.

**Symptom:** `POST /api/submissions/submit` takes `userId` from the **request body** and applies no auth. An attacker can submit code under any user's identity, pollute their stats/attempted-problems, and impersonate them in the grading pipeline.

**Reproduction:**
```
POST /api/submissions/submit   # no Authorization header
  { "userId": "<victim's _id>", "problemId": "...", "code": "..." }
→ 200, creates a Submission owned by the victim.
```

**Files involved:** `backend/routes/submissions.js` — `POST /submit` (line ~90). It reads `userId` straight from `req.body`.

**Fix direction:** Require the `auth` middleware, ignore the body's `userId`, and use `req.user.userId` as the submitter. (The same pattern Bug #5 hints at: normalize `req.user.id` in the auth middleware.)

---

### 🟡 Bug #10 — No authentication on any forum route. Anyone can post/forge as anyone.

**Symptom:** `GET /api/forum/problem/:id`, `POST /api/forum`, `POST /api/forum/:id/comment`, `PUT /api/forum/comment/:id/like` — none apply the `auth` middleware. `userId` is taken from the body, so a caller can create discussions/comments attributed to any user.

**Files involved:** `backend/routes/forum.js` — all handlers.

**Fix direction:** Apply `auth` to the mutating routes and source `userId` from `req.user`.

---

### 🟡 Bug #11 — Forum "like" is a stub. Likes never persist.

**Symptom:** `PUT /api/forum/comment/:commentId/like` always returns `200 {"msg":"Comment liked"}` but does **nothing** — the comment's `likes` count stays 0. Verified live: like a comment, re-fetch it, `likes` is unchanged.

**Files involved:** `backend/routes/forum.js` — the `PUT /comment/:commentId/like` handler is literally:
```js
router.put('/comment/:commentId/like', async (req, res) => {
  try { res.json({ msg: 'Comment liked' }); } catch (err) { ... }
});
```

**Fix direction:** Implement it: find the comment across discussions (it's nested under `Discussion.comments`), increment `likes`, save. Note the route currently takes `:commentId` but the schema nests comments inside discussions, so you'll need `Discussion.findOne({ 'comments._id': commentId })` then update the subdocument.

---

### 🟡 Bug #12 — `/api/tutor/hint` returns a hardcoded, problem-irrelevant "hint". Dead/placeholder AI.

**Symptom:** `POST /api/tutor/hint` returns a canned response pushing `cudf` / GPU acceleration regardless of the problem or code:
```json
{ "hint": "...try leveraging 'cudf' to parallelize the operation on the GPU.",
  "suggestion": "Look into cudf.DataFrame.sum()..." }
```
This is nonsensical for, e.g., a basic Two Sum Python problem. The "AI tutor" doesn't analyze anything.

**Files involved:** `backend/services/aiTutor.js` — `getAIHint` builds a prompt but **never calls any API**; it just returns canned text. This service is dead code superseded by `services/hintsService.js` (the real Anthropic-SSE implementation), but `routes/tutor.js` still calls `aiTutor`.

**Fix direction:** Either (a) delete `aiTutor.js` and point `routes/tutor.js` at `hintsService.js`, or (b) remove the `/api/tutor/hint` route entirely if `/api/hints` (once Bug #5 is fixed) supersedes it. Don't leave a fake-AI endpoint lying around.

---

## S3 — Minor / data hygiene / polish

### 🟢 Bug #13 — CORS allows all origins (`cors({ origin: '*' })`).
`backend/server.js:14`. Combined with JWT-in-localStorage this widens the blast radius of any XSS. Restrict to the known frontend origin(s) in production. Low severity for a dev platform, but should be tightened before public deploy.

### 🟢 Bug #14 — `JWT_SECRET` defaults to `'secret'`; docker-compose hardcodes `dev_secret_key`.
`backend/middleware/auth.js` & `routes/auth.js` fall back to `'secret'`; `docker-compose.yml` sets `JWT_SECRET: dev_secret_key`. Anyone who knows this can forge tokens. Use a strong secret in prod (and fail closed if unset, rather than defaulting).

### 🟢 Bug #15 — Register with a missing field returns HTTP 500 + raw bcrypt error instead of a clean 400.
```
POST /api/auth/register { "username":"x", "email":"x@x.com" }   # no password
→ 500 { "error": "Illegal arguments: undefined, string" }
```
**Fix:** Validate required fields (reuse `middleware/validate.js`) before hashing. Files: `backend/routes/auth.js`.

### 🟢 Bug #16 — False/inflated marketing numbers on the Home page.
Home shows "1000+ problems", "50K+ users", "100K+ submissions", "24/7 Available". Reality: 10 problems, ~10 users. And Two Sum's solver page shows "150002 submissions" while its acceptance is 75% and total submissions counter is 0 in the list view — internal counters are inconsistent/seeded with junk. Either wire these to real counts or label them as illustrative.

### 🟢 Bug #17 — Profile "rank" is misleading for users with 0 solves.
Profile computes rank as `countDocuments({solved > mine}) + 1`. A brand-new user with 0 solves shows rank "#3" while the leaderboard places them at #12. Users with equal solve counts all get the same optimistic rank. Consider `dense_rank`/`countDocuments({solved >= mine})` semantics or just hide rank until the user has ≥1 solve.

### 🟢 Bug #18 — Navbar "Discuss" link points to `/` (dead link).
`Navbar.js` — the "Discuss" link href is `/` instead of a discussions/forum index page. Clicking it goes home. Either point it at a real forum landing page or remove it.

### 🟢 Bug #19 — Committed runtime artifacts and missing gitignore entries.
- `code-exchange/` is NOT gitignored; 14 stray runtime temp `.py` submission files are committed (they're per-job ephemeral files that should never be in version control).
- `backend/seeds/__pycache__/apply_fixture_mutation.cpython-314.pyc` and `docker/duckdb-executor/runner/__pycache__/` are committed `.pyc` files.
**Fix:** Add `code-exchange/` and `**/__pycache__/` to `.gitignore`, then `git rm --cached` the existing offenders.

### 🟢 Bug #20 — `MAX_CONCURRENT_EXECUTIONS` has two different defaults for the same env var.
`submissionQueue.js:46` defaults the worker concurrency to `5`; `concurrencyGuard.js:30` defaults the semaphore to `10`; `.env.example` documents `10`. Three values for one knob. Pick one (probably 10) and use it in both places so docs, queue, and guard agree.

### 🟢 Bug #21 — `Submission.gpuRuntime` and `seed_gpu_problems.js` are dead.
The `gpuRuntime` field on the Submission schema is declared but **never written anywhere**; `seed_gpu_problems.js` exists but the GPU-executor concept isn't wired into `executorRouter` (no `useGpu` executor is actually configured to require a GPU image). Either finish the GPU track or remove the dead field/seeder to avoid confusion.

### 🟢 Bug #22 — Duplicate-looking accounts in the wild (`vijaykumarjoshi123` vs `vijaykumarjoshi123@gmail.com`).
Two separate users exist with effectively the same identity (one registered with the email as the username). Consider enforcing username ≠ email format, or merging. Worth checking the register validation.

---

## What works (no action needed)

These flows were tested live and behave correctly — calling out so a dev doesn't waste time re-checking:

- **Auth (happy path):** register, login, `GET /me`, password-stripping, duplicate-email rejection, wrong-password rejection, invalid-token rejection, bad ObjectId handling.
- **Problems browsing:** list, filter by difficulty/category/track, search (regex substring), pagination, invalid-id 400, missing-id 404.
- **Leaderboard:** global, per-user rank, per-difficulty, medal rendering, table columns.
- **Profile:** stats cards, skills radar (recharts), certificates section.
- **Pipeline UI (rendering only):** index page, problem page (5-step tutorial modal, topology diagram, 9 scenarios, per-stage editor), and the **report page** (score breakdown, per-stage table, skills radar, diagnostics) — all render excellently; only execution is broken (Bug #2).
- **Assessment backend logic (once a company user exists):** create/list/detail, invite-token generation, `GET /join/:token` (started/expired/consumed states), per-candidate report aggregation, company-gate middleware, problem-existence validation. All correct — only the inability to *become* a company (Bug #4) blocks it.
- **Single-tool executor images & runners (when invoked correctly):** the `python-executor` image + `runner.py` produce correct results when the file is mounted at the right path (proof in Bug #1). The runner's input-parsing heuristics (JSON / `name=expr` / positional args) handle the seeded test formats.

---

## Suggested fix order (for the picking-up developer)

1. **Bug #1** (submission path mismatch) — unblocks the #1 user journey. Small, localized fix.
2. **Bug #2** (pipeline runs through worker) — unblocks the flagship feature. Larger; reuses the existing worker pattern.
3. **Bug #6** (bump Node to 20) — unblocks the test suite so you can regression-test #1 and #2.
4. **Bug #5 + #9 + #10** (auth normalization: `req.user.id`, apply `auth` middleware to submissions/forum) — one coordinated auth pass fixes three bugs.
5. **Bug #3** (answer-leak projection) — one-line security fix.
6. **Bug #4** (company accountType on register) — unblocks assessments.
7. **Bug #8** (rebuild executor images + fix DuckDB `load_fixtures`) — do alongside the rebuild triggered by #1.
8. **Bug #7** (pipeline seed runner) — needed before #2 is user-visible.
9. Bugs #11, #12, then the S3 polish batch (#13–#22).

---

## Environment note (how to reproduce the test setup)

The stack was brought up with `docker compose up -d` from the repo root (images were already built). All five services (mongodb, redis, backend, worker, frontend) must be healthy for the app to function — the app does **not** run with bare `nodemon` alone (MongoDB and Redis are not installed on the host; they only exist as containers). To re-run any check above: `docker compose up -d`, then `docker exec python-leetcode-backend-1 node seed.js`, then hit `http://localhost:3000` / `http://localhost:5000`.

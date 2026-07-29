# Project Analysis: Data Engineering Assessment Platform

> **Status as of 2026-07-27 — Sections 1, 2, 3, and 4 of the multi-executor build are complete and pushed to `origin/main`.** Sections 5–10 remain. See **§7 Build Status & Resumption** for what's done and what's next.

---

## 1. Executive Overview

The project has pivoted from a Python LeetCode-style practice platform into a **technical skills assessment platform for data engineers**. LeetCode, HackerRank, and Codility test toy algorithms and SQL puzzles; companies actually hire data engineers for Spark, dbt, Airflow, Kafka, Snowflake-style SQL, and Iceberg. This platform runs real tool execution inside sandboxed Docker containers so candidates can prove they can do real data engineering work.

### Target Users
- **Individuals** (free + paid): data engineers practicing for interviews.
- **Enterprises** (paid): companies running structured candidate assessments against this problem set.

### Headline
Real tool execution. SQL and Python challenges are kept as a foundation track but are no longer the product.

### Non-Goals (Standing Constraints)
1. **No real Snowflake/Databricks connections.** DuckDB replaces Snowflake (compatible SQL dialect). PyIceberg + DuckDB replaces Databricks. Intentional.
2. **No Airflow scheduler in-container.** Task-level isolation testing only.
3. **No Next.js.** React 18 SPA stays.
4. **No Postgres migration.** MongoDB stays.
5. **No removal of GPU problems.** `Data-GPU`/`Opt-GPU` are one track among many.
6. **No CodeMirror.** Monaco editor stays.
7. **JWT only.** No sessions, no OAuth, no social login.
8. **Certificates are display-only.** No blockchain, no PDF signing, no external verification.

---

## 2. Technical Architecture

### High-Level Stack
- **Frontend**: React 18 (SPA) + Monaco Editor.
- **Backend**: Node.js + Express.js (REST API).
- **Database**: MongoDB via Mongoose.
- **Queue**: Redis + BullMQ.
- **Realtime**: Socket.io (forum, live submission updates).
- **Execution Engine**: Per-tool Docker sandbox, dispatched through an executor router. NVIDIA GPU acceleration remains an opt-in via `--gpus all` (router-driven, currently unused).

### Executor Dispatch (NEW — Section 1)

Submission flow with executor routing:

```
POST /api/submissions/submit
   └─ validates executorType against VALID_EXECUTOR_TYPES
   └─ persists { executorType } on the Submission doc
   └─ enqueues { submissionId, executorType } onto BullMQ
        └─ worker (submissionQueue.js) reads executorType
             └─ pythonExecutor.js resolves Docker image/argv/timeout/memory
                  from executorRouter.js (single source of truth)
             └─ spawns `docker run <image> <argv>` and parses JSON result
```

**File responsibilities after Section 1:**

| File | Owns |
|---|---|
| [backend/services/executorRouter.js](backend/services/executorRouter.js) | Whitelist + per-tool Docker image, build argv, timeout, memory, toolVersion, useGpu. Single source of truth. |
| [backend/routes/submissions.js](backend/routes/submissions.js) | Accepts and validates `executorType` from POST body, defaults `'python'`, passes to job payload. |
| [backend/services/submissionQueue.js](backend/services/submissionQueue.js) | Reads `executorType` from job, calls `executeCode(code, testCases, executorType)`, persists `executorType`/`toolVersion`/`executionRuntime` on Submission. |
| [backend/services/pythonExecutor.js](backend/services/pythonExecutor.js) | Resolves config from router, assembles `docker run` argv (no shell splitting), captures stdout JSON. |

### Executor Images (NEW — Sections 3 + 4)

Seven Docker images under [docker/](docker/):

| Type | Image | Timeout | Memory | Runner entry | Notes |
|---|---|---|---|---|---|
| `python` | `python-executor` (existing) | 5s | 256MB | `python3 /sandbox/solution.py` | Backward compatible |
| `sql` | `duckdb-executor` | 10s | 256MB | `python3 /runner/sql_runner.py` | DuckDB = Snowflake-compatible SQL |
| `pyspark` | `pyspark-executor` | 60s | 1024MB | `bash /runner/spark_runner.sh` | bitnami/spark:3.5 base |
| `dbt` | `dbt-executor` | 30s | 512MB | `bash /runner/dbt_runner.sh` | dbt-core + dbt-duckdb |
| `airflow` | `airflow-executor` | 30s | 512MB | `python3 /runner/airflow_runner.py` | DAG import + structural validation + PythonOperator execution with mock context |
| `kafka` | `kafka-executor` | 30s | 512MB | `bash /runner/kafka_runner.sh` | Embedded Kafka 3.7 in KRaft mode |
| `iceberg` | `iceberg-executor` | 30s | 512MB | `python3 /runner/iceberg_runner.py` | PyIceberg + DuckDB; covers Databricks/Iceberg |

Each runner emits a single JSON line to stdout:

```json
{"passed": true|false, "output": "...", "error": "...", "runtime_ms": N}
```

Build all six new images in one command:

```bash
docker-compose -f docker-compose.yml -f docker-compose.build.yml build
```

Each new executor service is tagged `profiles: ["build"]` so `docker-compose up` does not start idle containers. The backend worker spawns them on demand via `docker run`.

### Sandbox posture (all images)
- Non-root `sandbox` user.
- `--net none` enforced at the executor (router does not set it; the executor does).
- `--memory <config.memoryMb>m` from router config — Spark gets 1024MB, others ≤512MB.
- `--cpus 1.0`.
- Code file mounted `:ro` to a per-tool path inside the container.
- `--gpus all` only when the router marks the executor `useGpu` (currently none are — preserved for the existing GPU python problems).

### Data Model (Section 2 — schema additions)

[Submission.js](backend/models/Submission.js):
- `executorType` — String, enum from router, default `'python'`
- `toolVersion` — String, e.g. `"PySpark 3.5"`
- `executionRuntime` — Number, wall-clock ms

[Problem.js](backend/models/Problem.js):
- `executorType` — enum, default `'python'`, required
- `track` — enum: `foundations`/`data-engineering`/`streaming`/`orchestration`/`lakehouse`, default `foundations`
- `starterCode` — `Map<String, String>` keyed by executorType
- `evaluationScript` — String (path or inline)

[User.js](backend/models/User.js):
- `solvedByTrack` — 5 Number subpaths (foundations, data-engineering, streaming, orchestration, lakehouse) — powers the profile radar in §6C
- `certificates` — subdocument array (`track`, `awardedAt`, `problemCount`)

The `executorType` enum and `track` enum are sourced from the router and the model respectively; adding a new tool to the router widens `Submission.executorType` automatically.

---

## 3. Previous SWOT (Pre-Pivot)

### Strengths (Carried Forward)
- Async producer/consumer architecture.
- Hardened sandbox posture (network isolation, resource limits, `:ro` mounts).
- Independent scaling of API and worker.

### Weaknesses (Carried Forward, Lower Priority)
- Redis is a single point of failure in compose.
- GPU passthrough is configured but no executor currently sets `useGpu: true`.

### Opportunities (Pivoted)
- ~~NVIDIA cuDF/cuOpt as the headline~~ → real multi-tool execution as the headline, with NVIDIA cuDF/cuOpt retained for the `foundations`-style GPU problems.
- **Multi-tool execution**: One platform that grades real Spark, dbt, Airflow, Kafka, SQL, Iceberg work, not toy puzzles.
- **Company assessment dashboard**: Per-candidate reports with AI-generated summaries (Sections 8D).
- **AI hints**: Socratic, executor-aware (Section 7).

### Threats
- Docker spawn storms without a concurrency guard (Section 10 adds the semaphore).

---

## 4. Production Roadmap (Pivoted)

The original three-phase roadmap (Hardening → NVIDIA → AI/Scale) is superseded by the **Data Engineering Assessment Platform** spec, which is a 10-section build. Status is tracked in **§7**.

### Master Plan Sections
1. **Executor routing** — COMPLETE (pushed).
2. **MongoDB schema updates** — COMPLETE (pushed).
3. **Docker executor images (×6)** — COMPLETE (pushed).
4. **Docker Compose updates** — COMPLETE (pushed).
5. **Seed problems per track** — COMPLETE (pushed).
6. **Frontend changes** — COMPLETE (uncommitted in working tree).
7. **Hints API** — COMPLETE (uncommitted in working tree).
8. **Company assessment dashboard** — COMPLETE (uncommitted in working tree).
9. **Environment & email service** — COMPLETE (uncommitted in working tree).
10. **Execution concurrency guard** (semaphore) — COMPLETE (uncommitted in working tree).

**All 10 sections are done.** §7 has the file-by-file manifest for everything in the working tree; pushing it closes out the build.

### Out of Scope (Per Spec)
- Real Snowflake/Databricks connections.
- Airflow scheduler in-container.
- Migrating off MongoDB.
- Replacing Monaco.
- Adding OAuth/social login.
- PDF-signed certificates.

---

## 5. Operational Notes

### Building & Running

```bash
# Build everything (DBs + API + 6 executor images):
docker-compose -f docker-compose.yml -f docker-compose.build.yml build

# Run the platform:
docker-compose up

# Build only executor images:
docker-compose -f docker-compose.yml -f docker-compose.build.yml build \
  duckdb-executor pyspark-executor dbt-executor airflow-executor kafka-executor iceberg-executor
```

### Adding a New Executor Tool

1. Add a config entry to [backend/services/executorRouter.js](backend/services/executorRouter.js) (`image`, `buildCmd`, `timeout`, `memoryMb`, `toolVersion`, `useGpu`).
2. Create [docker/<name>-executor/](docker/) with a `Dockerfile` and `runner/` that emits the JSON contract.
3. Add a build entry to [docker-compose.yml](docker-compose.yml) and [docker-compose.build.yml](docker-compose.build.yml).
4. The schema enums in [Submission.js](backend/models/Submission.js) and [Problem.js](backend/models/Problem.js) widen automatically.

### JSON Contract Between Runner and Executor

Every runner must print exactly one line of valid JSON:

```json
{"passed": true|false, "output": "...", "error": "...", "runtime_ms": N}
```

The executor ([pythonExecutor.js](backend/services/pythonExecutor.js)) `JSON.parse`s stdout and runs `normalizeResult` on the result. If your runner doesn't emit JSON, the executor reports `"Could not parse output: <first 200 chars>"`.

---

## 6. Architecture Diagram

See [Architecture.png](Architecture.png) for the canonical reference. (Pushed to remote as commit `77fa6bf`.)

---

## 7. Build Status & Resumption

### Completed and Pushed to `origin/main`

| Section | Commit | What landed |
|---|---|---|
| 1A | `1ae53d8` | [executorRouter.js](backend/services/executorRouter.js) — whitelist + per-tool config |
| 1B–1D, 2, 3, 4 | `a075413` ("untill section 4") | Router-driven executor, schema updates (Submission/Problem/User), six Docker images, compose build entries + override |
| 5, 6A | `18b63f9` ("added all project files for the following skills:") | Seven seed problems, airflow runner XCom extension, frontend track filter + executor pills |

### Completed Locally (Not Yet Pushed)

The working tree holds Sections 6B–6D, 7, and 8 plus two more user-model fields and a tweaked `.env.example`. Run `git status` to confirm before committing.

**Section 6 — Frontend**

- **6B** [frontend/src/pages/ProblemSolver.js](frontend/src/pages/ProblemSolver.js) — fetches `starterCode[executorType]`; per-executor Monaco language map (`python`→python, `sql`/`dbt`→sql, others→python); "Running on: PySpark 3.5 · DuckDB 0.10" header badge via `EXECUTOR_TOOL_VERSION` map; submit handler now sends `executorType`; per-problem executor/track tags and per-submission `executionRuntime`/`toolVersion` rendering
- **6B** [frontend/src/pages/ProblemSolver.css](frontend/src/pages/ProblemSolver.css) — `.executor-tag` + `.executor-{type}` colour variants matching Problems.css
- **6C** [frontend/src/pages/Profile.js](frontend/src/pages/Profile.js) — recharts `RadarChart` Skills Radar (5 axes, one per track); Certificates section as cards with track name, problem count, award date
- **6C** [frontend/src/pages/Profile.css](frontend/src/pages/Profile.css) — `.profile-section`, `.radar-wrapper`, `.certificates-grid`, `.certificate-card` styling
- **6D** [frontend/src/components/AIHintPanel.jsx](frontend/src/components/AIHintPanel.jsx) — collapsible right-side panel; `fetch` + `ReadableStream` SSE client (handles both `data:` lines and raw text); `AbortController`-based cancel; markdown via `react-markdown`; "Get hint" disabled during execution or in timed assessments; warning shown when `isTimedAssessment` is true
- **6D** [frontend/src/components/AIHintPanel.css](frontend/src/components/AIHintPanel.css) — full panel styling
- AIHintPanel wired into ProblemSolver via new `.hint-column` (sticky right column)

**Limitation noted in code:** the Skills Radar uses raw counts per track because the User schema doesn't store a per-(track, difficulty) breakdown. The spec's full difficulty weighting (Easy=1, Medium=2, Hard=3) would need a future schema delta to be exact.

**Section 7 — Hints API**

- [backend/services/hintsService.js](backend/services/hintsService.js) — Socratic, executor-aware system prompt with per-tool focus list pulled verbatim from the spec (PySpark skew/caching, dbt incremental guards, Kafka commit/offset, Iceberg time-travel, etc.); user prompt composes problem + code + last-3 submissions; `streamHint` async generator yielding `{text}` chunks; `ANTHROPIC_API_KEY` unset → deterministic local fallback so the route works without a paid key
- [backend/routes/hints.js](backend/routes/hints.js) — `POST /api/hints`; JWT-required; `executorType` validated via `isValidExecutorType` (router is the source of truth); **rate limit** via Redis (`INCR hints:{userId}:{problemId}` + first-call `EXPIRE 86400`, returns 429 with `retryAfterSeconds` when exceeded, fixed-window 5/day); graceful degradation if Redis is down (warns and continues); SSE response with proper headers (`Cache-Control: no-cache`, `X-Accel-Buffering: no`); `req.on('close')` aborts the upstream stream
- [backend/.env.example](backend/.env.example) — `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` added
- [backend/package.json](backend/package.json) — `@anthropic-ai/sdk` ^0.39.0 installed
- [backend/server.js](backend/server.js) — `/api/hints` mounted

**Cost note:** Per spec, the hints feature uses the Anthropic API at runtime. Sonnet 4.5 + max_tokens=600 ≈ 2600 tokens per call ≈ $0.015/hint. The 5/day rate limit caps the worst case. Without a key, the deterministic fallback still exercises the full streaming pipeline (useful for dev and tests). Section 9 will add the SMTP env vars; this section is feature-complete.

**Section 8 — Company Assessment Dashboard**

- [backend/models/Assessment.js](backend/models/Assessment.js) — `companyId`, `title`, `description`, `problemIds[]`, `invitedCandidates[]` (with single-use token + status enum), `timeLimit`, `expiresAt`, `markExpiredCandidates()` instance method
- [backend/models/User.js](backend/models/User.js) — added `accountType` enum (`individual`/`company`) and `companyName` so "company-auth required" has a basis
- [backend/routes/assessments.js](backend/routes/assessments.js) — 6 endpoints (create/list/detail/invite/join/report); `loadOwnedAssessment` middleware (validates ObjectId, enforces `assessment.companyId === req.user`); `requireCompany` middleware; public `/join/:token` returns the problem set and marks the candidate `started`; report endpoint derives per-candidate scores from the Submission collection (no duplicated state)
- [frontend/src/pages/AssessmentDashboard.jsx](frontend/src/pages/AssessmentDashboard.jsx) + [AssessmentDashboard.css](frontend/src/pages/AssessmentDashboard.css) — company-gated list view; per-assessment cards with candidate table; "Invite candidates" modal (textarea → tokens → copy-friendly invite URLs); "View report" toggles a per-assessment report panel
- [frontend/src/pages/CandidateReport.jsx](frontend/src/pages/CandidateReport.jsx) + [CandidateReport.css](frontend/src/pages/CandidateReport.css) — `/assessments/:id/report/:email`; per-problem results table; Skills Radar (per-problem axis); **deterministic AI summary placeholder** (`buildAiSummary`) — flagged for a future endpoint; "Download PDF" via `window.print()` with `@media print` stylesheet hiding `.no-print`
- [frontend/src/services/api.js](frontend/src/services/api.js) — `assessmentsAPI` wrapper (list/create/detail/invite/report/joinByToken)
- [frontend/src/App.js](frontend/src/App.js) — 2 new routes (`/assessments`, `/assessments/:id/report/:email`)
- [frontend/src/components/Navbar.js](frontend/src/components/Navbar.js) — "Assessments" link shown only when `user?.accountType === 'company'`

**Known limitations / future work:** candidate-side join page (the public `/assessments/join/:token` route is server-complete but no UI consumes it yet); AI assessment summary endpoint (currently the client-side placeholder).

**Section 9 — Environment & Email Service**

- [backend/.env.example](backend/.env.example) — added `SMTP_HOST/PORT/USER/PASS/FROM`, `INVITE_BASE_URL`, `DOCKER_SOCKET`, `MAX_CONCURRENT_EXECUTIONS`. Comments explain each.
- [backend/services/emailService.js](backend/services/emailService.js) — nodemailer wrapper, single export `sendInviteEmail(to, assessmentTitle, inviteUrl)`. Lazy transporter; if `SMTP_HOST` is unset returns `{skipped: true}` (still emits a copy-pasteable URL on the frontend). Never throws; failures return `{error}`. Plain text + HTML bodies; `escapeHtml()` helper for the title.
- [backend/package.json](backend/package.json) — `nodemailer` ^6.10.1.
- [backend/routes/assessments.js](backend/routes/assessments.js) — invite handler now actually sends emails via `Promise.all` per candidate. Response carries `inviteUrl` (server-built from `INVITE_BASE_URL`) and per-row email outcome.
- [frontend/src/pages/AssessmentDashboard.jsx](frontend/src/pages/AssessmentDashboard.jsx) + [AssessmentDashboard.css](frontend/src/pages/AssessmentDashboard.css) — invite-results list shows per-row status pill (`email sent` / `no SMTP` / `email failed`) with tooltips.

**Section 10 — Concurrency Guard**

- [backend/services/concurrencyGuard.js](backend/services/concurrencyGuard.js) — module-level `Semaphore` sized from `MAX_CONCURRENT_EXECUTIONS` (default 10). `acquireWithTimeout(timeoutMs)` uses a Promise-wrapped `semaphore.acquire(cb)` raced against `setTimeout` with a "release on race loss" flag to prevent permit leakage. `runWithGuard(work, timeoutMs=30000)` is the public API; throws `Error` with `.status='Queue full'` on timeout. `_state()` exposed for tests.
- [backend/services/pythonExecutor.js](backend/services/pythonExecutor.js) — the whole submission's docker-spawn loop wrapped in `runWithGuard`. **One permit per submission** (not per docker spawn) — matches the spec's "If a job waits more than 30s" wording.
- [backend/services/submissionQueue.js](backend/services/submissionQueue.js) — `catch (err)` now distinguishes `err.status === 'Queue full'` → `submission.status = 'Queue Full'` vs generic `'Runtime Error'`.
- [backend/models/Submission.js](backend/models/Submission.js) — added `'Queue Full'` to the status enum.
- [backend/package.json](backend/package.json) — `async-semaphore` ^2.0.0. **Note: v2 only, not v1** — v2 has a callback API, so the wrapper promisifies it.

### Resumption Point

**The build is complete.** No further sections in the master plan. The working tree holds Sections 6B–6D, 7, 8, 9, and 10 plus this update to [project_analysis.md](project_analysis.md). Commit and push to close out.

**Suggested commit shape** for the working tree (in chronological order of what to ship first):

```
Section 9: env additions + emailService.js wired into assessment invites
Section 10: async-semaphore concurrency guard for docker spawns
Sections 6B-6D: per-executor editor, Profile radar + certs, AI hint panel
Section 7: Anthropic-powered hints API with Redis rate limit
Section 8: company assessment dashboard + candidate report
project_analysis.md: status reflects all 10 sections complete
```

One combined "Sections 6–10 complete the master plan" commit is also defensible and matches the granularity of the earlier `a075413 "untill section 4"` and `18b63f9 "added all project files..."` commits.

---

## 8. Conclusion

**The Data Engineering Assessment Platform master plan is complete.** All 10 sections are functionally done:

- **Execution substrate** (1–4): router-driven dispatch across 7 executor types, schema updates, six new Docker images, compose + build override
- **Content** (5): seven seed problems, one per executor type, across all five tracks
- **User-facing product** (6): track filter + executor pills on the problem list, per-executor editor with starter code and tool badges, Profile Skills Radar + Certificates, AI hint panel with SSE-streamed markdown
- **Product surface** (7–10): Anthropic-powered hints API with Redis rate limit, company assessment dashboard with candidate reports and PDF export, nodemailer-based invite emails, and an async-semaphore guard that prevents Docker spawn storms

The full assessment engine is end-to-end testable today: a user can sign in, pick a problem from any of the seven tool categories, write and submit code, get a pass/fail result, request an AI hint, and — for company accounts — assemble candidates into a timed or untimed assessment with auto-emailed invites. What's left is operational polish: deployment scripts, monitoring, and the candidate-side join UI (the server route is complete but there's no consumer page yet).

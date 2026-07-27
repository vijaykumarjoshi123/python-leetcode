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
1. **Executor routing** — COMPLETE.
2. **MongoDB schema updates** — COMPLETE.
3. **Docker executor images (×6)** — COMPLETE.
4. **Docker Compose updates** — COMPLETE.
5. **Seed problems per track** — NOT STARTED.
6. **Frontend changes** (track filter, ProblemSolve, Profile radar, AIHintPanel) — NOT STARTED.
7. **Hints API** (SSE, Anthropic SDK, rate-limited) — NOT STARTED.
8. **Company assessment dashboard** — NOT STARTED.
9. **Environment & email service** — NOT STARTED.
10. **Execution concurrency guard** (semaphore) — NOT STARTED.

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
| 1B | (next to push) | [pythonExecutor.js](backend/services/pythonExecutor.js) refactored to use the router; argv (not shell strings); `--gpus all` is router-driven; returns `{ executorType, toolVersion, executionRuntime, results, passed, totalTestCases, firstError }` |
| 1C | (next to push) | [backend/routes/submissions.js](backend/routes/submissions.js) — accepts/validates `executorType`, default `'python'`, passes to job payload |
| 1D | (next to push) | [backend/services/submissionQueue.js](backend/services/submissionQueue.js) — reads `executorType` from job, passes to executor, persists new fields |
| 2A/2B/2C | (next to push) | [Submission.js](backend/models/Submission.js), [Problem.js](backend/models/Problem.js), [User.js](backend/models/User.js) — new fields and enums |
| 3A–3F | (next to push) | Six new Docker executor images under [docker/](docker/) |
| 4 | (next to push) | [docker-compose.yml](docker-compose.yml) build entries + [docker-compose.build.yml](docker-compose.build.yml) override |

> Sections 1B–4 are written to disk but **not yet committed/pushed** at the time this section was last edited. Run `git status` to confirm. They form one logical commit ("Sections 1–4: executor routing + schema + Docker images + compose").

### Not Started

- **Section 5** — [backend/seeds/problems.js](backend/seeds/problems.js). One problem per executorType (7 total: python/sql/pyspark/dbt/airflow/kafka/iceberg). Each needs `title`, `description` (markdown), `difficulty`, `executorType`, `track`, `starterCode`, `hiddenTestCases`, `evaluationScript`.
- **Section 6** — Frontend: track filter sidebar in ProblemList; ProblemSolve loads `starterCode[executorType]` and sets Monaco language; Profile adds the **Skills Radar** via recharts and a Certificates section; create [AIHintPanel.jsx](frontend/src/components/AIHintPanel.jsx) as a collapsible right-side panel with markdown rendering and an SSE-streamed response.
- **Section 7** — [backend/routes/hints.js](backend/routes/hints.js): `POST /api/hints`, Anthropic SDK with executor-aware system prompt, SSE, 5 hints/user/problem/day via Redis TTL.
- **Section 8** — Company assessment dashboard. New [backend/models/Assessment.js](backend/models/Assessment.js), [backend/routes/assessments.js](backend/routes/assessments.js), [frontend/src/pages/AssessmentDashboard.jsx](frontend/src/pages/AssessmentDashboard.jsx), [frontend/src/pages/CandidateReport.jsx](frontend/src/pages/CandidateReport.jsx). Candidate invite via single-use tokens.
- **Section 9** — `.env.example` additions (Anthropic, SMTP, INVITE_BASE_URL, MAX_CONCURRENT_EXECUTIONS) + [backend/services/emailService.js](backend/services/emailService.js).
- **Section 10** — Semaphore on the executor: `npm install async-semaphore`, wrap the `docker run` call, reject with `{ status: 'Queue full' }` if waiting >30s.

### Resumption Point

Resume at **Section 5**. Memory has been updated to reflect this (`project-master-plan.md`, `resumption-point.md` under `~/.claude/projects/-Users-Vijay-python-leetcode/memory/`).

---

## 8. Conclusion

The platform has pivoted from a Python LeetCode clone into a real-tool data engineering assessment platform. Sections 1–4 land the execution-engine substrate (router, schema, Docker images, compose). Sections 5–10 deliver the user-facing product (problems, frontend tracks, hints, company dashboard, concurrency guard). The execution side is structurally complete; what's left is content (problems) and product surface (UI, assessments, hints).

# 🥷 ETLninja — Data Engineering Skills Platform

A hands-on practice and assessment platform for data engineers. Real tools, real
sandboxes, real scenarios: every submission runs inside an isolated Docker
container with the **actual** tool — Python, SQL (DuckDB), PySpark, dbt, Airflow,
Kafka, and Iceberg — not a toy simulator. Built with React, Node.js/Express,
MongoDB, Redis, and BullMQ.

## 🚀 Features

- **Real-tool execution**: submissions run in sandboxed Docker containers per
  tool (no network, memory/CPU capped), graded against real fixtures.
- **8 executor types**: Python, SQL (DuckDB / Snowflake-compatible), PySpark,
  dbt, Airflow, Kafka, Iceberg, and multi-stage Pipelines.
- **Multi-stage pipelines**: end-to-end DAGs (Kafka → Spark → Iceberg → dbt)
  with injectable failure scenarios (OOM, late data, schema drift, poison
  messages) for diagnosis practice.
- **Company assessments**: invite candidates via single-use tokens, track
  per-candidate reports.
- **AI hints**: Socratic, executor-aware hints via Claude (with a deterministic
  fallback when no API key is set).
- **Leaderboards, profiles, skills radar, certificates**.

## 📋 Tech Stack

- **Frontend**: React 18, React Router, Monaco Editor, Recharts, Zustand.
- **Backend**: Node.js 20, Express, Mongoose 7, Socket.io.
- **Queue**: BullMQ + Redis (producer in the API, consumer in a separate worker
  that has Docker-socket access).
- **Database**: MongoDB 6.
- **Execution**: 8 custom Docker executor images (one per tool).

## 🛠 Installation & Running

The app is designed to run via Docker Compose (MongoDB and Redis are not
installed on the host — they only exist as containers).

1. **Clone and enter the repository**
   ```bash
   git clone <repo-url>
   cd python-leetcode   # local dir name; the app brand is ETLninja
   ```

2. **Build the executor images** (one time)
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.build.yml build
   ```

3. **Bring up the stack**
   ```bash
   docker compose up -d
   ```
   Services: `mongodb`, `redis`, `backend` (:5000), `worker`, `frontend` (:3000).

4. **Seed the database**
   ```bash
   docker exec etlninja-backend-1 node seed.js
   # or, to (re)seed just the problem set:
   docker exec etlninja-backend-1 node seeds/run_problems_seed.js
   ```

5. **Open the app** at http://localhost:3000

> ⚠️ The app does **not** run with bare `nodemon` alone — it requires MongoDB +
> Redis + the worker process. Use `docker compose up`.

## 📁 Project Structure

```
python-leetcode/                  # local dir (brand: ETLninja)
├── backend/                       # Express API + BullMQ worker
│   ├── models/                    # Mongoose schemas
│   ├── routes/                    # API endpoints (/api/*)
│   ├── services/                  # execution engine, queue, orchestrator
│   ├── seeds/                     # problem + pipeline seed data
│   ├── server.js                  # API entry
│   └── worker.js                  # BullMQ consumer entry (docker-spawning)
├── frontend/                      # React SPA
│   └── src/{pages,components,services}
├── docker/                        # executor images (one per tool)
│   ├── python-executor/  duckdb-executor/  pyspark-executor/
│   ├── dbt-executor/     airflow-executor/ kafka-executor/
│   ├── iceberg-executor/ pipeline-runner/
├── docker-compose.yml             # dev stack
├── docker-compose.prod.yml        # production stack (nginx)
└── nginx/nginx.conf               # SPA + /api reverse proxy
```

## 🔧 API Endpoints (summary)

- **Auth**: `POST /api/auth/{register,login}`, `GET /api/auth/me`
- **Problems**: `GET /api/problems` (filter by difficulty/category/track/search),
  `GET /api/problems/:id`, `GET /api/problems/categories`
- **Submissions**: `POST /api/submissions/submit` (auth), `GET /api/submissions/:id` (poll)
- **Pipelines**: `POST /api/pipelines/run` (async), `GET /api/pipelines/run/:runId`
- **Assessments**: company CRUD + candidate invites + reports
- **Hints**: `POST /api/hints` (SSE, auth, rate-limited)
- **Leaderboard / Forum**: standard CRUD

See `TESTING_REPORT.md` for the full verified behavior of each endpoint.

## 🚀 Deployment

See `DEPLOYMENT.md` (Railway/Render/Vercel) and `HETZNER.md` (self-hosted with
Docker Compose). Production uses `docker-compose.prod.yml` with nginx.

## 📝 License

MIT License

---

**Sharpen your ETL skills.** 🥷

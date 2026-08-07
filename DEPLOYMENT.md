# Deployment Guide

## 🚀 Quick Start Deployment

### Prerequisites
- GitHub account
- Vercel account (for frontend)
- Railway.app or Render account (for backend)
- MongoDB Atlas account (for database)

---

## 📦 Step 1: Set up MongoDB Atlas (Free Cloud Database)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Sign up for free account
3. Create a new cluster (M0 free tier)
4. Get your connection string:
   - Click "Connect"
   - Choose "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database password

---

## 🔌 Step 2: Deploy Backend (Railway or Render)

### Option A: Railway.app

1. Go to [Railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select this repository
5. Add environment variables:
   ```
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_secure_random_string
   NODE_ENV=production
   ```
6. Set root directory: `backend`
7. Railway will auto-detect Node.js and deploy!
8. Copy your backend URL (e.g., `https://etlninja-prod.up.railway.app`)

### Option B: Render.com

1. Go to [Render.com](https://render.com)
2. Sign up with GitHub
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Configure:
   - **Name**: etlninja-api
   - **Environment**: Node
   - **Build Command**: `cd backend && npm install`
   - **Start Command**: `cd backend && npm start`
   - **Root Directory**: `/backend`
6. Add environment variables (same as above)
7. Deploy!

---

## 🎨 Step 3: Deploy Frontend (Vercel)

1. Go to [Vercel](https://vercel.com)
2. Sign up with GitHub
3. Click "Add New" → "Project"
4. Import this repository
5. Configure:
   - **Framework Preset**: Create React App
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `build`
6. Add environment variable:
   ```
   REACT_APP_API_URL=https://your-backend-url.up.railway.app
   ```
7. Click "Deploy"
8. Vercel will give you a live URL!

---

## 🌐 Step 4: Update API URLs

Update your code with the production URLs:

**In frontend/.env.production:**
```
REACT_APP_API_URL=https://your-backend-url.up.railway.app
```

**In backend/.env.production:**
```
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_secure_random_string
NODE_ENV=production
```

---

## 📱 Step 5: Connect Custom Domain (Optional)

### For Vercel Frontend:
1. Go to your Vercel project settings
2. Navigate to "Domains"
3. Add your custom domain
4. Update DNS records with provider

### For Railway Backend:
1. In Railway project, go to "Settings"
2. Add custom domain
3. Update DNS records

---

## 🔐 Security Checklist

- [ ] Change JWT_SECRET to a strong random string
- [ ] Enable MongoDB IP whitelist in Atlas
- [ ] Set environment variables in production
- [ ] Use HTTPS only
- [ ] Enable CORS properly
- [ ] Rate limit API endpoints
- [ ] Add input validation
- [ ] Monitor logs regularly

---

## 📊 Monitoring & Logs

### Railway:
- View logs in Railway dashboard
- Set up alerts in settings

### Render:
- View logs in Render dashboard
- Email notifications for failures

### Vercel:
- Monitor edge functions
- Check analytics dashboard

---

## 🆘 Troubleshooting

### Backend not connecting to MongoDB
```bash
# Check your MONGODB_URI format
# Should be: mongodb+srv://username:password@cluster.mongodb.net/database
```

### Frontend getting CORS errors
- Add backend URL to allowed origins
- Check environment variables are set

### Deployment stuck
- Check build logs
- Verify all dependencies are in package.json
- Clear build cache and retry

---

## 🎯 Next Steps

1. **Add more features**:
   - Video tutorials
   - Mock interviews
   - Contest mode
   - Premium subscription

2. **Performance optimization**:
   - Add caching
   - Optimize database queries
   - CDN for static files

3. **Marketing**:
   - SEO optimization
   - Social media
   - Community building

---

## 📞 Support

For deployment issues, refer to:
- [Railway Documentation](https://docs.railway.app)
- [Render Documentation](https://render.com/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [MongoDB Atlas Documentation](https://docs.atlas.mongodb.com/)

---

# Production Self-Hosted Deployment (Docker)

> This is the production deployment path. The Vercel/Railway tutorial above
> is from the pre-pivot era and references the old frontend/backend split.
> The current architecture is a single-host Docker deployment with
> nginx in front of the React SPA, a Node API behind it, MongoDB + Redis,
> and on-demand executor containers spawned by the backend worker.

## Architecture

```
                    TLS terminator (e.g. Caddy / Cloudflare / ELB)
                                       |
                                       v
                            +---------------------+
                            |   frontend (nginx)  |  :80
                            |   - serves SPA      |
                            |   - /api/*  -> backend
                            +---------------------+
                                       |
                                       v
                            +---------------------+
                            |       backend       |  :5000 (internal only)
                            |   - Express API     |
                            |   - BullMQ worker   |
                            |   - spawns Docker   |
                            +-----+----------+----+
                                  |          |
                                  v          v
                            +---------+  +--------+
                            | MongoDB |  | Redis  |
                            +---------+  +--------+
                                  ^
                                  |  on-demand
                                  |
                +------+------+------+------+------+------+
                |duckdb |pyspark|dbt  |airflow|kafka|iceberg|
                +------+------+------+------+------+------+
                (each is a separate Docker image, built once,
                 spawned by the backend as `docker run <image>`)
```

## Files added for production deploy

| File | Purpose |
|---|---|
| [backend/Dockerfile.prod](backend/Dockerfile.prod) | Multi-stage prod build. Prunes dev deps, drops to non-root, ships `tini` for signal handling, includes a `/api/health` healthcheck. |
| [frontend/Dockerfile.prod](frontend/Dockerfile.prod) | Stage 1 builds the React bundle (`react-scripts build`). Stage 2 serves it through nginx with our [nginx/nginx.conf](nginx/nginx.conf). |
| [nginx/nginx.conf](nginx/nginx.conf) | Serves the SPA, reverse-proxies `/api/*` to the backend. SSE-friendly (no buffering) so `/api/hints` streams correctly. |
| [docker-compose.prod.yml](docker-compose.prod.yml) | Override compose for production: prod Dockerfiles, no source mounts, `env_file` from `/etc/platform/*.env`, healthchecks, `restart: unless-stopped`. |
| [backend/.env.prod.example](backend/.env.prod.example) | Production env template. Copy to `/etc/platform/backend.env` on the host and fill in secrets. |

## One-time host setup

```bash
# 1. Install Docker + Docker Compose (v2+).
# 2. Pull the repo.
git clone https://github.com/vijaykumarjoshi123/python-leetcode.git /opt/platform
cd /opt/platform

# 3. Create the secrets directory and fill in env files.
sudo mkdir -p /etc/platform
sudo cp backend/.env.prod.example /etc/platform/backend.env
sudo chmod 600 /etc/platform/backend.env
sudo $EDITOR /etc/platform/backend.env
#   ^ Set JWT_SECRET to a strong random value:
#     node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
#   ^ Set ANTHROPIC_API_KEY (optional — fallback works without it).
#   ^ Set SMTP_HOST/PORT/USER/PASS/FROM.
#   ^ Set INVITE_BASE_URL to your real public URL.

# 4. Build all images (backend, frontend, 6 executors).
docker-compose -f docker-compose.yml \
               -f docker-compose.prod.yml \
               -f docker-compose.build.yml build

# 5. Start the platform.
docker-compose -f docker-compose.yml \
               -f docker-compose.prod.yml \
               -f docker-compose.build.yml up -d

# 6. (One-time) seed the database with the seven starter problems.
docker-compose -f docker-compose.yml -f docker-compose.prod.yml \
  exec -T backend node seeds/problems.js

# 7. Smoke test.
curl http://localhost/api/health
# Should return {"status":"Server is running"}
```

## Day-to-day operations

### Restart a service
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml restart backend
```

### View logs
```bash
# Tail all services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

# Just the backend
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend
```

### Deploy a new version
```bash
git pull
docker-compose -f docker-compose.yml \
               -f docker-compose.prod.yml \
               -f docker-compose.build.yml build backend frontend
docker-compose -f docker-compose.yml \
               -f docker-compose.prod.yml \
               up -d backend frontend
```

### Rotate JWT_SECRET
```bash
# Generate new secret
NEW_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")

# Edit /etc/platform/backend.env (or use sed)
sudo sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$NEW_SECRET|" /etc/platform/backend.env

# Restart the backend to pick it up
docker-compose -f docker-compose.yml -f docker-compose.prod.yml restart backend
# Note: all existing user sessions are invalidated by this.
```

### Backup MongoDB
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec -T mongodb \
  mongodump --archive --gzip > /backup/mongo-$(date +%F).gz
```

## TLS termination

This deploy serves HTTP on port 80 only. Put a TLS terminator in front:

- **Caddy** — easiest. Caddy auto-provisions Let's Encrypt certs.
  ```caddyfile
  your-platform.example.com {
      reverse_proxy localhost:80
  }
  ```
- **Cloudflare** — set up an SSL/TLS > Full (Strict) origin, point the
  CNAME at your server. Cloudflare handles certs.
- **AWS ALB** — add an HTTPS listener, attach an ACM cert, set the
  target group to port 80.

## Scaling

Single-host is fine for ~100 concurrent users. Beyond that:

- **Vertical**: bump the host; raise `MAX_CONCURRENT_EXECUTIONS` in
  `/etc/platform/backend.env` proportionally to RAM.
- **Horizontal**: split the backend into multiple instances behind a
  load balancer. MongoDB and Redis are already shareable. The worker
  (BullMQ) is naturally distributed; each instance pulls its own jobs.
- **Executors stay on the same host as the backend worker** — the
  `docker.sock` mount means the backend needs local Docker access. If
  you ever split executors onto a separate host, the [pythonExecutor.js](backend/services/pythonExecutor.js)
  `spawn('docker', ...)` becomes an SSH call instead.

## Pipeline simulator (Tier 3)

The pipeline simulator (Sections 11A–11K) adds an 8th executor type
(`pipeline`) and one extra Docker image (`pipeline-runner`). Everything
else is unchanged.

### What ships new

- `docker/pipeline-runner/Dockerfile` — python:3.11-slim + duckdb/
  pandas/pyarrow for the final per-stage comparison. Non-root sandbox
  user.
- `docker/pipeline-runner/runner/pipeline_runner.{sh,py}` — bash wrapper
  + Python comparison script. Reads `PIPELINE_SPEC` JSON describing each
  stage's actual output path + expected output path, runs DuckDB diffs
  in parallel, emits a single JSON verdict line.
- `docker-compose.yml` + `docker-compose.prod.yml` — `pipeline-runner`
  is added under `profiles: ["build"]` (off by default in prod so the
  larger image doesn't bloat every CI run).

### Enabling the feature

The pipeline simulator is **opt-in per user**:

1. Set `pipelineEnabled: true` on the user document:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend \
     node -e 'require("./models/User").findByIdAndUpdate(process.argv[1], {pipelineEnabled: true})' <userId>
   ```
2. Seed the sample problem + scenarios (one-time):
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend \
     node seeds/pipeline_problems.js
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend \
     node seeds/pipeline_scenarios.js
   ```
   The first script creates the clickstream pipeline problem; the
   second attaches 9 scenarios (oom, late_data, schema_drift,
   poison_message, slow_consumer, composite, tutorial) and the
   tutorial scenario used by the first-visit modal.
3. Build the fixture tree (host-side, not in the backend container):
   ```bash
   cd docker/pipeline-runner/fixtures/real-time-clickstream-analytics
   python3 ../../../backend/seeds/generate_clickstream_fixtures.py
   ```
   This creates the 10-row MVP parquet fixtures (~36 KB total) used by
   the per-stage runs.

### Runtime knobs

- `MAX_CONCURRENT_EXECUTIONS` — already gates per-tool submissions.
  Section 11D's concurrency guard (`runWithGuard`) wraps the entire
  pipeline run under one permit, so a single pipeline takes one slot
  even though it spawns multiple containers. Default 5 means at most
  5 concurrent pipeline runs.
- `PIPELINE_FIXTURES_ROOT` — host path to the source fixtures tree.
  Default `<repo>/docker/pipeline-runner/fixtures`. Override to point
  at a shared network mount or a faster scratch dir.
- `PIPELINE_FIXTURES_TMP` — where per-run mutated copies live. Default
  `os.tmpdir()`. The OS reclaims `/tmp` on reboot.
- `PIPELINE_DIAGNOSTICS_MODE` — `always` (default), `on-failure`, or
  `never`. Controls the persistence-side cost-limit for the
  observability surface (Section 11I). In dev `always` is fine; in prod
  `on-failure` keeps Mongo writes bounded on clean runs.

### Resource budget

The clickstream pipeline runs all four stages in sequence. Wall-clock
on a small host (4 vCPU, 8 GB RAM):

  - kafka  (KRaft boot):    ~25 s
  - pyspark (spark-submit): ~15 s
  - iceberg (PyIceberg):     ~10 s
  - dbt (duckdb adapter):    ~10 s
  - pipeline-runner diff:    ~3 s
  - total:                  ~60-90 s

A pipeline holds one concurrency permit for the full duration. If you
have many users running pipelines simultaneously, raise
`MAX_CONCURRENT_EXECUTIONS` and `MAX_QUEUE_SIZE` proportionally, plus
add RAM (each stage container reserves 512 MB–1 GB depending on
executor type; see `backend/services/executorRouter.js`).

### Production checklist

- [ ] `pipeline-runner` image is built once and tagged (not rebuilt per
      run). Push to your registry:
      ```bash
      docker build -t your-registry.example.com/pipeline-runner:latest docker/pipeline-runner/
      docker push your-registry.example.com/pipeline-runner:latest
      ```
- [ ] `docker-compose.prod.yml` references the registry tag, not
      `build: docker/pipeline-runner`.
- [ ] Fixture tree is read-only at deploy time. The orchestrator copies
      fixtures into `PIPELINE_FIXTURES_TMP` for each run; the source
      tree must not be mutable from inside containers.
- [ ] Backend log volume has a rotation policy. The
      `apply_fixture_mutation.py` helper logs each mutation at INFO;
      a busy pipeline week produces ~50 KB of logs per run.

### What stays the same

- The 7-tool flow (python/sql/pyspark/dbt/airflow/kafka/iceberg) is
  untouched. Existing submissions keep working without any change.
- `/api/submissions/submit` still rejects `executorType: 'pipeline'`
  with a 400 pointing callers at `/api/pipelines/run`. Single-tool
  users are not affected by the simulator's existence.
- `User.pipelineEnabled` defaults to `false` on the model so existing
  users don't accidentally see the new feature.

## Security checklist

- [ ] `JWT_SECRET` is a strong random value (not `dev_secret_key`).
- [ ] MongoDB and Redis are NOT exposed on host ports 27017/6379. Only
      the backend container reaches them on the platform-net network.
- [ ] TLS terminator is in front of port 80.
- [ ] SMTP credentials are stored in `/etc/platform/backend.env` with
      mode 0600.
- [ ] The Docker socket is mounted into the backend container only
      (not into frontend or other services). Treat it as a privileged
      surface — anyone who can run code in the backend can spawn
      containers.
- [ ] Backups run daily (see mongodump recipe above).
- [ ] Log rotation configured (Docker's default json-file driver will
      fill the disk eventually; set `--log-opt max-size=10m` on each
      service).



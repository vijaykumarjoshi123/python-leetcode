# Hetzner Production Deployment Guide

A focused recipe for deploying the platform on a single Hetzner dedicated
server. This complements `DEPLOYMENT.md` with specifics that only
matter on Hetzner hardware — the cloud-agnostic flow lives there.

## Recommended server

| Tier | Use case | Notes |
|------|----------|-------|
| **CX31** (4 vCPU, 8 GB) | MVP / single-tenant | Comfortable for ~50 concurrent single-tool submissions; 5 concurrent pipelines at most. |
| **AX41-NVMe** (8 vCPU, 16 GB, NVMe) | Growth | 100+ concurrent single-tool; 10 concurrent pipelines. NVMe matters for parquet fixture reads. |
| **AX52** (16 vCPU, 32 GB) | Production | 200+ concurrent; 20+ pipelines. |

Network egress is unmetered on all of Hetzner's dedicated line — useful
because each pipeline run does ~6 container starts + ~50 MB of
inter-container traffic.

## Provisioning

```bash
# 1. Order the server from Hetzner Cloud Console, pick Ubuntu 24.04.
# 2. SSH in as root.
ssh root@<server-ip>

# 3. Create a non-root user with docker access.
adduser platform
usermod -aG docker platform

# 4. Install Docker + Compose.
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# 5. Clone the repo (or pull a release tarball).
git clone https://github.com/vijaykumarjoshi123/python-leetcode.git /opt/platform
cd /opt/platform
```

## Firewall

Hetzner's cloud firewall should expose only 80/443 + SSH. The
platform's Mongo and Redis are NOT publicly accessible — only the
backend container reaches them on the internal `platform-net`
Docker network.

```bash
# Hetzner Cloud Firewall rule set (apply via hcloud CLI):
hcloud firewall create --name platform
hcloud firewall add-rule --direction in --protocol tcp --port 22 \
  --source-ips 0.0.0.0/0 --name platform  # restrict to your IP in prod
hcloud firewall add-rule --direction in --protocol tcp --port 80 \
  --source-ips 0.0.0.0/0 --name platform
hcloud firewall add-rule --direction in --protocol tcp --port 443 \
  --source-ips 0.0.0.0/0 --name platform
hcloud firewall apply-to-server --server <id> --firewall platform
```

## DNS

Point your domain at the server's public IP. A records for
`your-platform.example.com`. Optionally a `*.your-platform.example.com`
wildcard if you want per-user subdomains.

## First-boot setup

```bash
cd /opt/platform
cp backend/.env.example backend/.env
# Edit: MONGODB_URI, JWT_SECRET, REDIS_URL, SMTP_*, INVITE_BASE_URL
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

This brings up: backend, frontend, mongodb, redis, the worker, and the
seven per-tool executor images. The `pipeline-runner` image is under
`profiles: ["build"]` so it's NOT built by default — opt in:

```bash
# Build the pipeline-runner image (one-time, ~5 min on CX31).
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --profile build build pipeline-runner
# Verify it built.
docker images | grep pipeline-runner
```

## Backups

Hetzner's storage volumes can be snapshotted daily. The platform
already runs `mongodump` for the database; for the rest, a daily
`/opt/platform` snapshot is sufficient:

```bash
# /etc/cron.d/platform-snapshot — runs at 03:00 UTC.
0 3 * * * root hcloud volume create --name platform-$(date +\%F) \
  --size 100 --location nbg1 --server <id>
```

Snapshots cost ~€0.01/GB/month on Hetzner; a 100 GB daily snapshot
rotated weekly is ~€7/month.

## Pipeline simulator specifics

### Building the runner image once

The `pipeline-runner` image is large (python:3.11-slim + duckdb +
pandas + pyarrow, ~1.2 GB). On a small CX31, building it takes
~5 minutes. Build it ONCE, tag it, push to Hetzner's container
registry (or any registry) so redeployments pull instead of rebuild:

```bash
# Build + tag + push (one-time).
docker build -t registry.your-platform.example.com/pipeline-runner:v1 \
  docker/pipeline-runner/
docker push registry.your-platform.example.com/pipeline-runner:v1

# Edit docker-compose.prod.yml to reference the registry tag instead
# of `build: docker/pipeline-runner/`. The image is ~1.2 GB and pulls
# in ~30 seconds on Hetzner's internal network.
```

### Fixture tree placement

The pipeline simulator needs a host-side fixture tree at
`/opt/platform/docker/pipeline-runner/fixtures/`. The orchestrator
copies fixtures into `PIPELINE_FIXTURES_TMP` for each run, so the
source tree is read-only. Place it on NVMe-backed storage if you
have the AX41-NVMe tier — the parquet reads benefit from NVMe's
4K random read latency (~50 µs vs SATA's ~200 µs).

```bash
# Generate the clickstream MVP fixtures (one-time).
cd /opt/platform/docker/pipeline-runner/fixtures/real-time-clickstream-analytics
python3 /opt/platform/backend/seeds/generate_clickstream_fixtures.py

# Verify the tree is in place.
ls -la /opt/platform/docker/pipeline-runner/fixtures/real-time-clickstream-analytics/
```

### Resource budgeting

The clickstream pipeline runs all four stages sequentially and holds
one concurrency permit for ~60-90 seconds. On a CX31 with
`MAX_CONCURRENT_EXECUTIONS=5` (the default), the math is:

- 5 pipelines × ~70 s = each pipeline waits ~70 s × (5-1) = 280 s
  wall-clock to start under full saturation.
- Memory: each stage container reserves 512 MB–1 GB depending on
  executor type. With 5 concurrent pipelines × 4 stages × ~700 MB
  average = ~14 GB just for stage containers.

A CX31 (8 GB RAM) cannot comfortably run 5 concurrent pipelines.
For the clickstream MVP you'll want either:
- Lower `MAX_CONCURRENT_EXECUTIONS=2` (single CX31), or
- Upgrade to AX41-NVMe / AX52 for higher concurrency.

### Persistent logs

Hetzner's dedicated servers don't ship with a managed log service.
Set up `logrotate` on the Docker json-file driver so the disk doesn't
fill up over months:

```bash
# /etc/logrotate.d/docker
/var/lib/docker/containers/*/*.log {
  rotate 7
  daily
  compress
  missingok
  notifempty
  copytruncate
}
```

The platform's backend logs are ~50 KB per pipeline run, so a 7-day
rotation window at 10 runs/day is ~3.5 MB — comfortably bounded.

## Monitoring

Hetzner offers a Cloud Monitoring add-on (free) that pulls
Prometheus-compatible metrics from the server. Install the node
exporter and point it at the Hetzner monitoring endpoint:

```bash
docker run -d --name node-exporter \
  --restart unless-stopped \
  -p 127.0.0.1:9100:9100 \
  prom/node-exporter:latest
```

The Hetzner monitoring console auto-detects node-exporter and
surfaces CPU, RAM, disk, and network metrics.

## Cost summary (Hetzner CX31 baseline)

| Item | Monthly |
|------|---------|
| CX31 dedicated server | €14 |
| Daily snapshots (rotated, 7-day retention) | €7 |
| Cloud Firewall | free |
| Cloud Monitoring | free |
| Egress | free (unmetered) |
| **Total** | **~€21/month** |

Add the AX41-NVMe tier for ~€30/month and you get 8 vCPU + 16 GB +
NVMe, which comfortably runs the clickstream MVP with 5 concurrent
pipelines.

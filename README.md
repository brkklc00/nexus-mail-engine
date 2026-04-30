# Nexus

Production-grade, self-hosted bulk email operations platform.

## Stack

- Next.js App Router + TypeScript + Tailwind
- PostgreSQL + Prisma
- Redis + BullMQ
- Nodemailer
- Zod
- Recharts
- Docker Compose

## Quick Start

1. Copy `.env.example` to `.env`
2. Install packages: `pnpm install`
3. Generate Prisma client: `pnpm prisma:generate`
4. Run migrations: `pnpm prisma:migrate`
5. Start web: `pnpm dev:web`
6. Start worker: `pnpm dev:worker`
7. Optional seed (manual only): `npm run seed`

## Key Directories

- `apps/web`: premium admin UI + API routes + tracking endpoints
- `apps/worker`: BullMQ worker runtime + fairness scheduler + delivery processor
- `packages/rate-control`: effective-rate + token-bucket pacing
- `packages/data-hygiene`: import cleaning + dedupe + suppression-aware normalization
- `packages/queue`: queue names/contracts and job payloads
- `prisma/schema.prisma`: production data model

## Working Production Flow

1. Login at `/login` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
2. Open `/send`
3. Create campaign (template + list + SMTP) and click `Create + Start`
4. Live SSE stream from `/send/stream` shows progress/rate/throttle
5. Track details at `/campaigns/[id]`
6. Queue observability widget is visible in `/dashboard`

## One Command Prod-like Boot + Smoke

- `pnpm boot:prodlike`

This command runs:

1. `docker compose up --build --scale worker=2`
2. `bootstrap` service (migration + optional seed via `ENABLE_SEED=true`)
3. `web` + multiple `worker` replicas
4. `smoke` service that verifies:
   - login
   - campaign create/start
   - delivery progress
   - open/click/unsubscribe tracking
   - campaign reporting metrics

## Runtime Verification

- Tracking verify (open/click/unsubscribe): `pnpm test:tracking`
- Rate/warmup/throttle runtime test: `pnpm test:rate -- <smtpId>`
- Multi-worker race/duplicate verification: `pnpm test:multi-worker`
- SMTP secret rotation dry-run: `pnpm secrets:rotate`
- SMTP secret rotation apply: `pnpm secrets:rotate:apply`
- SMTP secret verification: `pnpm secrets:verify`
- Multi-worker benchmark: `pnpm benchmark:multi-worker`

## Benchmark Output Format

`pnpm benchmark:multi-worker` prints JSON:

```json
{
  "benchmark": "multi_worker_runtime",
  "campaignId": "uuid",
  "workersAssumed": 2,
  "recipients": 200,
  "metrics": {
    "queueLagMs": {
      "avgSampled": 120,
      "maxSampled": 380
    },
    "dispatchLatencyMs": 740,
    "sendThroughputPerSecond": 22.4,
    "clickOpenWriteOverheadMsPerEvent": 4.8,
    "throttleRecoveryTimeMs": 18500
  }
}
```

## Smoke Debug Guide

When `pnpm boot:prodlike` fails, debug in this order:

1. `bootstrap` logs (migration, db push fallback, constraints, optional seed)
2. `web` health: `curl http://localhost:3000/health`
3. `worker` health: `curl http://localhost:4050/health`
4. queue + safety metrics keys in Redis:
   - `metrics:queue`
   - `metrics:worker`
   - `metrics:throughput`
   - `metrics:throttled`
   - `metrics:shared-safety`

## Large Import Notes

- Recipient bulk import artık istemci tarafında chunked/batched çalışır; tek istekte dev payload gönderilmez.
- Önerilen batch boyutu: yaklaşık `5k-20k` e-posta veya ~`200KB` payload.
- Nginx reverse proxy kullanıyorsanız yine de body limitini artırın:

```nginx
client_max_body_size 200M;
```

- Not: Bu ayar yardımcıdır; asıl koruma chunked import yaklaşımıdır.

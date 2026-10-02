# Sneaker Drop

## Run

Requirements:

- Docker + Docker Compose
- Node.js 24+

Start:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:3000
```

Check services:

```bash
docker compose ps
```

Reset development data:

```bash
curl -X POST http://localhost:3000/admin/reset
```

Check invariants:

```bash
curl http://localhost:3000/admin/invariants
```

## Tests

Build:

```bash
npm run build
```

Unit/API tests:

```bash
npm test
```

Full integration test:

```bash
npx tsx scripts/finaltest.ts
```

The final test covers concurrency, expiry, waitlist promotion, payment webhooks, duplicate/out-of-order events, failure limits, late payments, and a 5,000-request load test.

Verified result:

```text
5000 requests
20 holds
0 unexpected 5xx
0 invariant violations
```

## Architecture

- Node.js + TypeScript + Express
- PostgreSQL 16
- Docker Compose
- No ORM

### Concurrency

`POST /api/buy` uses:

- PostgreSQL transactions
- Per-user advisory locks
- `FOR UPDATE SKIP LOCKED`
- Database constraints/indexes

This prevents overselling and duplicate active holds.

### Expiry & Waitlist

Expired holds are processed by:

- lazy expiry in API flows
- a 1-second expiry worker

The first waiting user receives the released pair with a fresh hold.

### Payments

The mock payment service supports:

```text
success
fail
duplicate
out_of_order
late
random
```

Webhooks use HMAC verification and idempotent event IDs.

Late successful payments are refunded.

## Configuration

Default hold time: **5 minutes**

Default maximum purchases per user: **2**

For fast integration testing, the test environment uses a 30-second hold.

## Assumptions

- `userId` is trusted; no real authentication
- Payments are mocked
- PostgreSQL is the source of truth
- Late payments are refunded

# Flare Demo Payments API

A tiny customer-style backend used to drive real incidents into Flare.

## Run

```bash
pnpm --filter demo dev
```

Default URL: `http://localhost:4000`

Make sure the Flare API is also running on `http://localhost:8080` and that:

- `apps/api/.env` has `INGEST_API_KEY=dev-flare-ingest-key`
- `apps/demo/.env` has `FLARE_INGEST_API_KEY=dev-flare-ingest-key`

## Useful Routes

Success:

```bash
curl http://localhost:4000/api/checkout
```

Intentional failures:

```bash
curl http://localhost:4000/crash/db-pool
curl http://localhost:4000/crash/payment-timeout
curl http://localhost:4000/crash/coupon-null
curl http://localhost:4000/crash/missing-profile
curl http://localhost:4000/crash/stale-inventory
```

Realistic API routes with controlled scenarios:

```bash
curl "http://localhost:4000/api/checkout?scenario=db-pool"
curl "http://localhost:4000/api/checkout?scenario=payment-timeout"
curl "http://localhost:4000/api/customers/cus_founder?scenario=missing-profile"
curl "http://localhost:4000/api/inventory/pro_monthly?scenario=stale-inventory"
```

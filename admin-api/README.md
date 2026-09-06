# BeTrack admin-api

Small, self-contained Node/Express service that performs privileged Firebase Auth admin
operations (renaming a user's synthetic email / hard-deleting a Firebase Auth account) that the
statically-exported Next.js client cannot safely do, while keeping the `adminUsers` Firestore
collection in sync. Replaces the previous client-side rename flow, which created duplicate
accounts.

This directory is a fully independent Node project (own `package.json`) — it is not part of the
Next.js app's build and does not affect it.

## API

- `GET /health` → `200 { ok: true }`, no auth.
- `POST /admin/rename-user` — `Authorization: Bearer <Firebase ID token>`, body
  `{ oldUsername, newUsername, companyId, newPassword? }`.
- `POST /admin/delete-user` — `Authorization: Bearer <Firebase ID token>`, body
  `{ username, companyId }`.

Both POST routes require the caller to be `role: "admin"` (global) or `role: "admin_entreprise"`
for the target `companyId`. Errors are returned as
`{ ok: false, error: "<code>", message: "<French message>" }` with an appropriate HTTP status
(`400 invalid_input`, `401 unauthenticated`, `403 forbidden`, `404 not_found`, `409 conflict`,
`500 internal_error`).

## Running locally

```bash
cd admin-api
npm install
cp .env.example .env   # then fill in ALLOWED_ORIGIN and FIREBASE_SERVICE_ACCOUNT_JSON
npm run dev
```

`npm run dev` uses `tsx watch` against `src/index.ts` (loads `.env` automatically via `dotenv`, see
the top of `src/index.ts` if you need to adjust that). `npm run build` compiles to `dist/`, and
`npm start` runs the compiled output — this is what the Docker image runs.

## Deploying to Render.com

1. Push this repo (or just this directory) to a Git remote Render can access.
2. Render dashboard → New → Web Service → connect the repo.
3. Environment: **Docker**. Root directory: `admin-api`.
4. Health check path: `/health`.
5. Instance type: Free.
6. Environment variables (Render → your service → Environment):
   - `ALLOWED_ORIGIN` — the origin(s) of the deployed frontend (comma-separated if more than one).
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — the service account JSON as a single-line string (see
     `.env.example` for how to obtain/format it).
   - Render sets `PORT` itself — do not set it manually.
7. Deploy. Render builds the `Dockerfile` in this directory and runs `node dist/index.js`.
8. Point the frontend's `NEXT_PUBLIC_ADMIN_API_BASE_URL` at the resulting `https://<service>.onrender.com` URL.

Render's free tier spins the service down after inactivity — the first request after idle will be
slow (cold start); this is an acceptable tradeoff for a low-traffic admin tool.

## Migrating to Azure

The Docker image is intentionally portable: no Render-specific SDK or API is used anywhere, all
configuration is via env vars, and the service is stateless. To move to Azure Container Apps or
Azure App Service for Containers:

1. Push the same image (or let Azure build the same `Dockerfile`) to Azure Container Registry / Azure's build pipeline.
2. Set the same three env vars (`ALLOWED_ORIGIN`, `FIREBASE_SERVICE_ACCOUNT_JSON`, and let Azure
   inject its own `PORT` / `WEBSITES_PORT` per its container port conventions).
3. Configure the health check to `/health`.
4. Repoint the frontend's `NEXT_PUBLIC_ADMIN_API_BASE_URL` at the new Azure URL.

No code changes required.

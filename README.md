# RELAY Dispatch Desk

**RELAY Dispatch Desk** is an autonomous dispatch-management application for coordinating delivery jobs, rider assignments, and delivery progress. It gives dispatchers a single workspace to review operational status, compare eligible riders, manage exceptions, and trace job activity.

> **Scope note:** This is an application foundation with working job, rider, assignment, dashboard, manual-queue, and audit workflows. It is not a rider-facing mobile application, and its travel-time estimates are simulated rather than live routing data.

## 1. Project overview

Dispatch teams need to match delivery work to riders who can serve the pickup and destination zones, have enough capacity, and can meet the job deadline. A manual process makes it difficult to balance workload, track assignment responses, and explain what happened when an assignment changes or a delivery is delayed.

RELAY models that dispatch lifecycle in PostgreSQL. It checks rider eligibility, ranks eligible riders, reserves capacity when an assignment is created, tracks the job through acceptance, pickup, and delivery, and records operational events for later review.

## 2. Key features and application modules

- **Dashboard:** job and assignment KPIs, availability counts, operational alerts, trends, zone performance, and recent activity.
- **Delivery jobs:** create and edit eligible jobs, filter and search jobs, inspect job details, request recommendations, assign riders, and track the job lifecycle.
- **Riders:** review rider availability, capacity and supported zones; add and edit rider records; update availability and zone coverage.
- **Assignments:** review active and historical assignment attempts, assign a recommended rider, and reassign where allowed.
- **Manual queue:** inspect jobs requiring dispatcher attention, recalculate recommendations, review assignment history, retry with an idempotency key, or dismiss a job.
- **Audit history:** filter operational events and inspect an individual job’s lifecycle timeline.
- **Assignment timeout worker:** periodically expires unconfirmed assignments, releases reserved capacity, and returns eligible jobs to the manual queue.

All of these modules have application UI/API support; this does not imply integrations with external rider, mapping, notification, or order-management systems.

### API surface

All `/api` routes below require the shared Bearer token.

| Area | Implemented endpoints |
|---|---|
| Jobs | `GET/POST /api/jobs`; `GET/PATCH /api/jobs/:id`; `POST /api/jobs/:jobId/cancel`; `GET /api/jobs/:id/recommendations`; create/list assignments and reassignments under `/api/jobs/:jobId`; pickup, delivery, timeline, and job audit-log routes under `/api/jobs/:jobId` |
| Assignment responses | `GET /api/assignments/:assignmentId`; `POST /api/assignments/:assignmentId/accept` and `/reject` |
| Riders | `GET/POST /api/riders`; `GET /api/riders/:id`; `PATCH /api/riders/:id`, `/availability`, and `/zones` |
| Manual queue | `GET /api/manual-queue` and `/:jobId`; `POST /api/manual-queue/:jobId/retry` and `/dismiss` |
| Dashboard | `GET /api/dashboard/overview`, `/trends`, and `/zone-performance` |
| Audit history | `GET /api/audit-logs` and `/api/audit-logs/:eventId` |

`GET /` and `GET /health` are public. There is no separate zone-management endpoint; the sample seed provides zones, and the frontend reads known zones from dashboard zone-performance data.

## 3. Technology stack

| Area | Technologies |
|---|---|
| Frontend | React 18, TypeScript, Vite 6, React Router, Axios, Tailwind CSS, Recharts |
| Backend | Node.js, TypeScript, Express 5, Zod |
| Data | PostgreSQL, Prisma ORM/client 6 |
| Backend tests | Vitest |

The frontend and backend are separate npm packages, each with its own `package.json` and lockfile. There is no root-level npm workspace or root package script.

## 4. Architecture overview

```text
Browser (React SPA :5173)
  └─ Axios + shared Bearer token
       └─ Express API (:5000)
            ├─ Auth middleware and request validation
            ├─ Jobs, riders, recommendations, assignments
            ├─ Manual queue, dashboard, audit history
            ├─ Assignment-timeout worker (same API process)
            └─ Prisma → PostgreSQL
```

The frontend calls the Express API under `/api`. The backend groups routes, controllers, validation, and services by domain. Prisma models riders, zones, jobs, assignments, and job events. Lifecycle and assignment operations use database transactions and row locks to protect capacity and state changes from concurrent updates. Job events provide the persisted operational history used by the audit views and dashboard activity.

The timeout worker starts with the backend process. It runs immediately and then on a configurable interval; it is not a separate worker service.

## 5. Project folder structure

```text
relay-dispatch/
├── backend/
│   ├── prisma/
│   │   ├── migrations/          # Ordered PostgreSQL schema history
│   │   ├── schema.prisma        # Data model and enums
│   │   └── seed.ts              # Sample zones, riders, and jobs
│   ├── postman/                 # Assignment and recommendation collections
│   ├── src/
│   │   ├── config/              # Database client
│   │   ├── middleware/          # Shared dispatcher auth and errors
│   │   ├── modules/             # Domain routes/controllers/services/tests
│   │   ├── workers/             # Assignment timeout worker
│   │   ├── app.ts               # Express app and route mounting
│   │   └── server.ts            # HTTP startup and graceful shutdown
│   ├── .env.example
│   ├── package.json
│   └── package-lock.json
├── frontend/
│   ├── src/
│   │   ├── components/          # Dashboard, navigation, shared UI
│   │   ├── hooks/
│   │   ├── layouts/
│   │   ├── pages/               # Dashboard, jobs, riders, assignments, etc.
│   │   ├── services/            # API clients
│   │   └── types/
│   ├── .env.example
│   ├── package.json
│   └── package-lock.json
├── SECURITY.md
└── SECURITY_AUDIT.md
```

## 6. Prerequisites

- Node.js and npm compatible with the versions in the package lockfiles. The manifests do not pin a specific Node.js version.
- A running PostgreSQL server and a PostgreSQL role permitted to create or access the two local databases.
- `psql` if using the SQL examples below to create databases.

The repository does not specify a PostgreSQL minimum version. Use a PostgreSQL release supported by the installed Prisma version.

## 7. Installation and setup

Run commands from the `relay-dispatch` project directory unless a step says otherwise. Install each package separately:

```powershell
Set-Location backend
npm ci
Copy-Item .env.example .env
```

Edit `backend/.env` as described in [Environment configuration](#8-environment-variable-configuration). Create the databases, apply migrations, and seed sample records before starting the API:

```powershell
npx prisma migrate deploy
npx prisma db seed
```

In a second terminal, install and configure the frontend:

```powershell
Set-Location frontend
npm ci
Copy-Item .env.example .env
```

The frontend example points to the default local API URL. Change it only if the backend is configured to use a different port or host.

## 8. Environment variable configuration

### Backend: `backend/.env`

The checked-in example contains `DATABASE_URL`, `TEST_DATABASE_URL`, and `DISPATCH_API_TOKEN`. Use local values such as:

```dotenv
DATABASE_URL=postgresql://YOUR_DB_USER:YOUR_DB_PASSWORD@localhost:5432/relay_dispatch?schema=public
TEST_DATABASE_URL=postgresql://YOUR_DB_USER:YOUR_DB_PASSWORD@localhost:5432/relay_dispatch_test?schema=public
DISPATCH_API_TOKEN=REPLACE_WITH_A_NEW_RANDOM_TOKEN
```

Replace the username and password with credentials for your local PostgreSQL role. URL-encode characters that have special meaning in a connection URL.

Generate a fresh dispatcher token in PowerShell with Node.js:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Copy the output into `DISPATCH_API_TOKEN` in `backend/.env`. The backend requires a configured token of at least 32 UTF-8 bytes and fails closed if it is missing or too short. **The current checked-in `backend/.env.example` has a token-looking value rather than a safe placeholder. Do not reuse or publish that value; replace it with a newly generated token.**

Optional backend settings supported by the server/worker code:

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `5000` | HTTP API port |
| `TIMEOUT_CHECK_INTERVAL_SECONDS` | `30` | Positive interval between assignment-timeout checks |

These optional settings are not listed in `backend/.env.example`. If you change `PORT`, also update the frontend API base URL.

### Frontend: `frontend/.env`

The frontend example defines:

```dotenv
VITE_API_BASE_URL=http://localhost:5000/api
```

Do not put the dispatcher token in a `VITE_*` variable. The token is entered at the sign-in screen and is held in the current browser session.

## 9. PostgreSQL databases and migrations

Create separate development and test databases. For example, connect to your local PostgreSQL server as a role with database-creation permission:

```powershell
psql -U YOUR_POSTGRES_ROLE -h localhost -p 5432 -d postgres
```

At the `psql` prompt, run:

```sql
CREATE DATABASE relay_dispatch;
CREATE DATABASE relay_dispatch_test;
\q
```

With `backend/.env` configured and the current directory set to `backend`, apply the checked-in migrations to the development database:

```powershell
npx prisma migrate deploy
```

The migration history currently contains:

1. `20261118173155_init` — initial jobs, riders, zones, assignments, and event tables.
2. `20261119040500_assignment_reassignment` — reassignment and assignment idempotency fields.
3. `20261119102500_assignment_cancellation` — cancelled assignment status.
4. `20261120120000_manual_queue_retry_idempotency` — idempotent manual-queue retry events.

These are committed migrations; use `migrate deploy` to apply them. Do not use the test database for application data.

## 10. Sample data seeding

From `backend`, with `DATABASE_URL` pointing to `relay_dispatch`, run:

```powershell
npx prisma db seed
```

The seed creates or reuses five Chennai zones, five sample riders with zone coverage, and five jobs with different priorities and statuses. It uses upserts that leave existing matching records unchanged; rerunning the seed does not reset modified sample data or clear other records. The seed also creates a `JOB_CREATED` event for each newly created sample job.

## 11. Start the backend and frontend

Start services in this order:

1. Start PostgreSQL.
2. Apply migrations and seed the development database as above.
3. Start the backend API in a terminal from `backend`:

   ```powershell
   npm run dev
   ```

   The API listens on `http://localhost:5000` by default. The public health endpoint is `http://localhost:5000/health`.

4. Start the frontend in a separate terminal from `frontend`:

   ```powershell
   npm run dev
   ```

   Vite uses its default development port, `http://localhost:5173`.

The API also exposes a public `/` status response. All routes under `/api` require dispatcher authentication.

## 12. Authentication and dispatcher access

There are no built-in username/password credentials. Authentication uses one shared `DISPATCH_API_TOKEN`:

1. Generate a fresh token and configure it in `backend/.env`.
2. Restart the backend so it loads that value.
3. Open `http://localhost:5173` and enter the same token at **Dispatcher sign in**.

The frontend verifies the token against the dashboard API, stores it in `sessionStorage` for the current browser session, and sends it on API calls as `Authorization: Bearer <token>`. Sign out or close the browser session to remove the stored token. Missing/invalid tokens receive HTTP 401; an absent or undersized server token causes HTTP 503. `/` and `/health` are public; every `/api` endpoint is protected.

This is shared dispatcher authentication, not individual identity or role-based access control. The accept/reject actions are performed through the authenticated dispatcher application; there is no separate rider login or rider app in this repository.

## 13. Testing and build commands

Run backend tests from `backend`:

```powershell
npm test
```

This runs `vitest run src`, covering the backend unit and integration test files. The dashboard API integration test is enabled when `TEST_DATABASE_URL` is set. It requires the database name to be exactly `relay_dispatch_test`, the migrated schema to be present, and the database to be empty at the start; it checks those conditions before creating test data and cleans up its own records. Do not point it at the development database or seed the test database.

To migrate the test database, temporarily set `DATABASE_URL` to the test connection URL in the `backend` PowerShell session, then deploy migrations:

```powershell
$env:DATABASE_URL = "postgresql://YOUR_DB_USER:YOUR_DB_PASSWORD@localhost:5432/relay_dispatch_test?schema=public"
npx prisma migrate deploy
Remove-Item Env:DATABASE_URL
```

The test runner reads `TEST_DATABASE_URL` from `backend/.env`; keep that variable pointed at the same `relay_dispatch_test` database.

Build the backend TypeScript:

```powershell
npm run build
```

After building, run its production entry point with `npm start` (the package script is `node dist/server.js`).

Build the frontend:

```powershell
npm run build
```

This runs TypeScript checking followed by `vite build`. `npm run preview` is also available to preview the built frontend locally. No frontend test script is defined in `frontend/package.json`.

## 14. End-to-end demo scenario

The following path uses the dispatcher UI and seeded local data:

1. **Create Job:** Sign in, open **Delivery Jobs**, create a job with a unique order reference, pickup zone **Chennai Central**, delivery zone **Guindy**, capacity `1`, and a priority. The seed includes riders covering both zones.
2. **Generate Recommendations:** Open the new job and select **Find rider & assign**. Review eligible riders and their scores; choose a recommended rider.
3. **Assign Rider:** Confirm the selection. The job enters **Awaiting confirmation**, and the rider’s required capacity is reserved.
4. **Accept Assignment:** In the job details, select **Accept assignment**. This dispatcher action simulates the rider response; it does not contact a rider device.
5. **Pick Up:** Select **Mark picked up**.
6. **Deliver:** Select **Mark delivered**. The assignment is completed and reserved capacity is released.
7. **Verify Dashboard and Audit Trail:** Refresh **Dashboard** to see the updated status and recent activity. Open **Audit History**, search for the order reference, and inspect its timeline for creation, assignment, acceptance, pickup, and delivery events.

Complete the accept, pickup, and delivery steps promptly: pending assignments have a five-minute confirmation window and may be expired by the running timeout worker.

## 15. Business rules and important design decisions

- Rider recommendations exclude unavailable riders, riders without coverage for both job zones, riders lacking remaining capacity, and riders already actively assigned to that job.
- Eligible riders are ranked using workload, simulated travel time, capacity fit, and deadline fit. Priority changes the scoring weights. These scores are recommendations, not guaranteed ETAs.
- Simulated travel-time inputs are hard-coded for the sample Chennai zones and known sample rider names; unknown routes use a fallback estimate.
- Assignments reserve capacity and start as pending. The configured confirmation window is five minutes. Expiry releases capacity; if no valid active assignment remains, the job is routed to the manual queue.
- A job can be picked up only after an accepted assignment. It can be delivered only after pickup. Delivery completes the assignment and releases its capacity reservation.
- Selecting a rider below the top recommendation requires an override reason. Replacing an accepted assignment requires a reassignment reason.
- Assignment creation and manual-queue retries support idempotency keys. Job lifecycle changes and important dispatch actions are recorded as job events.
- The shared token is intentionally simple for a local/demo dispatch desk; it does not identify which dispatcher performed an action.

## 16. Assumptions, limitations, and future improvements

### Current limitations

- Authentication is one shared bearer token. There are no dispatcher accounts, roles, or per-user audit attribution.
- The frontend stores the token in browser `sessionStorage`; an XSS issue could expose it. Use HTTPS and rotate the token if compromised when operating beyond local development.
- Travel-time estimation is simulated and sample-oriented. There is no live maps, routing, geocoding, or GPS integration.
- Assignment acceptance/rejection is represented by dispatcher-side actions, not a rider workflow or push notification.
- The repository provides local development and build scripts, but no verified deployment configuration or hosting workflow.
- Sample data is intentionally small. Seeding does not reset an existing database.

### Potential next steps (not implemented)

- Add individual dispatcher accounts, role-based permissions, and per-user audit attribution.
- Add a rider-facing app/API workflow with notifications and real acceptance responses.
- Integrate a mapping provider for route distance, live ETAs, and richer zone management.
- Add production deployment/CI configuration, operational monitoring, and production-grade secret management.

## Inspected files and setup gaps

The README was written against both package manifests and lockfiles; both `.env.example` files; the Prisma schema, Prisma config, seed script, and all four migrations; backend server/app/auth middleware; domain routes and core recommendation, assignment, lifecycle, timeout, dashboard, rider, manual-queue, and audit services; frontend routes/pages, login, API client and services; test files; and the existing security documentation.

The repository does not pin a minimum Node.js or PostgreSQL version, does not define root-level install/start scripts, and does not provide a zone-management API (the seed supplies sample zones). The checked-in backend environment example’s token field is not a safe placeholder and must be replaced locally. Those are the setup/documentation limitations that prevent a completely version-pinned, credential-ready fresh-clone setup; all required local commands and configuration names otherwise come from the repository.

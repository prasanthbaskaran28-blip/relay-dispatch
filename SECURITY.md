# Local dispatcher authentication

The backend requires `DISPATCH_API_TOKEN` to be set to a random value of at
least 32 bytes. Copy `backend/.env.example` to `backend/.env`, set the database
URLs for your environment, then generate a token in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Set the generated value as `DISPATCH_API_TOKEN` in `backend/.env` and restart
the API. Open the frontend and enter the same token at the sign-in prompt. The
frontend keeps it in the current browser session and sends it as a Bearer token;
do not place the token in a `VITE_*` variable or commit it.

All `/api` endpoints require authentication. `/` and `/health` remain public.
Database integration tests must use `TEST_DATABASE_URL` pointing to
`relay_dispatch_test`; tests verify the connected database name before making
changes.

# MaplePro — construction decision intelligence

A small, runnable hackathon MVP for a construction command center. It starts with seeded data, calculates transparent risk signals and trend-based forecasts, uses Gemini Flash to explain evidence when configured, and supports a PayPal Invoicing v2 payment workflow.

## What is implemented

- **Landing page, login, and application shell** using HTML, CSS, and vanilla JavaScript. Inter is the primary font. Responsive layout and light/dark themes are included.
- **Four demo personas**: administrator, project manager, client, and subcontractor. The sample accounts have role-specific project/invoice scopes.
- **Prepopulated demo workspace**: after the Supabase schema is installed, MaplePro automatically inserts any missing demo records before the first demo login. The workspace includes 8 construction projects, 48 monthly snapshots, 32 milestones, 32 invoices, and four demo personas. Seeding is safe to rerun and preserves existing project and invoice records.
- **Deterministic risk index**: overdue receivables, projected final-cost variance, progress-versus-plan, schedule projection, and near-term milestones.
- **Trend-based forecasts**: project cost-at-completion and finish-date estimate using the seeded snapshot series. These are prototype estimates, not a trained or calibrated production prediction model.
- **Gemini Flash narrative generation**: optional server-side call using `GEMINI_API_KEY` and a configurable model. If the key is absent or the API call fails, MaplePro clearly falls back to deterministic insights and does not pretend generated AI text was returned.
- **PayPal capabilities**: create and send a PayPal Invoicing v2 invoice, send reminders for invoices that have a PayPal invoice ID, return the payer URL, and synchronize eligible invoice-paid events after server-side webhook verification.
- **Supabase integration**: Supabase is the only database. The FastAPI backend uses the Supabase Data API through the existing `SUPABASE_URL` and API key; it does not require a PostgreSQL connection string or SQLAlchemy. Supabase Auth provides email/password sign-in when demo mode is disabled, and `supabase/schema.sql` defines the tables and row-level security policies.
- **Tests** for the risk-engine calculation basics.

## Run locally

Requires Python 3.11 or later.

```bash
cd maplepro
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

MaplePro uses the Supabase Data API in every environment. There is no local database, direct PostgreSQL connection string, or ORM. Startup does not create tables. Before starting the app:

1. Create a Supabase project and apply `supabase/schema.sql` in the Supabase SQL Editor.
2. Set `SUPABASE_URL` and a server-side Supabase API key with read/write access to the demo tables. The backend checks `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_API_KEY`, `SUPABASE_KEY`, and then `SUPABASE_ANON_KEY` in that priority order. A public anon/publishable key alone cannot seed rows under the included RLS policies. Never expose a secret/service-role key to the browser.
3. Start FastAPI. With `DEMO_MODE=true`, MaplePro automatically inserts any missing demo records. To manually repair the workspace, run `python scripts/seed_demo.py`.

```bash
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000`. The landing page links to the login page; the application is served at `/app`. API documentation is at `http://127.0.0.1:8000/docs`.

When `DEMO_MODE=true`, MaplePro automatically prepares the demo workspace on application startup and again on the first login or demo-token request when needed. The seed routine is idempotent: it inserts missing records, repairs missing profiles, and leaves existing project, invoice, milestone, and snapshot records untouched. You can still run `python scripts/seed_demo.py` manually to repair or verify the data. `DEMO_MODE=true` controls only the demo login flow; it does not change the database backend.

### Demo accounts

All demo accounts use the password `MaplePro2026!`.

| Role | Email | Intended evaluation path |
|---|---|---|
| Administrator | `admin@maplepro.demo` | Firm overview and access model |
| Project manager | `manager@maplepro.demo` | Portfolio risks, invoice reminder, new invoice |
| Client | `client@maplepro.demo` | Assigned project visibility and client invoice state |
| Subcontractor | `subcontractor@maplepro.demo` | Assigned projects and subcontractor invoice status |

The demo login accepts only these seeded email identities, and only while `DEMO_MODE=true`. It uses a deliberately simple demo token and must not be deployed as a production authentication mechanism.

## Deploy to Vercel

The `pyproject.toml` declares the runtime dependencies (including `httpx`, which talks to the Supabase Data API) and configures Vercel's FastAPI entry point as `app.main:app`. Keep the Vercel project Root Directory set to this `maplepro` project folder so both `pyproject.toml` and `requirements.txt` are included in the build.

`pyproject.toml` explicitly configures Vercel's FastAPI entry point as `app.main:app` because the application lives at `app/main.py`. The root-level `vercel.json` allows up to 60 seconds per request (subject to your Vercel plan limits) and explicitly bundles the HTML, CSS, and JavaScript files in `app/static/`. No catch-all rewrite is needed. The optional `$schema` property is omitted from `vercel.json`; that property is only for editor autocomplete/validation and is not a deployment URL.

1. Push the contents of this `maplepro` directory to a Git repository and import that repository into Vercel. If the repository contains this project in a subdirectory, set Vercel's **Root Directory** to that subdirectory.
2. Ensure `SUPABASE_URL` and the existing Supabase API key are configured in Vercel. The backend calls the Supabase Data API directly; no `DATABASE_URL` is used. For demo data under the included RLS policies, the server-side API key must have the required table permissions. If the key you already configured is a public anon/publishable key, use the project's existing server-side secret/service-role key for backend data access and keep it secret.
3. For the intended connected demo, also configure `GEMINI_API_KEY`, `GEMINI_MODEL`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL`, and `PAYPAL_WEBHOOK_ID` as applicable. Set `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com` while testing the sandbox. Never put secret values in `vercel.json` or frontend code.
4. For a private/production deployment, set `DEMO_MODE=false` and configure Supabase Auth users plus matching profile rows as described below. `DEMO_MODE=true` enables simple demo-token login and is only suitable for a deliberately public hackathon demo with synthetic data; do not treat it as production authentication.
5. Deploy from Vercel, then test `/`, `/login`, `/app`, `/api/health`, and `/docs`. Configure the PayPal webhook to point to `https://YOUR_DEPLOYMENT/api/webhooks/paypal` and verify its delivery in PayPal's developer dashboard.

Vercel's FastAPI deployment guidance: https://vercel.com/docs/frameworks/backend/fastapi. Environment variables must be set in the Vercel project settings or CLI rather than committed to source control.

## Configure Gemini Flash

1. Create a Gemini API key in Google AI Studio.
2. Put the key in `.env`; never add it to frontend JavaScript or commit it.
3. Leave `GEMINI_MODEL=gemini-3.8-flash` unless your account needs a different supported Flash model.
4. Restart FastAPI and open **MaplePro Intelligence → Refresh insights**.

The Python risk engine owns the numbers. Gemini receives the computed metrics and may return explanation/recommendation fields; the app restricts generated insight IDs to projects visible to the signed-in user. If model configuration or quota fails, the dashboard stays available with rule-based insights.

## Configure PayPal

1. Create a REST app in the PayPal Developer Dashboard under **Sandbox** and copy its Client ID and Secret.
2. Add these values in `.env`:

   ```dotenv
   PAYPAL_CLIENT_ID=your-sandbox-client-id
   PAYPAL_CLIENT_SECRET=your-sandbox-secret
   PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
   ```

3. Restart FastAPI. In **Invoices & payments**, create a new invoice. When credentials are configured, the server gets an OAuth access token, creates a PayPal invoice, sends it, fetches its metadata, and stores the PayPal invoice ID and payer URL.
4. Test using a PayPal buyer account and the payer URL returned for that invoice.
5. For payment status synchronization, expose the app through a public HTTPS tunnel or deployed URL, register `POST https://YOUR_HOST/api/webhooks/paypal` as the webhook URL for the same PayPal REST app, subscribe to the PayPal Invoicing v2 invoice-paid event (`INVOICING.INVOICE.PAID`), and set its webhook ID in `.env`:

   ```dotenv
   PAYPAL_WEBHOOK_ID=your-webhook-id
   ```

6. Restart the API and test an actual sandbox invoice payment. The webhook route calls PayPal's `verify-webhook-signature` endpoint before accepting a status change and records event IDs to avoid duplicate processing.

The PayPal integration is **credential-gated**. It cannot be end-to-end validated without your Sandbox app credentials and a publicly reachable HTTPS webhook URL. Seeded invoices do not have PayPal invoice IDs, so only invoices created through the connected PayPal workflow support real PayPal reminders or a returned payer URL.

In demo mode, the **Simulate** action marks a local invoice record as paid solely for demonstrating the UI reaction. It does not call PayPal and does not represent a payment transaction. Keep that distinction in a judge demo.

## Configure Supabase

Supabase is required for both local development and Vercel. To configure data and authentication:

1. Create a Supabase project and run `supabase/schema.sql` in the SQL Editor. The schema must be applied before starting the app; MaplePro initializes data but does not create tables or run migrations.
2. Set `SUPABASE_URL` and the existing Supabase API key in `.env` or Vercel. The app uses Supabase table endpoints for reads/writes and never expects `DATABASE_URL`. The server data key must be able to access the tables under the included RLS policies; a public anon key alone will not have access to the demo rows.
3. With `DEMO_MODE=true`, MaplePro inserts any missing demo firm, personas, projects, snapshots, milestones, and invoices automatically during startup or before the first demo login. You can run `python scripts/seed_demo.py` manually if you need to repair the dataset; it does not reset existing project data.
4. For Supabase Auth (when `DEMO_MODE=false`), create users in Supabase Auth and set each corresponding `public.profiles.auth_user_id` to that user's UUID. Keep the profile's `firm_id`, `role`, and email aligned with the user and intended access. The synthetic seed profiles have no linked Supabase Auth IDs and must be linked or replaced for real Supabase Auth sign-in.
5. Never expose a service-role/secret API key to the browser. For Supabase Auth, set `DEMO_MODE=false` and configure `SUPABASE_URL` plus the public `SUPABASE_ANON_KEY`.

FastAPI verifies Supabase access tokens through Supabase Auth and resolves the authorized `profiles` row before querying data. The API explicitly scopes data by firm and role. Supabase RLS remains enabled for direct client access; server-side keys that bypass RLS must never be sent to the browser, and the FastAPI role/tenant filters are required for backend requests.

## Fixing missing demo profiles

If a demo account fails with a message saying MaplePro cannot read its profile, the `SELECT` query used to check profiles does not create them. First confirm that the query returns all four expected emails. If it does, make sure Vercel's `SUPABASE_URL` points to that exact Supabase project and that the backend uses a server-side `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`; a public anon/publishable key can return no profile rows under the included RLS policies. Update the Vercel environment variables and redeploy after changing them.

If profiles are missing, run `supabase/repair_demo_profiles.sql` in that project's Supabase SQL Editor. It inserts or repairs the four demo profiles without deleting project or invoice data. The CLI seed script `python scripts/seed_demo.py` is also safe to rerun: it now repairs missing profiles and inserts missing related records even when `firm-northline` already exists. Use a server-side key with the required permissions when running it.

## Demo workflow

A concise evaluation path:

1. Ensure `supabase/schema.sql` has been applied. MaplePro prepares missing demo records automatically when the app starts or the first demo login is attempted.
2. Sign in as `manager@maplepro.demo`.
3. Start at **Command center** and inspect the overdue receivable and schedule/cost signals.
4. Open **MaplePro Intelligence**. The unconfigured local app shows rule-based explanations; add a Gemini API key to demonstrate model-generated explanations.
5. Open **Invoices & payments**, create a new invoice, then send a reminder on a seeded overdue invoice. When PayPal credentials are not configured, these actions are clearly recorded as demo-only actions.
6. To test the real payment path, configure PayPal and create a *new* invoice so it has a PayPal invoice ID and payer link. Complete the payment using the Sandbox buyer and verify the webhook updates the invoice status.
7. Sign out and enter through the Client or Subcontractor demo to inspect role-scoped project and invoice views.

## Main API routes

| Route | Purpose |
|---|---|
| `GET /api/config` | Public feature/configuration status; never returns secrets |
| `POST /api/auth/login` | Seeded demo login when `DEMO_MODE=true` |
| `GET /api/dashboard` | Role-scoped projects, invoices, metrics, milestones, and rule insights |
| `GET /api/search?q=...` | Search accessible project and invoice records |
| `GET /api/intelligence` | Deterministic rule-based insights |
| `POST /api/intelligence/refresh` | Gemini-assisted narrative with rule-based fallback |
| `POST /api/invoices` | Create/send a PayPal invoice when configured; otherwise add local demo invoice |
| `POST /api/invoices/{id}/remind` | PayPal reminder for a connected external invoice or explicitly local demo record |
| `POST /api/invoices/{id}/simulate-payment` | Demo-mode-only local payment state simulation |
| `POST /api/webhooks/paypal` | Verify webhook with PayPal before updating a matching invoice |
| `GET /api/health` | App/integration readiness check |

## Tests

```bash
pytest -q
python -m compileall app tests
```

## Important prototype boundaries

- Risk score is an interpretable index, not a probability that a project will fail.
- Seeded snapshots are synthetic. Forecasts are trend extrapolations, not ML trained on actual construction histories.
- Gemini produces narrative recommendations only; financial math and rule thresholds remain in Python.
- A local simulated payment is not a PayPal transaction.
- PayPal API, webhook, and Supabase sign-in flows require actual credentials and external configuration before they can be validated end-to-end.
- This scaffold includes tenant scoping and RLS policies, but production deployment still requires a security review, HTTPS, secure secret management, audit logging, and tests for cross-tenant access.

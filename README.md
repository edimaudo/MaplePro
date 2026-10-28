# MaplePro — construction decision intelligence

A small, runnable hackathon MVP for a construction command center. It starts with seeded data, calculates transparent risk signals and trend-based forecasts, uses Gemini Flash to explain evidence when configured, and supports a PayPal Invoicing v2 sandbox workflow.

## What is implemented

- **Landing page, login, and application shell** using HTML, CSS, and vanilla JavaScript. Inter is the primary font. Responsive layout and light/dark themes are included.
- **Four demo personas**: administrator, project manager, client, and subcontractor. The sample accounts have role-specific project/invoice scopes.
- **Explicitly seeded Supabase data**: 8 construction projects, monthly synthetic snapshots, milestones, client invoices, subcontractor invoice records, and four demo personas. Run the seed script after applying the schema.
- **Deterministic risk index**: overdue receivables, projected final-cost variance, progress-versus-plan, schedule projection, and near-term milestones.
- **Trend-based forecasts**: project cost-at-completion and finish-date estimate using the seeded snapshot series. These are prototype estimates, not a trained or calibrated production prediction model.
- **Gemini Flash narrative generation**: optional server-side call using `GEMINI_API_KEY` and a configurable model. If the key is absent or the API call fails, MaplePro clearly falls back to deterministic insights and does not pretend generated AI text was returned.
- **PayPal capabilities**: create and send a PayPal Invoicing v2 invoice, send reminders for invoices that have a PayPal invoice ID, return the payer URL, and synchronize eligible invoice-paid events after server-side webhook verification.
- **Supabase integration**: Supabase PostgreSQL is the only supported database; Supabase Auth provides email/password sign-in when demo mode is disabled, and `supabase/schema.sql` defines the tables and row-level security policies.
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

MaplePro **always uses Supabase PostgreSQL**, including during local development. There is no local database fallback and startup does not create tables. Before starting the app:

1. Create a Supabase project and apply `supabase/schema.sql` in the Supabase SQL Editor.
2. Set `DATABASE_URL` in `.env` to that project's PostgreSQL connection string, with SSL enabled.
3. Seed the synthetic demo records and then start FastAPI:

```bash
python scripts/seed_demo.py
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000`. The landing page links to the login page; the application is served at `/app`. API documentation is at `http://127.0.0.1:8000/docs`.

The seed script inserts the synthetic firm, four demo personas, projects, historical snapshots, milestones, and invoices when the firm has not already been seeded. It does not reset an existing database. `DEMO_MODE=true` controls only the demo login flow; it does not change the database backend.

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

The `pyproject.toml` explicitly declares the runtime dependencies (including `httpx`) and configures Vercel's FastAPI entry point as `app.main:app`. Keep the Vercel project Root Directory set to this `maplepro` project folder so both `pyproject.toml` and `requirements.txt` are included in the build.

`pyproject.toml` explicitly configures Vercel's FastAPI entry point as `app.main:app` because the application lives at `app/main.py`. The root-level `vercel.json` allows up to 60 seconds per request (subject to your Vercel plan limits) and explicitly bundles the HTML, CSS, and JavaScript files in `app/static/`. No catch-all rewrite is needed. The optional `$schema` property is omitted from `vercel.json`; that property is only for editor autocomplete/validation and is not a deployment URL.

1. Push the contents of this `maplepro` directory to a Git repository and import that repository into Vercel. If the repository contains this project in a subdirectory, set Vercel's **Root Directory** to that subdirectory.
2. Add the project's Supabase PostgreSQL connection string as `DATABASE_URL` in Vercel's **Project → Settings → Environment Variables**. `DATABASE_URL` is required; the application fails fast if it is missing, invalid, or points to a different database engine.
3. Add the environment variables needed for the deployment. At minimum, configure `DATABASE_URL`. For the intended connected demo, also configure `GEMINI_API_KEY`, `GEMINI_MODEL`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL`, `PAYPAL_WEBHOOK_ID`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` as applicable. Set `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com` while testing the sandbox. Never put secret values in `vercel.json` or frontend code.
4. For a private/production deployment, set `DEMO_MODE=false` and configure Supabase Auth users plus matching profile rows as described below. `DEMO_MODE=true` enables simple demo-token login and is only suitable for a deliberately public hackathon demo with synthetic data; do not treat it as production authentication.
5. Deploy from Vercel, then test `/`, `/login`, `/app`, `/api/health`, and `/docs`. Configure the PayPal webhook to point to `https://YOUR_DEPLOYMENT/api/webhooks/paypal` and verify its delivery in PayPal's developer dashboard.

Vercel's FastAPI deployment guidance: https://vercel.com/docs/frameworks/backend/fastapi. Environment variables must be set in the Vercel project settings or CLI rather than committed to source control.

## Configure Gemini Flash

1. Create a Gemini API key in Google AI Studio.
2. Put the key in `.env`; never add it to frontend JavaScript or commit it.
3. Leave `GEMINI_MODEL=gemini-3.8-flash` unless your account needs a different supported Flash model.
4. Restart FastAPI and open **AI intelligence → Generate with Gemini Flash**.

The Python risk engine owns the numbers. Gemini receives the computed metrics and may return explanation/recommendation fields; the app restricts generated insight IDs to projects visible to the signed-in user. If model configuration or quota fails, the dashboard stays available with rule-based insights.

## Configure PayPal Sandbox

1. Create a REST app in the PayPal Developer Dashboard under **Sandbox** and copy its Client ID and Secret.
2. Add these values in `.env`:

   ```dotenv
   PAYPAL_CLIENT_ID=your-sandbox-client-id
   PAYPAL_CLIENT_SECRET=your-sandbox-secret
   PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
   ```

3. Restart FastAPI. In **Invoices & payments**, create a new invoice. When credentials are configured, the server gets an OAuth access token, creates a PayPal invoice, sends it, fetches its metadata, and stores the PayPal invoice ID and payer URL.
4. Test using a PayPal Sandbox buyer account and the payer URL returned for that invoice.
5. For payment status synchronization, expose the app through a public HTTPS tunnel or deployed URL, register `POST https://YOUR_HOST/api/webhooks/paypal` as the webhook URL for the same PayPal REST app, subscribe to the PayPal Invoicing v2 invoice-paid event (`INVOICING.INVOICE.PAID`), and set its webhook ID in `.env`:

   ```dotenv
   PAYPAL_WEBHOOK_ID=your-webhook-id
   ```

6. Restart the API and test an actual sandbox invoice payment. The webhook route calls PayPal's `verify-webhook-signature` endpoint before accepting a status change and records event IDs to avoid duplicate processing.

The PayPal integration is **credential-gated**. It cannot be end-to-end validated without your Sandbox app credentials and a publicly reachable HTTPS webhook URL. Seeded invoices do not have PayPal invoice IDs, so only invoices created through the connected PayPal workflow support real PayPal reminders or a returned payer URL.

In demo mode, the **Simulate** action marks a local invoice record as paid solely for demonstrating the UI reaction. It does not call PayPal and does not represent a payment transaction. Keep that distinction in a judge demo.

## Configure Supabase

Supabase PostgreSQL is required for both local development and Vercel. To configure the database and authentication:

1. Create a Supabase project and run `supabase/schema.sql` in the SQL Editor. This schema must be applied before starting the app; the application does not run migrations or create tables on startup.
2. Set `DATABASE_URL` to the Supabase PostgreSQL connection string from Project Settings → Database. Use a connection string with SSL enabled, and use the Supabase pooler where appropriate for serverless workloads.
3. Run `python scripts/seed_demo.py` from this project with `.env` configured to populate the synthetic demo firm, four demo personas, projects, snapshots, milestones, and invoices. Existing seed data is not reset.
4. For Supabase Auth (when `DEMO_MODE=false`), create users in Supabase Auth and set each corresponding `public.profiles.auth_user_id` to that user's UUID. Keep the profile's `firm_id`, `role`, and email aligned with the user and intended access. The synthetic seed profiles have no linked Supabase Auth IDs and must be linked or replaced for real Supabase Auth sign-in.
5. Store the PostgreSQL connection string only in the backend environment. Do not expose database credentials or any service-role/secret API key to the browser. For Supabase Auth, set `DEMO_MODE=false` together with `SUPABASE_URL` and `SUPABASE_ANON_KEY` as shown above.

FastAPI verifies Supabase access tokens through Supabase Auth and resolves the authorized `profiles` row before querying data. The API explicitly scopes database access by firm and role. The SQL file also enables RLS for direct Supabase API access. The backend uses a server-side PostgreSQL connection, so application-level tenant filters remain a required authorization boundary; policies evaluated under the Supabase browser JWT do not automatically constrain a separate privileged database connection.

## Demo workflow

A concise evaluation path:

1. Ensure `supabase/schema.sql` has been applied and `python scripts/seed_demo.py` has completed against the configured Supabase database.
2. Sign in as `manager@maplepro.demo`.
3. Start at **Command center** and inspect the overdue receivable and schedule/cost signals.
4. Open **AI intelligence**. The unconfigured local app shows rule-based explanations; add a Gemini API key to demonstrate model-generated explanations.
5. Open **Invoices & payments**, create a new invoice, then send a reminder on a seeded overdue invoice. When PayPal Sandbox credentials are not configured, these actions are clearly recorded as demo-only actions.
6. To test the real payment path, configure PayPal Sandbox and create a *new* invoice so it has a PayPal invoice ID and payer link. Complete the payment using the Sandbox buyer and verify the webhook updates the invoice status.
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

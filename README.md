# MaplePro — construction decision intelligence

A small, runnable hackathon MVP for a construction command center. It starts with seeded data, calculates transparent risk signals and trend-based forecasts, uses Gemini Flash to explain evidence when configured, and supports a PayPal Invoicing v2 sandbox workflow.

## What is implemented

- **Landing page, login, and application shell** using HTML, CSS, and vanilla JavaScript. Inter is the primary font. Responsive layout and light/dark themes are included.
- **Four demo personas**: administrator, project manager, client, and subcontractor. The sample accounts have role-specific project/invoice scopes.
- **Seeded data at first start**: 8 construction projects, monthly synthetic snapshots, milestones, client invoices, subcontractor invoice records, and users.
- **Deterministic risk index**: overdue receivables, projected final-cost variance, progress-versus-plan, schedule projection, and near-term milestones.
- **Trend-based forecasts**: project cost-at-completion and finish-date estimate using the seeded snapshot series. These are prototype estimates, not a trained or calibrated production prediction model.
- **Gemini Flash narrative generation**: optional server-side call using `GEMINI_API_KEY` and a configurable model. If the key is absent or the API call fails, MaplePro clearly falls back to deterministic insights and does not pretend generated AI text was returned.
- **PayPal capabilities**: create and send a PayPal Invoicing v2 invoice, send reminders for invoices that have a PayPal invoice ID, return the payer URL, and synchronize eligible invoice-paid events after server-side webhook verification.
- **Supabase integration scaffold**: email/password sign-in via Supabase Auth, profile-to-firm mapping, a PostgreSQL database URL, and row-level security policies in `supabase/schema.sql`.
- **Tests** for the risk-engine calculation basics.

## Run locally

Requires Python 3.11 or later.

```bash
cd maplepro
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000`. The landing page links to the login page; the application is served at `/app`. API documentation is at `http://127.0.0.1:8000/docs`.

The default `.env.example` enables local demo mode and uses SQLite, so the app can run without third-party credentials. The first app start creates `maplepro.db` and seeds the dataset. Existing databases are not reseeded or reset on restart.

### Demo accounts

All demo accounts use the password `MaplePro2026!`.

| Role | Email | Intended evaluation path |
|---|---|---|
| Administrator | `admin@maplepro.demo` | Firm overview and access model |
| Project manager | `manager@maplepro.demo` | Portfolio risks, invoice reminder, new invoice |
| Client | `client@maplepro.demo` | Assigned project visibility and client invoice state |
| Subcontractor | `subcontractor@maplepro.demo` | Assigned projects and subcontractor invoice status |

The demo login accepts only these seeded email identities, and only while `DEMO_MODE=true`. It uses a deliberately simple demo token and must not be deployed as a production authentication mechanism.

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

The local project defaults to SQLite and demo authentication. To switch to Supabase:

1. Create a Supabase project and run `supabase/schema.sql` in the SQL Editor.
2. Create users in Supabase Auth. Add one matching `public.profiles` row per user, setting `auth_user_id` to the Auth user's UUID string, `firm_id` to the appropriate firm ID, and `role` to one of `admin`, `project_manager`, `client`, or `subcontractor`. The profile email must match the Auth user's email because client/subcontractor project scope uses that email.
3. Ensure the target firm exists. If starting an empty project, add a firm record and insert the project/invoice/milestone/snapshot data needed by the application. `scripts/seed_demo.py` seeds synthetic records into the configured database, but it also creates demo profile rows with no linked Supabase Auth IDs; link or replace those profiles before production evaluation.
4. Set the environment:

   ```dotenv
   DEMO_MODE=false
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_ANON_KEY=your-supabase-publishable-or-anon-key
   DATABASE_URL=postgresql+psycopg://...your-supabase-postgres-connection-string...
   ```

5. Use a server-side database connection string and store it only in the backend environment. Do not expose database credentials or any service-role/secret API key to the browser.

FastAPI verifies Supabase access tokens through Supabase Auth and resolves the authorized `profiles` row before querying data. The API explicitly scopes database access by firm and role. The SQL file also enables RLS for direct Supabase API access. If you change the role model or query patterns, update and test those policies accordingly. The current FastAPI backend uses a trusted server-side PostgreSQL connection, so application-level tenant filters remain a required authorization boundary; RLS does not automatically constrain a privileged database connection.

## Demo workflow

A concise evaluation path:

1. Sign in as `manager@maplepro.demo`.
2. Start at **Command center** and inspect the overdue receivable and schedule/cost signals.
3. Open **AI intelligence**. The unconfigured local app shows rule-based explanations; add a Gemini API key to demonstrate model-generated explanations.
4. Open **Invoices & payments**, create a new invoice, then send a reminder on a seeded overdue invoice. In local mode, both are explicitly recorded as demo actions.
5. To test the real payment path, configure PayPal Sandbox and create a *new* invoice so it has a PayPal invoice ID and payer link. Complete the payment using the Sandbox buyer and verify the webhook updates the invoice status.
6. Sign out and enter through the Client or Subcontractor demo to inspect role-scoped project and invoice views.

## Main API routes

| Route | Purpose |
|---|---|
| `GET /api/config` | Public feature/configuration status; never returns secrets |
| `POST /api/auth/login` | Local demo login only |
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

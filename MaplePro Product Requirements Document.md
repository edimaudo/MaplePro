# MaplePro: Product Requirements Document

*PayPal AI Hackathon, Idea 2 · Draft v1 · October 7, 2026 · Incorporates the existing LynkPro technical write-up*

## 1. Summary

MaplePro is an agentic construction management platform for small-to-mid contractors. A crew of AI agents (site clerk, scheduler, estimator, resource coordinator, billing) watches project data and turns messy field reality into schedule, cost, and billing consequences. PayPal powers the smart payment layer: progress invoices, client payments, subcontractor payouts, and payment-status signals flow from project events rather than from a separate accounting tool.

**Positioning:** Construction first, payments second. Money events in construction are caused by project events (a milestone, a change order, an approved timesheet), so payments become smart when they understand the project.

**Naming note:** The source write-up calls the product LynkPro and the idea doc calls it MaplePro. This PRD uses MaplePro. Confirm the final name (see Appendix A).

## 2. Problem

- Project data is scattered across emails, spreadsheets, and paper reports, so decisions are reactive.
- Delays, cost overruns, and late payments are discovered weeks after they start.
- Stakeholders (PM, client, subcontractor) lack shared visibility, which creates disputes and slow approvals.
- Billing and payouts are disconnected from what actually happened on site, so invoices are late, incomplete, or contested.
- The widely quoted $1.6 trillion annual loss figure is an industry-level statistic and needs a cited source before use in the pitch.

## 3. Goals and non-goals

**Goals**

- G1. Show agents that act on project data end to end: observe, reason, propose, approve, act, verify.
- G2. Tie every payment action to a project event with evidence attached.
- G3. Keep humans in control of anything that commits money or changes the contract.
- G4. Build on the existing application and clearly separate what is new for this hackathon.
- G5. Make claims the team can demonstrate.

**Non-goals (this release)**

- Replacing full accounting software or payroll.
- A native mobile app or offline mode.
- Full document version control, marketplaces, and multi-language support.
- Regulated compliance certification (the product supports holdback and prompt-payment workflows but does not certify compliance).

## 4. Hackathon alignment

| Requirement | How MaplePro meets it |
| --- | --- |
| Meaningful PayPal use | Invoicing for progress and deposit billing, Payouts for subcontractors, Webhooks for payment state, Checkout on invoices, Disputes (if sandbox supports) |
| Meaningful AI use | LLM-powered agents with tool calling over project data, grounded by deterministic engines |
| Working prototype | Existing app plus new agent layer and PayPal flows |
| Documented | This PRD, architecture diagram, API and model inventory, agent action log |
| Build or update an app | Update of the existing application (the delta must be documented, see Section 6) |

| Judging criterion | Where it is addressed |
| --- | --- |
| Technological implementation | Event-driven agent crew, idempotent PayPal flows, database-level security, hybrid deterministic plus LLM design |
| Design | Command Center, role-specific portals, existing design system |
| Potential impact | Specific audience (5 to 100 person contractors) and measurable outcomes (days to get paid, variance caught earlier) |
| Innovation | Payments driven by project events, with evidence-backed agent actions |
| Presentation | One field-note-to-payment story with an ROI view |

## 5. Users and roles

| Persona | Role in system | Needs |
| --- | --- | --- |
| **Owner / Admin** | admin | Portfolio health, cash position, risk, approval thresholds, audit access |
| **Project Manager** | staff | Command center, approvals, schedule and budget control |
| **Field Supervisor** | staff (mobile-first views) | Fast daily reports, photos, material receipts |
| **Client** | client | Progress, approvals, invoices, easy payment |
| **Subcontractor** | subcontractor | Assigned work, timesheets, payment status |

The existing role model has four database roles (admin, staff, client, subcontractor). PM and Field Supervisor are treated as permission profiles within staff. Confirm this mapping.

**Target customer:** General or specialty contractor, roughly 5 to 100 staff, several concurrent jobs, a handful of subs per job, currently using spreadsheets, email, and paper.

## 6. Existing baseline and hackathon delta

The source write-up describes what is already built. The hackathon work should be a clearly labeled delta.

| Area | Existing (per write-up) | New for this hackathon |
| --- | --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind semantic tokens, React Router, Recharts or Plotly | Agent UI: approval cards, Why panels, command bar, Gantt |
| Backend | Supabase: Postgres, Realtime, Auth, Edge Functions, Storage | Agent orchestrator, PayPal integration layer, webhook handler |
| Database | 22 tables with RLS and helper functions | Tables for agent actions, PayPal references, holdback, timesheets, change orders (as needed) |
| Security | Role-based RLS for four roles | Tiered approvals, audit log expansion, webhook signature verification |
| Intelligence | Rule-based insight function over projects and invoices, confidence percentages | LLM agents (Site, Schedule, Budget, Resource, Billing), real weather data, grounded explanations |
| Modules | Projects, invoices, daily reports, proposals, materials, documents, exports, presence | Timesheets, budget by category, Gantt, change orders |
| Payments | None (Stripe listed as roadmap) | PayPal Invoicing, Payouts, Checkout, Webhooks |
| Data | 220+ seeded records, 3 projects, overdue invoices totaling $793,500 | Additional seeded data for agents, plus synthetic payment events |

## 7. Product principles

1. **Project-first.** Every agent output traces to project records.
2. **Agents propose; code calculates; humans approve** anything that commits money or changes a contract.
3. **Evidence over assertion.** Show what the agent saw, why it matters, and what it recommends.
4. **Roles see only their slice,** enforced at the database level.
5. **Say when data is thin.** Confidence reflects data quality, not model optimism.
6. **Honest claims.** Describe only what the team can demonstrate.

## 8. Functional requirements

Priority: **P0** must be excellent, **P1** must work, **P2** if time allows. Items marked (existing) are in the current build and need verification or extension only.

### E1. Project core

| ID | Requirement | Pri |
| --- | --- | --- |
| E1.1 | Projects, phases, tasks with dependencies and planned vs actual dates (extend existing projects) | P0 |
| E1.2 | Gantt timeline with critical path highlighting | P1 |
| E1.3 | Budget lines by category (labor, materials, equipment, subs, permits) with committed and actual cost | P0 |
| E1.4 | Daily reports with photos (existing) | P0 |
| E1.5 | Materials inventory and consumption (existing) | P1 |
| E1.6 | Timesheets for subcontractors and crews with approval workflow | P0 |
| E1.7 | Proposals and documents with file upload (existing); version history is P2 | P1 |
| E1.8 | Change orders with approval history | P0 |
| E1.9 | Export to PDF, CSV, Excel (existing) | P1 |

### E2. Site Agent (daily report intelligence)

| ID | Requirement | Pri |
| --- | --- | --- |
| E2.1 | Convert raw field notes (typed or dictated) into a structured report: work completed, crew on site, delays, safety, materials received, issues | P0 |
| E2.2 | Extract risks and link them to tasks | P0 |
| E2.3 | Ask a follow-up question when key information is missing instead of guessing | P1 |
| E2.4 | Emit structured events consumed by the Schedule, Budget, Resource, and Billing agents | P0 |

### E3. Schedule Agent

| ID | Requirement | Pri |
| --- | --- | --- |
| E3.1 | Forecast completion from actual progress, not only the plan | P0 |
| E3.2 | Integrate a real weather forecast API and flag weather-sensitive tasks (concrete, roofing, exterior work) | P0 |
| E3.3 | Detect critical-path slippage and show downstream impact on tasks and milestones | P0 |
| E3.4 | Propose recovery options with trade-offs | P1 |

### E4. Budget Agent

| ID | Requirement | Pri |
| --- | --- | --- |
| E4.1 | Variance by category and phase, computed by code | P0 |
| E4.2 | Plain-language variance explanation tied to events ('framing ran 4 days long and overtime started') | P0 |
| E4.3 | Forecast cost at completion | P1 |
| E4.4 | Draft change order proposals for PM review when scope change is detected | P1 |

### E5. Resource Agent

| ID | Requirement | Pri |
| --- | --- | --- |
| E5.1 | Project material depletion against schedule and suggest reorder timing | P1 |
| E5.2 | Flag crew or subcontractor overbooking across projects | P2 |
| E5.3 | Cross-check timesheet hours against reported progress to flag anomalies | P1 |

### E6. Billing Agent and PayPal payments

| ID | Requirement | Pri |
| --- | --- | --- |
| E6.1 | Detect billing triggers: milestone sign-off, approved change order, approved timesheets, accepted proposal (deposit) | P0 |
| E6.2 | Draft invoice with line items mapped to phases, change orders, and holdback | P0 |
| E6.3 | On approval, create and send the invoice through PayPal Invoicing | P0 |
| E6.4 | Client pays via PayPal invoice page or Checkout; webhook updates invoice, project, and forecast | P0 |
| E6.5 | Reminder timing and tone chosen from the client's payment history; sent through PayPal invoice reminders | P1 |
| E6.6 | Subcontractor payout batch proposed when conditions are met (approved timesheets, client payment received, holdback applied); executed via Payouts on approval | P0 |
| E6.7 | Holdback tracking and release workflow | P1 |
| E6.8 | Dispute evidence pack and draft response using daily reports, photos, and sign-offs (if sandbox supports Disputes) | P2 |
| E6.9 | Pay Later or flexible payment option on larger invoices (if supported for this account and country) | P2 |
| E6.10 | Late-payer pattern feeds project risk scoring | P1 |

### E7. Command Center and Intelligence Stream

| ID | Requirement | Pri |
| --- | --- | --- |
| E7.1 | Priority view: Urgent, Today, This Week, each item showing agent, evidence, and one-tap action | P0 |
| E7.2 | Project cards with schedule, budget, and payment health side by side | P0 |
| E7.3 | Intelligence Stream with confidence and reasoning (see Section 11) | P0 |
| E7.4 | Presence and live updates (existing) | P1 |
| E7.5 | 30-day cash view derived from schedule and invoice data | P1 |

### E8. Command Bar

| ID | Requirement | Pri |
| --- | --- | --- |
| E8.1 | Natural-language queries routed to agents as tools; answers link to source records | P0 |
| E8.2 | Role-aware: answers only include data the user's role may see | P0 |

### E9. Roles, trust, and audit

| ID | Requirement | Pri |
| --- | --- | --- |
| E9.1 | RLS on all new tables, consistent with existing helper functions | P0 |
| E9.2 | Tiered approvals with admin-set dollar thresholds | P0 |
| E9.3 | Audit log of agent proposals, approvals, edits, and PayPal calls, exportable | P0 |
| E9.4 | Idempotency keys and reconciliation between invoices, payouts, and PayPal events | P0 |
| E9.5 | Client and subcontractor portals show invoices, payment status, and approvals | P0 |

## 9. Agent specifications

All agents use a fixed tool allowlist, return structured outputs with evidence references, and act within the permissions of the approving user. Calculations come from deterministic engines.

| Agent | Purpose | Reads | Tools | Outputs |
| --- | --- | --- | --- | --- |
| **Site** | Field notes to structured report | Raw notes, photos, schedule | Report writer, task linker | Structured report, risks, events |
| **Schedule** | Forecast and weather risk | Tasks, progress, weather API | Critical path engine, weather fetch | Forecast, risk flags, recovery options |
| **Budget** | Cost variance and forecast | Budget lines, timesheets, events | Variance engine, change-order drafter | Variance explanation, forecast, draft change order |
| **Resource** | Materials and crews | Inventory, schedule, timesheets | Depletion calculator, anomaly check | Reorder suggestions, conflicts, anomalies |
| **Billing** | Invoice and payout proposals | Milestones, change orders, timesheets, payment history | PayPal Invoicing, Payouts, Webhook state | Draft invoices, payout batches, reminders, dispute packs |
| **Command Bar** | Orchestrator | User question, role | All agents as tools | One answer with linked records |

**Event chain example:** A supervisor submits a note that framing finished but a wall was rebuilt after an inspection. The Site Agent structures the report and flags delay plus unplanned labor. The Schedule Agent recalculates and shows drywall slipping. The Budget Agent attributes the extra labor cost and drafts a note. The Billing Agent confirms the framing milestone invoice is still due and prepares it, adjusting the forecast. The PM reviews instead of reconstructing.

**Agent loop:** Observe (events and webhooks), Reason (engines plus LLM), Propose (structured action with rationale), Approve (human gate for tiered actions), Act (internal update or PayPal call), Verify (webhook or database confirmation), Log (audit trail).

## 10. PayPal integration specification

| Project moment | PayPal capability | Behavior |
| --- | --- | --- |
| Milestone or change order approved | Invoicing API | Create draft, PM approves, send; line items mapped to phases |
| Proposal accepted | Invoicing | Deposit or retainer invoice |
| Client payment | Invoice page or Checkout | Client pays by PayPal or card as the account allows |
| Payment events | Webhooks | Invoice paid, cancelled, or refunded updates records and forecast |
| Reminders | Invoicing reminders | Billing Agent schedules based on client history |
| Subcontractor pay | Payouts API | Batch after approval, with holdback applied |
| Payout status | Webhooks | Batch and item success or failure update records |
| Dispute | Disputes API | Evidence pack and draft response (verify sandbox support) |
| Larger invoices | Pay Later options | Verify availability for the account, country, and invoice type before committing |

**Webhook events to handle (verify names in current docs):** invoice paid, invoice cancelled, invoice refunded, payout batch success or denied, payout item succeeded or failed, dispute created.

**Money flow:** Client pays into the contractor's PayPal business account. Payouts then send from that balance to subcontractors, so a payout proposal must check available balance and received client payment.

**Holdback logic:** Billing applies a configurable holdback percentage to invoices and sub payouts and tracks release dates. Ontario's Construction Act contains holdback and prompt-payment requirements (for example a 10 percent holdback and defined payment timelines). The PRD treats these as configurable defaults only and requires verification with a qualified source before any compliance claim.

**Currency:** Support CAD. Confirm PayPal sandbox behavior and fees for Canadian business accounts.

**Reliability:** Idempotency keys on every PayPal call, signature verification on every webhook, raw event storage, replay-safe handlers, and a reconciliation view.

**Fees:** Who bears PayPal fees on large B2B invoices is an open commercial question (Section 17).

## 11. AI specification

- **Architecture:** Hybrid. Deterministic engines (critical path, variance, depletion, holdback) produce numbers. LLM agents read, extract, explain, draft, and route. The LLM is Gemini 3.5 Flash, called from Edge Functions with function calling and structured JSON output. The model name lives in one config value behind a thin adapter, so it can be swapped. Confirm the exact model ID, rate limits, and structured-output behavior in the current Gemini API docs before building.
- **Replacing the current approach:** The current insight function is rule-based. Keep it as a deterministic signal layer and add LLM agents on top. Describe it as rules plus LLM, not custom ML, unless trained models are actually added.
- **Confidence definition:** A displayed percentage must come from a documented formula, for example a combination of data completeness, number of corroborating signals, and historical hit rate of that insight type. Show the inputs on hover. If it is only a heuristic, label it as a heuristic score.
- **Grounding:** Every figure in an agent message must come from a tool result or database record, and a validator rejects mismatches.
- **Structured outputs:** JSON schemas for events, insights, proposals, and drafts, validated before use.
- **Evaluations:** Field-note extraction accuracy on a set of sample notes, number-grounding pass rate, and invoice-draft correctness checks against fixtures.
- **Failure behavior:** If the LLM is unavailable, deterministic alerts and manual workflows still function.

## 12. Architecture and stack

- **Frontend:** React, TypeScript, Vite, Tailwind with semantic tokens, React Router, Recharts for charts. Jinja2 is not part of this stack (see Appendix A).
- **Backend:** Supabase with Postgres, RLS, Auth, Realtime, Storage, and Edge Functions.
- **Agents:** Orchestrator in Edge Functions, scheduled jobs for periodic scans, event triggers from database changes and webhooks.
- **PayPal:** Edge Functions hold credentials and make all PayPal calls. A separate webhook endpoint verifies signatures.
- **External:** A weather API and the Gemini API (Gemini 3.5 Flash). Twilio and QuickBooks are roadmap only.
- **Real-time:** Supabase Realtime for live invoice, insight, and presence updates (existing).

## 13. Data model

Existing: 22 tables (the full list was not provided; document it in the README). Suggested additions:

| Table | Key fields |
| --- | --- |
| phases, tasks | project\_id, dependencies, planned and actual dates, percent complete, weather\_sensitive |
| budget\_lines | project\_id, category, budgeted, committed, actual |
| timesheets, timesheet\_entries | user or sub, project, task, hours, status, approver |
| change\_orders | project\_id, amount, status, approval history |
| report\_structured | report\_id, extracted\_json, risks, follow\_up\_questions |
| agent\_insights | type, project\_id, agent, confidence, evidence\_refs, recommended\_action, status, outcome |
| agent\_actions | agent, proposal, rationale, approver, status, result, timestamps |
| paypal\_invoices | invoice\_id, paypal\_invoice\_id, status, milestone\_id, holdback\_amount, idempotency\_key |
| paypal\_payouts | batch\_id, item\_id, recipient, amount, status, linked\_invoice |
| holdbacks | project\_id, amount, release\_date, status |
| webhook\_events | type, payload, signature\_ok, processed\_at |
| approval\_policies | firm\_id, action\_type, threshold, required\_role |

## 14. Non-functional requirements

- **Security:** RLS on every table. Roles must be stored in a dedicated table, not a column a user can update (see Appendix A). Security-definer functions set a fixed search path. PayPal secrets server-side only.
- **Privacy:** Clients and subs see only their projects and invoices. The command bar enforces the same filters.
- **Accessibility:** Maintain WCAG AA on new screens and verify with an automated checker.
- **Performance:** Targets stated only after measurement on the actual dataset.
- **Auditability:** Every money action is traceable from project event to PayPal reference.
- **Quality:** Unit tests for engines and payout and invoice logic. Claims about test coverage are made only if measured.

## 15. Success metrics

| Metric | Target (prototype) |
| --- | --- |
| Field note to structured report and downstream impacts | Under 30 seconds on sample notes |
| Milestone sign-off to sent invoice | Under 2 minutes with approval |
| Client payment to updated dashboard | Within webhook delivery time |
| Payout proposal to executed batch | Under 2 minutes with approval |
| Number-grounding validator pass rate | 100% on test set |

Impact framing for the pitch: modeled reduction in days to get paid and earlier variance detection for a representative contractor, labeled as modeled, not measured.

## 16. Milestones (3 weeks, delta only)

| Week | Focus | Done when |
| --- | --- | --- |
| 1 | Foundations | PayPal sandbox accounts, invoice create and send, webhook handler, agent orchestrator skeleton, one agent action logged end to end |
| 2 | Agents and flows | Site, Schedule, Budget, Billing agents; milestone-to-invoice and payout flows; approval tiers |
| 3 | Polish and submission | Command bar, Gantt, cash view, evals, architecture diagram, README with delta statement, video |

## 17. Risks, assumptions, open questions

| Risk | Mitigation |
| --- | --- |
| Too many modules for three weeks | P0 first: Site, Schedule, Budget, Billing, command bar. Gantt, resource optimization, and dispute handling are cut first |
| Existing project may look like prior work | Provide a clear delta statement and dated commit history |
| Overclaims undermine credibility | Use the claims review in Appendix B |
| PayPal sandbox gaps (Pay Later, Disputes, Canada) | Spike early and cut gracefully |
| Payout failures from insufficient balance | Balance check and sandbox funding in seed process |
| Synthetic data skepticism | State that data is synthetic and flows are live |

**Assumptions:** The base app, design system, and RLS exist and work. Data is synthetic. A team of two to four and three weeks.

**Open questions**

1. Final product name: MaplePro or LynkPro?
2. Who bears PayPal fees in B2B invoices, and is PayPal the primary rail or one option?
3. How much autonomy should agents have? Recommendation: draft and propose first, with earned automation for low-risk actions.
4. Is the Canadian (Ontario) context the primary market? If so, CAD and Construction Act defaults are in scope.
5. Which weather API will be used?

## 18. Out of scope and roadmap

Full document version control, proposals with deeper client collaboration, advanced resource optimization, mobile and offline field app, Twilio SMS, QuickBooks and Xero integrations, subcontractor marketplace, and multi-language support.

## Appendix A. Inconsistencies found in the source material

| # | Inconsistency | Why it matters | Suggested resolution |
| --- | --- | --- | --- |
| 1 | **Name:** LynkPro in the write-up, MaplePro in the idea doc | Confusing for judges | Choose one name everywhere |
| 2 | **Frontend:** 'jinja2 wit...' (cut off) alongside React, TypeScript, Vite, and React Router | Jinja2 is Python server-side templating, which does not fit a React and Supabase stack | Remove Jinja2 and confirm the stack |
| 3 | **Timeline:** 'Production-ready AI in 4 days' vs phases spanning 9 days vs a 3-week hackathon | Three different numbers | Pick one accurate statement of build time |
| 4 | **AI claims:** 'Real ML pipeline' and 'custom ML algorithms' vs a rule-based insight function over projects and invoices | The hackathon needs meaningful AI, and overclaiming hurts credibility | Describe it as rules plus LLM agents, and add the LLM layer |
| 5 | **Insights depend on seeded data:** The write-up admits insights needed overdue invoices added to appear | A judge may see this as hard-coded | Show agents working on new input live |
| 6 | **Roadmap vs features:** Predictive forecasting, budget variance, weather, resource optimization, Gantt, budget tracking, and timesheets are listed both as 'what's next' and as core features in the idea doc | It is unclear what exists | Mark each item built, partial, or planned |
| 7 | **'Every feature fully functional' vs roadmap:** Claims of complete features alongside many unbuilt modules | Contradiction | Use a status table |
| 8 | **Payments:** The write-up lists Stripe as the planned payment integration, but this hackathon requires PayPal, and no PayPal work is described | PayPal is the one fundamental requirement | Replace Stripe with PayPal in all docs |
| 9 | **Idea doc PayPal items:** 'Reminders, pay later, fraud checks' vs no mention in the write-up | Fraud checks have no matching PayPal capability described | Replace with disputes handling and webhook signals, or drop |
| 10 | **Roles:** Four roles in the database (admin, staff, client, subcontractor) vs PM as a separate user type, and a Field Supervisor persona added in the concept | Role model is unclear | Map PM and supervisor to staff permission profiles |
| 11 | **Record counts:** '220+ records' vs itemized counts of 3 projects, 6 invoices, 12 reports, 15 materials, 2 clients, and 5 team members (about 43) | The remainder is unitemized | Provide a per-table count |
| 12 | **Scale claims:** 'Handles 100,000 projects' and 'performance optimization' for about 220 records | Not supported by the data | Remove or test with a generated large dataset |
| 13 | **Quality claims:** 'Zero runtime errors', 'tested', '100% type safety' vs no tests described | Unverifiable | Report measured results only |
| 14 | **Security design:** has\_role reads a role column from the profiles table | If users can update their own profile, they can escalate privileges. Roles belong in a separate table | Use a user\_roles table, restrict updates, and set the function's search path |
| 15 | **Document management:** Idea doc says 'version control', write-up describes uploads only | Feature gap | Describe as uploads, with versioning on roadmap |
| 16 | **Weather:** Idea doc lists weather predictions as an agent feature, write-up lists a weather API as a future integration | Not built yet | Treat as new work in this PRD (E3.2) |
| 17 | **Existing project:** The write-up reads like a prior hackathon submission | Judges may question eligibility and novelty | State what existed and what is new, with dates |

## Appendix B. Claims to verify or soften before submission

- 'Production-ready', 'could deploy tomorrow', and 'enterprise-grade' (replace with specific, evidenced security features).
- 'Sub-second page loads' and '<100ms latency' (measure first).
- 'Real ML' or 'ML-powered' (only if trained models exist).
- '$1.6T' industry figure (cite a source).
- 'Built for scale to 100,000 projects' (remove or test).
- Any Ontario Construction Act statement (verify with a legal or authoritative source).

-- MaplePro Supabase/PostgreSQL schema.
-- Run in the Supabase SQL Editor for a connected environment.
-- The FastAPI server still enforces tenant and role filters for every API query.

create table if not exists public.firms (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id text primary key,
  auth_user_id text unique,
  firm_id text not null references public.firms(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('admin','project_manager','client','subcontractor')),
  active boolean not null default true
);

create table if not exists public.projects (
  id text primary key,
  firm_id text not null references public.firms(id) on delete cascade,
  code text not null unique,
  name text not null,
  client_name text not null,
  client_email text not null,
  project_manager text not null,
  assigned_subcontractor_email text not null,
  location text not null,
  status text not null default 'In progress',
  stage text not null default 'Construction',
  budget double precision not null check (budget >= 0),
  actual_cost double precision not null default 0 check (actual_cost >= 0),
  committed_costs double precision not null default 0 check (committed_costs >= 0),
  progress_pct double precision not null default 0 check (progress_pct between 0 and 100),
  start_date date not null,
  target_completion date not null,
  description text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists projects_firm_id_idx on public.projects(firm_id);

create table if not exists public.invoices (
  id text primary key,
  firm_id text not null references public.firms(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  invoice_number text not null unique,
  invoice_type text not null default 'client_invoice',
  recipient_name text not null,
  recipient_email text not null,
  description text not null,
  amount double precision not null check (amount >= 0),
  currency_code text not null default 'CAD',
  issued_date date not null,
  due_date date not null,
  status text not null default 'SENT',
  paypal_invoice_id text,
  paypal_view_url text,
  reminders_sent integer not null default 0,
  last_reminded_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invoices_firm_id_idx on public.invoices(firm_id);
create index if not exists invoices_project_id_idx on public.invoices(project_id);
create index if not exists invoices_paypal_invoice_id_idx on public.invoices(paypal_invoice_id);

create table if not exists public.milestones (
  id text primary key,
  firm_id text not null references public.firms(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  title text not null,
  planned_date date not null,
  actual_date date,
  progress_pct double precision not null default 0 check (progress_pct between 0 and 100),
  status text not null default 'Upcoming'
);
create index if not exists milestones_firm_id_idx on public.milestones(firm_id);

create table if not exists public.project_snapshots (
  id text primary key,
  firm_id text not null references public.firms(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  snapshot_date date not null,
  actual_cost double precision not null,
  progress_pct double precision not null check (progress_pct between 0 and 100),
  planned_progress_pct double precision not null check (planned_progress_pct between 0 and 100),
  committed_costs double precision not null default 0,
  unique (project_id, snapshot_date)
);
create index if not exists project_snapshots_firm_id_idx on public.project_snapshots(firm_id);

create table if not exists public.payment_events (
  id text primary key,
  firm_id text not null references public.firms(id) on delete cascade,
  invoice_id text references public.invoices(id) on delete set null,
  paypal_event_id text not null unique,
  event_type text not null,
  payload_json text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists payment_events_firm_id_idx on public.payment_events(firm_id);

-- Membership helpers. SECURITY DEFINER allows role lookup inside RLS policy evaluation;
-- keep this function narrow and do not expose any privileged write operation through it.
create or replace function public.current_maplepro_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles
  where auth_user_id = auth.uid()::text and active = true
  limit 1;
$$;

create or replace function public.is_maplepro_member(target_firm_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where auth_user_id = auth.uid()::text
      and firm_id = target_firm_id
      and active = true
  );
$$;

alter table public.firms enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.invoices enable row level security;
alter table public.milestones enable row level security;
alter table public.project_snapshots enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists "firm members can read their firm" on public.firms;
create policy "firm members can read their firm" on public.firms
for select to authenticated using (public.is_maplepro_member(id));

drop policy if exists "users can read their own profile or firm profiles as admin" on public.profiles;
create policy "users can read their own profile or firm profiles as admin" on public.profiles
for select to authenticated using (
  auth_user_id = auth.uid()::text or
  (public.is_maplepro_member(firm_id) and public.current_maplepro_role() = 'admin')
);

drop policy if exists "project role scope select" on public.projects;
create policy "project role scope select" on public.projects
for select to authenticated using (
  public.is_maplepro_member(firm_id) and (
    public.current_maplepro_role() in ('admin','project_manager') or
    (public.current_maplepro_role() = 'client' and client_email = (auth.jwt()->>'email')) or
    (public.current_maplepro_role() = 'subcontractor' and assigned_subcontractor_email = (auth.jwt()->>'email'))
  )
);

drop policy if exists "managers can insert projects" on public.projects;
create policy "managers can insert projects" on public.projects
for insert to authenticated with check (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'));
drop policy if exists "managers can update projects" on public.projects;
create policy "managers can update projects" on public.projects
for update to authenticated using (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'))
with check (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'));

drop policy if exists "invoice role scope select" on public.invoices;
create policy "invoice role scope select" on public.invoices
for select to authenticated using (
  public.is_maplepro_member(firm_id) and (
    public.current_maplepro_role() in ('admin','project_manager') or
    (public.current_maplepro_role() = 'client' and invoice_type = 'client_invoice' and recipient_email = (auth.jwt()->>'email')) or
    (public.current_maplepro_role() = 'subcontractor' and invoice_type = 'subcontractor_invoice' and recipient_email = (auth.jwt()->>'email'))
  )
);
drop policy if exists "managers can insert invoices" on public.invoices;
create policy "managers can insert invoices" on public.invoices
for insert to authenticated with check (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'));
drop policy if exists "managers can update invoices" on public.invoices;
create policy "managers can update invoices" on public.invoices
for update to authenticated using (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'))
with check (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'));

drop policy if exists "milestones visible with parent project" on public.milestones;
create policy "milestones visible with parent project" on public.milestones
for select to authenticated using (
  public.is_maplepro_member(firm_id) and exists (
    select 1 from public.projects p where p.id = milestones.project_id and p.firm_id = milestones.firm_id
  )
);
drop policy if exists "managers can write milestones" on public.milestones;
create policy "managers can write milestones" on public.milestones
for all to authenticated using (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'))
with check (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'));

drop policy if exists "snapshots visible with parent project" on public.project_snapshots;
create policy "snapshots visible with parent project" on public.project_snapshots
for select to authenticated using (
  public.is_maplepro_member(firm_id) and exists (
    select 1 from public.projects p where p.id = project_snapshots.project_id and p.firm_id = project_snapshots.firm_id
  )
);
drop policy if exists "managers can write snapshots" on public.project_snapshots;
create policy "managers can write snapshots" on public.project_snapshots
for all to authenticated using (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'))
with check (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'));

drop policy if exists "managers can read payment events" on public.payment_events;
create policy "managers can read payment events" on public.payment_events
for select to authenticated using (public.is_maplepro_member(firm_id) and public.current_maplepro_role() in ('admin','project_manager'));

-- No browser write policy exists for payment_events. PayPal webhook processing is server-side only.

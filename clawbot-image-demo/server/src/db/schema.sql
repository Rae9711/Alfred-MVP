-- Alfred (阿福) Supabase Schema
-- Run this in your Supabase SQL editor to create the required tables.
-- Supabase Auth provides auth.users automatically.

-- sessions: mirrors the in-memory Session type
create table if not exists sessions (
  session_id  text primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  persona     text not null default 'professional',
  action_mode text not null default 'confirm',
  prompt      text,
  connector_id text,
  clarification_context jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- plans: stores the Plan object as JSONB
create table if not exists plans (
  plan_id     text primary key,
  session_id  text references sessions(session_id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  plan_data   jsonb not null,
  created_at  timestamptz not null default now()
);

-- runs: stores RunRecord as JSONB
create table if not exists runs (
  run_id      text primary key,
  plan_id     text references plans(plan_id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  prompt      text,
  execution_summary jsonb not null,
  tool_results jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Enable RLS
alter table sessions enable row level security;
alter table plans enable row level security;
alter table runs enable row level security;

-- RLS policies (enforced when using anon key; bypassed by service role key)
create policy "Users manage own sessions" on sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own plans" on plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own runs" on runs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Indexes
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_plans_session_id on plans(session_id);
create index if not exists idx_runs_plan_id on runs(plan_id);

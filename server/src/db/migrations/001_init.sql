-- MyDay — esquema inicial
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Sessões: o cookie guarda um token aleatório; aqui fica apenas o hash SHA-256.
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE user_settings (
  user_id               uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone              text NOT NULL DEFAULT 'America/Sao_Paulo',
  daily_enabled         boolean NOT NULL DEFAULT true,
  daily_time            text NOT NULL DEFAULT '07:00',
  weekly_enabled        boolean NOT NULL DEFAULT true,
  weekly_time           text NOT NULL DEFAULT '07:00',
  weekly_day            smallint NOT NULL DEFAULT 1 CHECK (weekly_day BETWEEN 1 AND 7), -- ISO: 1 = segunda
  reminders_enabled     boolean NOT NULL DEFAULT true,
  default_reminders     integer[] NOT NULL DEFAULT '{15}',
  allday_reminder_time  text NOT NULL DEFAULT '09:00',
  default_view          text NOT NULL DEFAULT 'week' CHECK (default_view IN ('day','week','month')),
  theme                 text NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL,
  icon       text NOT NULL DEFAULT 'tag',
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX categories_user_idx ON categories (user_id, position);

CREATE TABLE tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  uuid REFERENCES categories(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  notes        text NOT NULL DEFAULT '',
  date         date NOT NULL,                 -- data (ou primeira ocorrência, se recorrente)
  start_time   time,                          -- NULL = tarefa sem horário (durante o dia)
  end_time     time,
  priority     text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  completed_at timestamptz,
  recurrence   jsonb,                         -- NULL = não se repete
  reminders    integer[] NOT NULL DEFAULT '{}', -- minutos antes
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_user_date_idx ON tasks (user_id, date);
CREATE INDEX tasks_user_recurring_idx ON tasks (user_id) WHERE recurrence IS NOT NULL;

CREATE TABLE subtasks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title      text NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subtasks_task_idx ON subtasks (task_id, position);

-- Exceções por ocorrência de tarefas recorrentes (status, exclusão ou reagendamento de uma única ocorrência)
CREATE TABLE task_exceptions (
  task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  status          text CHECK (status IN ('pending','in_progress','done')),
  completed_at    timestamptz,
  deleted         boolean NOT NULL DEFAULT false,
  new_date        date,
  new_start_time  time,
  new_end_time    time,
  time_overridden boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, occurrence_date)
);

CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  device_label    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_error      text,
  failure_count   integer NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- Registro de envios. A chave única impede notificações duplicadas,
-- mesmo com várias instâncias do servidor ou reinicializações.
CREATE TABLE notification_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('daily','weekly','reminder','test')),
  dedupe_key  text NOT NULL UNIQUE,
  title       text NOT NULL,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed','no_subscription')),
  delivered   integer NOT NULL DEFAULT 0,
  attempts    integer NOT NULL DEFAULT 1,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX notification_log_user_idx ON notification_log (user_id, created_at DESC);

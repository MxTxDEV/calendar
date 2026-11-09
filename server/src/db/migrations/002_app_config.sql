-- Segredos gerados automaticamente na primeira inicialização (quando não vêm de variáveis de ambiente)
CREATE TABLE app_config (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

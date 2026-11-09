# MyDay — calendário e assistente pessoal

PWA instalável com calendário (dia/semana/mês), tarefas com recorrência, subtarefas, categorias, dashboard e
**notificações Web Push reais** (resumo diário, resumo semanal e lembretes) enviadas pelo servidor — o app não
precisa estar aberto.

**Stack:** React + Vite (PWA, Service Worker) · Node 20+/Express 5 · PostgreSQL · `web-push` (VAPID) · agendador no servidor.

## Rodando localmente

```bash
npm install
cp .env.example .env          # edite SESSION_SECRET e DATABASE_URL
npm run vapid                 # cole as chaves geradas no .env (a chave privada é segredo!)
npm run build
npm start                     # http://localhost:3000 (migrações rodam sozinhas)
```

Desenvolvimento com hot reload: `npm run dev` (API em :3000, app em :5173).
Testes: `npm test` (o banco `myday_test` é recriado a cada execução; ajuste `TEST_DATABASE_URL` se preciso).

## Colocando em produção (obrigatório para receber push no celular)

Web Push **exige HTTPS** (exceto `localhost`) e, no iPhone, o app precisa estar instalado na Tela de Início (iOS 16.4+).

1. Hospede com HTTPS (ex.: VPS + Caddy/Nginx, Fly.io, Railway, Render). Há `Dockerfile` e `docker-compose.yml` (Postgres incluso):
   `DB_PASSWORD=... SESSION_SECRET=... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... docker compose up -d --build`
2. Use **uma única instância** do servidor ativa (o agendador roda dentro dele; réplicas extras são seguras — usam trava no banco —, mas não necessárias).
3. Crie sua conta e depois defina `ALLOW_SIGNUP=false`.
4. No celular: abra o endereço → *Instalar app / Adicionar à Tela de Início* → **Ajustes › Notificações › Ativar**.
5. Use *Ajustes › Testar notificação* para confirmar a entrega.

## Como as notificações funcionam

- O agendador roda **a cada minuto** no servidor, calcula os horários no fuso de cada usuário (padrão `America/Sao_Paulo`) e envia via Web Push criptografado (VAPID).
- **Resumo diário** no horário configurado (07:00); **semanal** no dia/horário configurado (segunda 07:00, cobrindo segunda–domingo).
- **Lembretes** por tarefa (5 min, 15 min, 30 min, 1 h, 1 dia ou personalizado). Tarefas sem horário usam o horário padrão de Ajustes.
- **Sem duplicatas:** cada envio é registrado em `notification_log` com chave única (`daily:usuário:data`, `weekly:usuário:segunda`, `reminder:tarefa:data:horário:antecedência`).
- **Tolerância a quedas:** resumos ainda são enviados até 3 h após o horário; lembretes atrasados mais de 10 min são descartados. Envios que falharem são retentados (até 4 vezes).
- Inscrições expiradas (HTTP 404/410) são removidas automaticamente. Todos os dispositivos da conta recebem a notificação.

## Segurança

Senhas com bcrypt · sessão em cookie `httpOnly`/`SameSite=Lax` (token guardado só como HMAC no banco) · rate limit no login ·
Helmet + CSP · validação com Zod · todas as consultas filtradas por usuário · endpoints push restritos a serviços conhecidos (anti-SSRF) ·
chaves VAPID e segredos só por variáveis de ambiente (`.env` está no `.gitignore`).

## Estrutura

```
server/  API, migrações SQL, agendador e push   (src/notifications = resumos, lembretes, envio)
web/     App React + service worker (public/sw.js) + manifest/ícones
```

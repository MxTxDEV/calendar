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

## Deploy na Vercel (recomendado, gratuito)

O repositório já traz `vercel.json` e `api/index.mjs`: o front-end vira site estático e a API roda como função serverless.

1. **Banco de dados:** no projeto da Vercel, aba **Storage → Create Database → Neon (Postgres)** e conecte ao projeto.
   Isso cria a variável `DATABASE_URL` automaticamente. É a única configuração obrigatória.
2. **Deploy:** cada `git push` publica. As tabelas são criadas sozinhas no primeiro acesso.
3. Abra o endereço, **crie sua conta** (a primeira conta é sempre permitida; depois o cadastro fecha, a menos que `ALLOW_SIGNUP=true`).
4. **Agendador (para lembretes no minuto certo):** em **Ajustes › Agendador automático** o app mostra um endereço secreto.
   Crie um job gratuito em [cron-job.org](https://cron-job.org) com intervalo de **1 minuto** chamando esse endereço.
   (O plano Hobby da Vercel só permite cron diário; por isso o ping externo. O cron diário do `vercel.json` é apenas uma rede de segurança para os resumos.)
5. No celular: abra o endereço → *Instalar app / Adicionar à Tela de Início* → **Ajustes › Notificações › Ativar** → *Testar notificação*.

Segredos (`SESSION_SECRET`, chaves VAPID, segredo do agendador) são **gerados automaticamente** na primeira execução e guardados no banco.
Se preferir, defina-os por variáveis de ambiente — elas têm prioridade (`npm run vapid` gera as chaves).

## Outras hospedagens (servidor Node contínuo)

Web Push exige **HTTPS** (exceto `localhost`); no iPhone o app precisa estar instalado na Tela de Início (iOS 16.4+).
Há `Dockerfile` e `docker-compose.yml` (Postgres incluso): `DB_PASSWORD=... docker compose up -d --build`.
Nesse modo o agendador roda dentro do servidor (a cada minuto), sem precisar de ping externo.

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

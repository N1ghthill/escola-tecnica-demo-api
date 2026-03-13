# escola-tecnica-demo-api

API Node.js/TypeScript preparada para demonstração pública de um funil educacional.

O repositório foi reduzido para apresentação:

- catálogo de cursos
- captura de leads
- captura de intenções parciais
- métricas de funil
- modo demo sem banco nem integrações externas

Runbooks, artefatos operacionais e referências de infraestrutura real foram removidos desta cópia.

## Endpoints principais

- `GET /api/health`
- `GET /api/courses`
- `POST /api/leads`
- `GET /api/leads`
- `PATCH /api/leads`
- `POST /api/lead-intents`
- `GET /api/lead-intents`
- `POST /api/funnel-events`
- `GET /api/funnel-metrics`
- `POST /api/payments`

## Modo demo

Ative o modo demo para responder com payloads mockados, sem PostgreSQL e sem canais externos:

```bash
DEMO_MODE=true MATRICULADOR_TOKEN=demo-token npm run dev
```

Nesse modo, `health`, `courses`, `leads`, `lead-intents`, `funnel-events` e `funnel-metrics`
respondem com dados locais de demonstração.

## Setup local

```bash
npm install
npm run dev
```

Se quiser rodar com banco local em vez de demo:

```bash
docker compose up -d db
npm run db:setup
npm run dev
```

## Variáveis relevantes

- `DEMO_MODE` ou `APP_MODE=demo`
- `MATRICULADOR_TOKEN` ou `MATRICULADOR_TOKEN_SHA256(_LIST)`
- `FRONTEND_BASE_URL`
- `FRONTEND_ALLOWED_ORIGINS`
- `DATABASE_URL`
- `ENROLLMENT_FLOW_MODE`
- `ENABLE_ONLINE_PAYMENTS`

## Qualidade

```bash
npm run check
```

O comando executa:

- `npm run typecheck`
- `npm run test`

## Observações

- `POST /api/payments` permanece desativado por padrão.
- O `vercel.json` não faz mais proxy para infraestrutura externa.
- O domínio de demonstração esperado no front é `https://demo.escola-tecnica.example`.

## Licença

Repositório proprietario. Veja `LICENSE`.

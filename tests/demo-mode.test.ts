import assert from "node:assert/strict";
import test from "node:test";

type MockRequest = {
  method: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
  socket: { remoteAddress: string };
  ip: string;
};

type MockResponse = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  ended: boolean;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  end: () => MockResponse;
};

function createRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    method: "GET",
    headers: {},
    query: {},
    body: {},
    socket: { remoteAddress: "127.0.0.1" },
    ip: "127.0.0.1",
    ...overrides
  };
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    ended: false,
    setHeader(name: string, value: string) {
      this.headers[name] = String(value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
}

async function withDemoEnv(run: () => Promise<void>) {
  const previousDemoMode = process.env.DEMO_MODE;
  const previousAppMode = process.env.APP_MODE;
  const previousMatriculadorToken = process.env.MATRICULADOR_TOKEN;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  process.env.DEMO_MODE = "true";
  process.env.APP_MODE = "";
  process.env.MATRICULADOR_TOKEN = "demo-token";
  process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/escola_tecnica_demo";

  try {
    await run();
  } finally {
    if (previousDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previousDemoMode;

    if (previousAppMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousAppMode;

    if (previousMatriculadorToken === undefined) delete process.env.MATRICULADOR_TOKEN;
    else process.env.MATRICULADOR_TOKEN = previousMatriculadorToken;

    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

test("health exposes demo metadata when demo mode is enabled", async () => {
  await withDemoEnv(async () => {
    const { default: health } = await import("../api/health.js");
    const req = createRequest();
    const res = createResponse();

    health(req as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      ok: true,
      mode: "demo",
      detail:
        "Ambiente de demonstracao: respostas mockadas, sem persistencia, sem pagamentos e sem integracoes externas."
    });
  });
});

test("courses returns mocked catalog in demo mode", async () => {
  await withDemoEnv(async () => {
    const { default: courses } = await import("../api/courses.js");
    const req = createRequest();
    const res = createResponse();

    await courses(req as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.equal((res.body as any).demo, true);
    assert.equal(Array.isArray((res.body as any).courses), true);
    assert.equal((res.body as any).courses.length >= 3, true);
  });
});

test("lead creation returns a mocked protocol without touching the database", async () => {
  await withDemoEnv(async () => {
    const { default: leads } = await import("../api/leads.js");
    const req = createRequest({
      method: "POST",
      body: {
        course_slug: "administracao",
        name: "Cliente Demo",
        email: "cliente.demo@example.com",
        phone: "11999999999",
        father_name: "Pai Demo",
        mother_name: "Mae Demo",
        cpf: "52998224725",
        birth_date: "1994-05-20",
        address: {
          cep: "01001000",
          street: "Rua Demo",
          number: "100",
          neighborhood: "Centro",
          city: "Sao Paulo",
          state: "SP"
        }
      }
    });
    const res = createResponse();

    await leads(req as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.equal((res.body as any).demo, true);
    assert.match((res.body as any).lead_id, /^[0-9a-f-]{36}$/i);
    assert.match((res.body as any).lead_code, /^ET-[A-Z0-9]{8}$/);
  });
});

test("lead intents lookup returns mocked records when authenticated", async () => {
  await withDemoEnv(async () => {
    const { default: leadIntents } = await import("../api/lead-intents.js");
    const req = createRequest({
      headers: {
        "x-matriculator-token": "demo-token"
      },
      query: {
        intent_type: "pre_matricula_nao_concluida",
        limit: "5"
      }
    });
    const res = createResponse();

    await leadIntents(req as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.equal((res.body as any).demo, true);
    assert.equal((res.body as any).count >= 1, true);
  });
});

test("funnel metrics returns mocked dashboard when authenticated", async () => {
  await withDemoEnv(async () => {
    const { default: funnelMetrics } = await import("../api/funnel-metrics.js");
    const req = createRequest({
      headers: {
        "x-matriculator-token": "demo-token"
      },
      query: {
        days: "7"
      }
    });
    const res = createResponse();

    await funnelMetrics(req as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.equal((res.body as any).demo, true);
    assert.equal((res.body as any).summary.visits > 0, true);
    assert.equal(Array.isArray((res.body as any).daily), true);
  });
});

test("funnel events accepts valid mocked events in demo mode", async () => {
  await withDemoEnv(async () => {
    const { default: funnelEvents } = await import("../api/funnel-events.js");
    const req = createRequest({
      method: "POST",
      body: {
        event_type: "whatsapp_handoff",
        client_event_id: "demo-client-event-001",
        session_id: "demo-session-001"
      }
    });
    const res = createResponse();

    await funnelEvents(req as any, res as any);

    assert.equal(res.statusCode, 201);
    assert.equal((res.body as any).demo, true);
    assert.equal((res.body as any).duplicate, false);
  });
});

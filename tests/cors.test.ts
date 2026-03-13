import assert from "node:assert/strict";
import test from "node:test";
import { cors } from "../lib/cors.js";

type MockResponse = {
  headers: Record<string, string>;
  statusCode: number;
  body: unknown;
  setHeader: (name: string, value: string) => void;
  status: (statusCode: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  end: () => MockResponse;
};

function createMockResponse(): MockResponse {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name: string, value: string) {
      this.headers[name] = String(value);
    },
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    }
  };
}

function withTemporaryEnv(
  overrides: Record<string, string | undefined>,
  callback: () => void | Promise<void>
): Promise<void> | void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const finalize = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    const result = callback();
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).finally(finalize);
    }
    finalize();
    return result;
  } catch (error) {
    finalize();
    throw error;
  }
}

test("cors preflight allows Idempotency-Key header", () => {
  const req = {
    method: "OPTIONS",
    headers: {
      origin: "https://demo.escola-tecnica.example"
    }
  };

  const res = createMockResponse();
  const handled = cors(req as any, res as any);

  assert.equal(handled, true);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://demo.escola-tecnica.example");
  assert.match(res.headers["Access-Control-Allow-Headers"], /Idempotency-Key/);
});

test("cors supports wildcard origins configured for Vercel previews", () => {
  return withTemporaryEnv(
    {
      NODE_ENV: "production",
      FRONTEND_BASE_URL: undefined,
      FRONTEND_ALLOWED_ORIGINS:
        "https://demo.escola-tecnica.example,https://escola-tecnica-demo-*.vercel.app"
    },
    () => {
      const req = {
        method: "GET",
        headers: {
          origin: "https://escola-tecnica-demo-git-main-irvings-projects.vercel.app"
        }
      };

      const res = createMockResponse();
      const handled = cors(req as any, res as any);

      assert.equal(handled, false);
      assert.equal(
        res.headers["Access-Control-Allow-Origin"],
        "https://escola-tecnica-demo-git-main-irvings-projects.vercel.app"
      );
    }
  );
});

test("cors blocks origins that do not match wildcard allowlist", () => {
  return withTemporaryEnv(
    {
      NODE_ENV: "production",
      FRONTEND_BASE_URL: undefined,
      FRONTEND_ALLOWED_ORIGINS:
        "https://demo.escola-tecnica.example,https://escola-tecnica-demo-*.vercel.app"
    },
    () => {
      const req = {
        method: "GET",
        headers: {
          origin: "https://random-app.vercel.app"
        }
      };

      const res = createMockResponse();
      const handled = cors(req as any, res as any);

      assert.equal(handled, true);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.body, { error: "forbidden_origin" });
    }
  );
});

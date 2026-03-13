import "./lib/loadEnv.js";
import express from "express";
import type { Request, Response } from "express";
import health from "./api/health.js";
import courses from "./api/courses.js";
import leads from "./api/leads.js";
import leadIntents from "./api/lead-intents.js";
import funnelEvents from "./api/funnel-events.js";
import funnelMetrics from "./api/funnel-metrics.js";
import payments from "./api/payments.js";
import { applySecurityHeaders } from "./lib/http.js";

const app = express();

app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  applySecurityHeaders(req, res);
  next();
});

const adapt =
  (handler: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  (req: Request, res: Response) =>
    handler(req, res);

app.all("/api/health", adapt(health));
app.all("/api/courses", adapt(courses));
app.all("/api/leads", adapt(leads));
app.all("/api/lead-intents", adapt(leadIntents));
app.all("/api/funnel-events", adapt(funnelEvents));
app.all("/api/funnel-metrics", adapt(funnelMetrics));
app.all("/api/payments", adapt(payments));

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

const port = Number(process.env.PORT || 3000);
const host = String(process.env.HOST || "").trim();

if (host) {
  app.listen(port, host, () => {
    console.log(`escola-tecnica-demo-api listening on ${host}:${port}`);
  });
} else {
  app.listen(port, () => {
    console.log(`escola-tecnica-demo-api listening on :${port}`);
  });
}

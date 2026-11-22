import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";
import { isDatabaseUnavailable, queryOne } from "./db.js";
import { businessToday } from "./lib/dates.js";
import { HttpError } from "./types.js";
import { findUserById, toPublicUser } from "./users.js";
import {
  attachActor,
  blockIfPasswordChangeRequired,
  createAuthRouter,
  csrfAndOriginGuard
} from "./routes/auth.js";
import { createFanRouter } from "./routes/fans.js";
import { createFanLeadsRouter } from "./routes/fanLeads.js";
import { createAdminRouter } from "./routes/admin.js";
import { createEditorRouter, createOpsRouter } from "./routes/daily.js";
import { createOrderRouter } from "./routes/orders.js";
import { createSalaryRouter } from "./routes/salaries.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createBossAnalyticsRouter } from "./routes/bossAnalytics.js";
import { createOperatingFinanceRouter } from "./routes/operatingFinance.js";
import { createNoteRouter } from "./routes/notes.js";
import { requireAuth } from "./routes/auth.js";
import { createModulesRouter } from "./routes/modules.js";
import { guardModuleWrites } from "./lib/modules.js";
import { createCsAccountsRouter, createCsDeviceRegistrationRouter } from "./routes/csAccounts.js";
import { createCsBindingsRouter } from "./routes/csBindings.js";
import { createSupervisorFollowupsRouter } from "./routes/supervisorFollowups.js";
import { enforceRoleBoundary } from "./lib/access.js";
import { restrictLanClients } from "./lib/lan.js";
import { createOrderRecordsRouter } from "./routes/orderRecords.js";
import { createAdAccountsRouter } from "./routes/adAccounts.js";
import { createSupplierPaymentsRouter } from "./routes/supplierPayments.js";
import { createFinanceRouter } from "./routes/finance.js";
import { createLiveBusinessRouter } from "./routes/liveBusiness.js";
import { createWarehouseRouter } from "./routes/warehouse.js";
import { createPeopleWorkbenchRouter } from "./routes/peopleWorkbench.js";
import { createCsLoginsRouter } from "./routes/csLogins.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PgSession = connectPgSimple(session);
const healthQuery = { text: "SELECT 1", query_timeout: 1000 };

export function createApp(db: Pool, config: AppConfig) {
  const app = express();
  app.enable("case sensitive routing");
  app.use(restrictLanClients(config));
  if (config.trustProxy > 0) app.set("trust proxy", config.trustProxy);

  app.use(
    helmet({
       hsts: config.cookieSecure,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:"],
           "connect-src": ["'self'", "https://api.exchangerate.dev", ...config.appOrigins],
           ...(config.cookieSecure ? {} : { "upgrade-insecure-requests": null })
        }
      }
    })
  );
  app.disable("x-powered-by");
  app.use(express.json({ limit: "200kb" }));

  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && config.appOrigins.includes(origin.replace(/\/$/, ""))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  const health = async (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    try {
      await db.query(healthQuery);
      res.json({ status: "ok", db: "ok" });
    } catch {
      res.status(503).json({ status: "error", db: "down" });
    }
  };
  app.get("/health", health);
  app.get("/api/health", health);

  app.use(
    session({
      name: "cms.sid",
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: true,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: config.cookieSameSite,
        secure: config.cookieSecure,
        maxAge: 12 * 60 * 60 * 1000
      },
      store: new PgSession({
        pool: db,
        tableName: "session",
        createTableIfMissing: false
      })
    })
  );

  app.use(
    attachActor(async (id) => {
      const user = await findUserById(db, id);
      if (!user?.is_active) return undefined;
      if (user.account_kind === "cs_service" || user.account_kind === "cs_wechat") {
        const invalid = await queryOne(db, `SELECT 1 FROM cs_device_bindings b
          JOIN users e ON e.id=b.employee_id
          WHERE b.account_id=$1 AND b.state='active' AND b.device_version=$2
          AND (NOT e.is_active OR e.role<>'cs' OR e.must_change_password OR NOT EXISTS(
            SELECT 1 FROM team_memberships a JOIN team_memberships m ON m.team_id=a.team_id
            JOIN teams t ON t.id=a.team_id AND t.is_active
            WHERE a.user_id=b.account_id AND m.user_id=b.employee_id
              AND a.start_date<=$3 AND (a.end_date IS NULL OR a.end_date >= $3)
              AND m.start_date<=$3 AND (m.end_date IS NULL OR m.end_date >= $3)))`,
          [id, user.device_version, businessToday(new Date(), config.businessTimezone)]);
        if (invalid) return undefined;
      }
      return toPublicUser(user);
    })
  );

  app.use(csrfAndOriginGuard(config.appOrigins));
  app.use("/api/auth/cs-device", createCsDeviceRegistrationRouter(db, config));
  app.use("/api/auth", createAuthRouter(db, config));
  app.use(requireAuthExcept(["/api/auth/login", "/api/auth/csrf", "/api/auth/logout"]));
  app.use(blockIfPasswordChangeRequired);
  app.use(enforceRoleBoundary);
  app.use("/api/warehouse", guardModuleWrites(db, "orders"), createWarehouseRouter(db, config));
  app.use("/api/finance/warehouse", guardModuleWrites(db, "orders"), createWarehouseRouter(db, config));
  app.use("/api/modules", createModulesRouter(db));
  app.use("/api/cs-accounts", createCsAccountsRouter(db, config));
  app.use("/api/cs-device-bindings", createCsBindingsRouter(db, config));
  app.use("/api/supervisor/order-followups", createSupervisorFollowupsRouter(db, config));
  app.use("/api/fan-reports", guardModuleWrites(db, "fans"), createFanRouter(db, config));
  app.use("/api/fan-leads", guardModuleWrites(db, "fans"), createFanLeadsRouter(db, config));
  app.use("/api/admin", createAdminRouter(db));
  app.use("/api/cs-logins", createCsLoginsRouter(db, config));
  app.use("/api/ops-reports", guardModuleWrites(db, "ops"), createOpsRouter(db, config));
  app.use("/api/editor-reports", guardModuleWrites(db, "editor"), createEditorRouter(db, config));
  app.use("/api/orders", guardModuleWrites(db, "orders"), createOrderRouter(db, config));
  app.use("/api/order-records", guardModuleWrites(db, "orders"), createOrderRecordsRouter(db, config));
  app.use("/api/dashboard/live-business", createLiveBusinessRouter(db, config));
  app.use("/api/finance/payables", createSupplierPaymentsRouter(db, config));
  app.use("/api/ad-accounts", guardModuleWrites(db,"ops"), createAdAccountsRouter(db, config));
  app.use("/api/finance", createOperatingFinanceRouter(db, config));
  app.use("/api/finance", createFinanceRouter(db, config));
  app.use("/api/salaries", createSalaryRouter(db));
  app.use("/api/dashboard", createBossAnalyticsRouter(db, config));
  app.use("/api/dashboard", createDashboardRouter(db, config));
  app.use("/api/notes", createNoteRouter(db));
  app.use("/api/reviews", (_req, res) => res.status(410).json({ error: "审核流程已停用，填报数据直接进入统计" }));
  app.use("/api", createPeopleWorkbenchRouter(db, config));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "接口不存在" });
  });

  app.use((req, res, next) => {
    if (isSensitivePath(req.path)) {
      res.status(404).type("text/plain").send("Not Found");
      return;
    }
    next();
  });

  if (config.serveStatic) {
    const dist = resolveFrontendDist();
    if (existsSync(dist)) {
      app.use(express.static(dist));
      app.get(/^(?!\/api(?:\/|$)).*/i, (_req, res) => {
        res.sendFile(path.join(dist, "index.html"));
      });
    }
  }

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    if (typeof error === "object" && error && "status" in error && error.status === 413) { res.status(413).json({ error: "文件或请求过大，订单照片每张最多8MB" }); return; }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (typeof error === "object" && error && "code" in error && (error as { code: string }).code === "23505") {
      res.status(409).json({ error: "记录已存在，不能重复提交" });
      return;
    }
    if (isDatabaseUnavailable(error)) {
      res.status(503).json({ error: "数据库暂时不可用，请稍后重试", code: "DATABASE_UNAVAILABLE" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "服务器内部错误" });
  });

  return app;
}

function requireAuthExcept(paths: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) return next();
    if (paths.includes(req.path)) return next();
    return requireAuth(req, res, next);
  };
}

function resolveFrontendDist(): string {
  const candidates = [
    path.resolve(here, "../../frontend/dist"),
    path.resolve(here, "../../../frontend/dist")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function isSensitivePath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const normalized = decoded.replace(/\\/g, "/");
  if (normalized.split("/").some((segment) => segment.startsWith(".") && segment.length > 1)) {
    return true;
  }
  const lower = normalized.toLowerCase();
  const blockedPrefixes = [
    "/backend/",
    "/scripts/",
    "/docs/",
    "/migrations/",
    "/node_modules/",
    "/artifacts/",
    "/dist-demo/"
  ];
  if (blockedPrefixes.some((prefix) => lower === prefix.slice(0, -1) || lower.startsWith(prefix))) {
    return true;
  }
  const blockedExact = new Set([
    "/package.json",
    "/package-lock.json",
    "/tsconfig.json",
    "/docker-compose.yml",
    "/dockerfile",
    "/claude.md",
    "/readme.md",
    "/wrangler-demo.json"
  ]);
  if (blockedExact.has(lower)) {
    return true;
  }
  if (!lower.startsWith("/assets/") && /\.(ts|tsx|sql|map|sh|ps1|py|env)$/.test(lower)) {
    return true;
  }
  return false;
}

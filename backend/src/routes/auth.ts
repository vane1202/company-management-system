import { isDeviceAccount } from '../lib/csAccounts.js';
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { Pool } from "pg";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "../config.js";
import { writeAudit } from "../audit.js";
import { findUserByUsername, normalizeUsername, toPublicUser, type Actor, type DbUser } from "../users.js";
import { hashPassword, validatePassword, verifyPassword } from "../lib/password.js";
import { HttpError } from "../types.js";
import { businessToday } from "../lib/dates.js";
import { getBackfillDays } from "../settings.js";

export function createAuthRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  const loginIpLimit = config.loginIpMaxAttempts ?? Math.max(config.loginMaxAttempts * 4, 24);
  const loginIpLimiter = rateLimit({
    windowMs: config.loginWindowMs,
    limit: loginIpLimit,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "unknown",
    handler: (_req, res) => {
      res.status(429).json({ error: "当前网络登录失败次数过多，请稍后再试" });
    }
  });

  const loginLimiter = rateLimit({
    windowMs: config.loginWindowMs,
    limit: config.loginMaxAttempts,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const username = normalizeUsername(req.body?.username);
      return `${req.ip ?? "unknown"}:${username}`;
    },
    handler: (_req, res) => {
      res.status(429).json({ error: "登录尝试过于频繁，请稍后再试" });
    }
  });

  router.get("/csrf", (req, res) => {
    ensureCsrf(req);
    res.json({ csrfToken: req.session.csrfToken });
  });

  router.get("/me", async (req, res, next) => {
    try {
      if (!req.actor) throw new HttpError(401, "未登录");
      res.json({ user: req.actor, ...(await sessionMeta()) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/meta", async (req, res, next) => {
    try {
      if (!req.actor) throw new HttpError(401, "未登录");
      const today = businessToday(new Date(), config.businessTimezone);
      const backfillDays = await getBackfillDays(db, config.fanReportBackfillDays);
      res.json({
        today,
        timezone: config.businessTimezone,
        backfillDays,
        disclaimer: "经营估算用于看日常趋势，不等于会计净利润。"
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", loginIpLimiter, loginLimiter, async (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const password = String(req.body?.password ?? "");
      if (!username || !password) throw new HttpError(400, "请输入登录名和密码");

      const user = await findUserByUsername(db, username);
      const ok = user ? await verifyPassword(password, user.password_hash) : false;
      if (!user || !user.is_active || !ok || isDeviceAccount(user.account_kind)) {
        await writeAudit(db, {
          actorId: user?.id ?? null,
          action: "login_failed",
          entityType: "user",
          entityId: user?.id ?? username,
          ip: req.ip
        });
        throw new HttpError(401, "登录名或密码不正确");
      }

      await establishSession(req, user);
      await writeAudit(db, {
        actorId: user.id,
        action: "login",
        entityType: "user",
        entityId: user.id,
        ip: req.ip
      });
      res.json({ user: toPublicUser(user), csrfToken: req.session.csrfToken, ...(await sessionMeta()) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      const userId = req.session.userId;
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((error) => (error ? reject(error) : resolve()));
      });
      res.clearCookie("cms.sid");
      if (userId) {
        await writeAudit(db, {
          actorId: userId,
          action: "logout",
          entityType: "user",
          entityId: userId,
          ip: req.ip
        });
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/change-password", async (req, res, next) => {
    try {
      if (!req.actor) throw new HttpError(401, "未登录");
      const currentPassword = String(req.body?.currentPassword ?? "");
      if (isDeviceAccount(req.actor.accountKind)) throw new HttpError(403, "客服接待账号通过管理员登记码重新登记，不使用员工密码");
      const newPassword = String(req.body?.newPassword ?? "");
      const user = await findUserByUsername(db, req.actor.username);
      if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
        throw new HttpError(400, "当前密码不正确");
      }
      validatePassword(newPassword, user.username);
      if (await verifyPassword(newPassword, user.password_hash)) {
        throw new HttpError(400, "新密码不能与当前密码相同");
      }
      const passwordHash = await hashPassword(newPassword);
      const client = await db.connect();
      let nextSessionVersion = (user.session_version ?? 0) + 1;
      try {
        await client.query("BEGIN");
        const updated = await client.query<{ session_version: number }>(
          "UPDATE users SET password_hash = $1, must_change_password = FALSE, session_version = session_version + 1, updated_at = now() WHERE id = $2 RETURNING session_version",
          [passwordHash, user.id]
        );
        nextSessionVersion = updated.rows[0]?.session_version ?? nextSessionVersion;
        await client.query(
          "DELETE FROM session WHERE sess->>'userId' = $1 AND sid <> $2",
          [user.id, req.sessionID]
        );
        await writeAudit(client, {
          actorId: user.id,
          action: "change_password",
          entityType: "user",
          entityId: user.id,
          after: { mustChangePassword: false, otherSessionsRevoked: true },
          ip: req.ip
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      req.session.sessionVersion = nextSessionVersion;
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  async function sessionMeta() {
    const today = businessToday(new Date(), config.businessTimezone);
    const backfillDays = await getBackfillDays(db, config.fanReportBackfillDays);
    return {
      today,
      timezone: config.businessTimezone,
      backfillDays,
      disclaimer: "经营估算用于看日常趋势，不等于会计净利润。"
    };
  }

  return router;
}

export function ensureCsrf(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

const CS_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function establishSession(req: Request, user: DbUser): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.csrfToken = randomBytes(32).toString("hex");
  if (isDeviceAccount(user.account_kind)) {
    req.session.deviceVersion = user.device_version ?? 0;
    req.session.cookie.maxAge = CS_SESSION_MAX_AGE_MS;
  } else {
    req.session.sessionVersion = user.session_version ?? 0;
    if (user.role === "cs") {
      req.session.cookie.maxAge = CS_SESSION_MAX_AGE_MS;
    }
  }
}

export function parseOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function assertSameOrigin(req: Request, allowed: string[]): void {
  const origin = parseOrigin(req.get("origin")) ?? parseOrigin(req.get("referer"));
  if (!origin) {
    throw new HttpError(403, "缺少 Origin，拒绝写入请求");
  }
  if (!allowed.includes(origin)) {
    throw new HttpError(403, "来源不被允许");
  }
}

export function csrfAndOriginGuard(allowed: string[]) {
  return (req: Request, _res: Response, next: (error?: unknown) => void) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    try {
      assertSameOrigin(req, allowed);
      const token = String(req.get("x-csrf-token") ?? "");
      if (!req.session.csrfToken || !token || token !== req.session.csrfToken) {
        throw new HttpError(403, "CSRF 校验失败");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function attachActor(loader: (id: string) => Promise<Actor | undefined>) {
  return async (req: Request, _res: Response, next: (error?: unknown) => void) => {
    try {
      if (req.session.userId) {
        const actor = await loader(req.session.userId);
        const validDevice = actor ? (!isDeviceAccount(actor.accountKind) || req.session.deviceVersion === actor.deviceVersion) : false;
        const validEmployeeSession = actor ? (isDeviceAccount(actor.accountKind) || req.session.sessionVersion === (actor.sessionVersion ?? 0)) : false;
        if (actor && actor.isActive && validDevice && validEmployeeSession) {
          req.actor = actor;
          if (actor.role === "cs" && req.session.cookie.originalMaxAge !== CS_SESSION_MAX_AGE_MS) {
            req.session.cookie.maxAge = CS_SESSION_MAX_AGE_MS;
          }
        }
        else { delete req.session.userId; delete req.session.deviceVersion; delete req.session.sessionVersion; }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAuth(req: Request, _res: Response, next: (error?: unknown) => void) {
  if (!req.actor) return next(new HttpError(401, "未登录"));
  next();
}

export function requireRoles(...roles: Actor["role"][]) {
  return (req: Request, _res: Response, next: (error?: unknown) => void) => {
    if (!req.actor) return next(new HttpError(401, "未登录"));
    if (!roles.includes(req.actor.role)) {
      return next(new HttpError(403, "没有权限执行该操作"));
    }
    next();
  };
}

export function blockIfPasswordChangeRequired(req: Request, _res: Response, next: (error?: unknown) => void) {
  if (!req.actor?.mustChangePassword) return next();
  const allowed =
    req.method === "GET" &&
    ["/api/auth/me", "/api/auth/csrf", "/api/auth/meta", "/api/health", "/health"].includes(req.path);
  const changing =
    req.method === "POST" && (req.path === "/api/auth/change-password" || req.path === "/api/auth/logout");
  if (allowed || changing) return next();
  next(new HttpError(403, "首次登录须先修改密码", "PASSWORD_CHANGE_REQUIRED"));
}

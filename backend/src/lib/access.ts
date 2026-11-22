import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../types.js";

// Role boundaries apply before routers, so hidden UI never substitutes for authorization.
export function enforceRoleBoundary(req: Request, _res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/") || !req.actor) return next();
  const read = ["GET", "HEAD"].includes(req.method);
  const role = req.actor.role;
  if (role === "warehouse") {
    if (!(req.path === "/api/modules" && read) && !/^\/api\/warehouse(\/|$)/.test(req.path)) return next(new HttpError(403, "库房仅可登记和查看对外结账单，实际付款由财务登记"));
  }
  if (role === "assistant" && !(req.path === "/api/modules" && read)) return next(new HttpError(403, "助理审核流程已停用，请联系管理员调整角色"));
  if (role === "admin") {
    if (!/^\/api\/(admin|modules)(\/|$)/.test(req.path)) return next(new HttpError(403, "后台管理员仅管理登录账号、小组和系统配置；客服接待账号由本组主管管理"));
  } else if (role === "finance") {
    if (!/^\/api\/(finance|salaries|ad-accounts)(\/|$)/.test(req.path) && !(req.path === "/api/modules" && read)) return next(new HttpError(403, "财务仅可访问收款、第三方结算与工资核算"));
  } else if (role === "boss") {
    if (!read) return next(new HttpError(403, "BOSS 账号仅可查看和筛选业务数据"));
    if (/^\/api\/admin(\/|$)/.test(req.path)) return next(new HttpError(403, "账号和小组由后台管理员维护"));
  } else if (role === "cs_supervisor") {
    const metadata = req.path === "/api/modules" && read;
    const fans = (/^\/api\/fan-reports\/(summary|period-summary|export)$/.test(req.path) || /^\/api\/fan-leads(\/|$)/.test(req.path)) && read;
    const orders = (/^\/api\/orders(\/export)?\/?$/.test(req.path) || /^\/api\/order-records(\/|$)/.test(req.path)) && read;
    const accounts = /^\/api\/cs-accounts(\/|$)/.test(req.path);
    // 唯一写入例外：登记／撤销本组订单的跑单。路由内再按业务日历史小组范围校验。
    const uuidPart = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    const cancellation = req.method === "POST" && new RegExp(`^/api/order-records/${uuidPart}/cancellations(/${uuidPart}/void)?/?$`, "i").test(req.path);
    const peopleRead = read && (req.path === "/api/assessment/foundation" || req.path === "/api/report-history" || req.path === "/api/customer-reviews");
    const reviewWrite = req.method === "POST" && /^\/api\/customer-reviews\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(req.path);
    const csLogins = (req.path === "/api/cs-logins" && ["GET", "HEAD", "POST"].includes(req.method))
      || (req.method === "PATCH" && new RegExp(`^/api/cs-logins/${uuidPart}/teams/?$`, "i").test(req.path));
    const followups = req.path === "/api/supervisor/order-followups" && (read || req.method === "POST");
    const consultationCost = read && req.path === "/api/supervisor/consultation-cost";
    const bindings = /^\/api\/cs-device-bindings(?:\/(.*))?$/.test(req.path);
    if (!metadata && !fans && !orders && !accounts && !cancellation && !peopleRead && !reviewWrite && !csLogins && !followups && !consultationCost && !bindings) return next(new HttpError(403, "客服主管仅可操作负责小组内的业务"));
  }
  next();
}

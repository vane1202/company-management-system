import { Router } from "express";
import type { Pool } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne } from "../db.js";
import { isIsoDate, toDateOnly } from "../lib/dates.js";
import { formatMoney, parseMoney } from "../lib/money.js";
import { HttpError } from "../types.js";
import { isBossOrAdmin } from "../users.js";

export function createSalaryRouter(db: Pool): Router {
  const router = Router();

  router.use((req, _res, next) => {
    if (!req.actor || !isBossOrAdmin(req.actor)) {
      next(new HttpError(403, "无权查看或维护工资"));
      return;
    }
    next();
  });

  router.get("/", async (req, res, next) => {
    try {
      const userId = String(req.query.userId ?? "");
      const rows = await query(
        db,
        `SELECT s.*, u.display_name, u.username
           FROM salaries s
           JOIN users u ON u.id = s.user_id
          WHERE ($1 = '' OR s.user_id::text = $1)
          ORDER BY u.display_name, s.effective_from DESC`,
        [userId]
      );
      res.json({
        salaries: rows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          displayName: row.display_name,
          username: row.username,
          monthlyAmount: formatMoney(row.monthly_amount),
          effectiveFrom: toDateOnly(row.effective_from),
          effectiveTo: row.effective_to ? toDateOnly(row.effective_to) : null,
          createdAt: row.created_at
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const userId = String(req.body?.userId ?? "");
      const monthlyAmount = parseMoney(req.body?.monthlyAmount, "月基本工资");
      const effectiveFrom = String(req.body?.effectiveFrom ?? "");
      const effectiveTo = req.body?.effectiveTo ? String(req.body.effectiveTo) : null;
      if (!userId) throw new HttpError(400, "请选择员工");
      if (!isIsoDate(effectiveFrom)) throw new HttpError(400, "生效开始日无效");
      if (effectiveTo && !isIsoDate(effectiveTo)) throw new HttpError(400, "生效结束日无效");
      try {
        const saved = await queryOne(
          db,
          `INSERT INTO salaries (user_id, monthly_amount, effective_from, effective_to, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [userId, monthlyAmount, effectiveFrom, effectiveTo, req.actor!.id]
        );
        await writeAudit(db, {
          actorId: req.actor!.id,
          action: "salary_create",
          entityType: "salary",
          entityId: saved!.id,
          after: { userId, monthlyAmount, effectiveFrom, effectiveTo },
          ip: req.ip
        });
        res.status(201).json({
          salary: {
            id: saved!.id,
            userId: saved!.user_id,
            monthlyAmount: formatMoney(saved!.monthly_amount),
            effectiveFrom: toDateOnly(saved!.effective_from),
            effectiveTo: saved!.effective_to ? toDateOnly(saved!.effective_to) : null
          }
        });
      } catch (error) {
        if (isExclusion(error)) throw new HttpError(409, "该员工在此期间已有工资记录，不能重叠");
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function isExclusion(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "23P01";
}

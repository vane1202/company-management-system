import type { Pool } from "pg";
import type { CommissionInput } from "./commissionCalc.js";

export async function commissionInputs(db: Pick<Pool, "query">, firstDay: string, ownerId?: string, throughDate?: string) {
  const { rows } = await db.query<CommissionInput & { channel: "live" | "private" }>(`
        SELECT json_build_object('id', o.id, 'business_date', o.business_date::text,
          'order_ref', o.order_ref, 'status', o.status, 'material_cost_cny', o.material_cost_cny::text,
          'cancelled', EXISTS (SELECT 1 FROM order_cancellations x WHERE x.order_id=o.id AND x.voided_at IS NULL)) AS "order",
          json_build_object('hostName', d.host_name, 'operatorName', d.operator_name) AS details,
          COALESCE(d.deal_channel, 'live') AS channel,
          COALESCE((SELECT json_agg(json_build_object('price_cny', i.price_cny::text, 'buying_fee_cny', i.buying_fee_cny::text)) FROM order_items i WHERE i.order_id=o.id), '[]'::json) AS items,
          COALESCE((SELECT json_agg(json_build_object('amount_cny', a.amount_cny::text)) FROM order_charges a WHERE a.order_id=o.id AND a.voided_at IS NULL), '[]'::json) AS charges,
          COALESCE((SELECT json_agg(json_build_object('category', e.category, 'amount_cny', e.amount_cny::text)) FROM order_expenses e WHERE e.order_id=o.id AND e.voided_at IS NULL), '[]'::json) AS expenses
        FROM orders o LEFT JOIN order_details d ON d.order_id=o.id
        WHERE o.business_date >= $1::date AND o.business_date < $1::date + interval '1 month'
          AND ($2::uuid IS NULL OR o.user_id=$2)
          AND ($3::date IS NULL OR o.business_date<=$3)
        ORDER BY o.business_date, o.id`, [firstDay, ownerId ?? null, throughDate ?? null]);
  return rows;
}

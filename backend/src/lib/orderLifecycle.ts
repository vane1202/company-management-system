import type { PoolClient } from 'pg';
import { addMoney } from './money.js';
import { textField } from './commerce.js';

export function orderIdentity(b: Record<string, unknown>) {
  return {
    personaCode: textField(b.personaCode ?? '', '人设ID', 64, false),
    liveRoomCode: textField(b.liveRoomCode ?? '', '直播间编号', 64, b.dealChannel !== 'private'),
    hostName: textField(b.hostName ?? '', '主播姓名', 64, b.dealChannel !== 'private'),
    customerCode: textField(b.customerCode ?? '', '客户ID', 64, false)
  };
}
export async function effectiveDue(c: PoolClient, id: string, base: string): Promise<string> {
  const row = (await c.query("SELECT COALESCE(sum(customer_amount),0)::text AS total FROM order_charges WHERE order_id=$1 AND voided_at IS NULL", [id])).rows[0];
  return addMoney([base, row.total]);
}
export async function syncOrderAmounts(c: PoolClient, id: string) {
  await c.query(`UPDATE orders SET amount=(SELECT COALESCE(sum(price_cny+buying_fee_cny),0) FROM order_items WHERE order_id=$1)+(SELECT COALESCE(sum(amount_cny),0) FROM order_charges WHERE order_id=$1 AND voided_at IS NULL),updated_at=now(),review_version=review_version+1 WHERE id=$1`, [id]);
  await c.query('UPDATE order_details SET version=version+1 WHERE order_id=$1', [id]);
}

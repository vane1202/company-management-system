import { describe, expect, it } from "vitest";
import type { OrderRecord } from "../api";
import { commissionLine, commissionPeople, commissionSummary, cutOf } from "./commissionCalc";

function record(patch: Partial<OrderRecord["order"]> = {}, extra: Partial<OrderRecord> = {}): OrderRecord {
  return {
    legacy: false,
    order: { id: "o1", order_ref: "A", customer_label: "guest", business_date: "2026-11-08", amount: "1100.00", status: "placed", display_name: "", custom_product_cost: "0.00", labor_cost: "0.00", shipping_cost: "0.00", material_cost_cny: "900.00", ...patch },
    details: { personaName: "", operatorName: "cs", hostName: "host", source: "", customerCurrency: "CNY", customerDue: "1100.00", shippedOn: null, version: 1, dealChannel: "live" },
    items: [{ id: "i", label: "jade", material_ref: "1", kind: "material", price_cny: "1000.00", buying_fee_cny: "100.00" }],
    expenses: [{ id: "e", business_date: "2026-11-08", category: "shipping", label: "ship", amount_cny: "20.00", voided_at: null }, { id: "g", business_date: "2026-11-08", category: "goods", label: "goods", amount_cny: "500.00", voided_at: null }],
    charges: [],
    ...extra
  };
}

describe("commission", () => {
  it("uses net profit and does not count goods twice", () => {
    const line = commissionLine(record(), "live");
    expect(line.status).toBe("ready");
    expect(line.revenueCents).toBe(110000);
    expect(line.costCents).toBe(92000);
    expect(line.netCents).toBe(18000);
    expect(line.hostCents).toBe(cutOf(18000, 1000));
    expect(line.csCents).toBe(cutOf(18000, 500));
  });
  it("adds customer charges and private rates, leaving host blank", () => {
    const source = record({ material_cost_cny: "400.00" }, { details: { personaName: "", operatorName: "cs", hostName: "", source: "", customerCurrency: "CNY", customerDue: "600.00", shippedOn: null, version: 1 }, charges: [{ id: "c", business_date: "2026-11-08", label: "carve", amount_cny: "50.00", customer_amount: "50.00", note: "", voided_at: null }] });
    const line = commissionLine(source, "private");
    expect(line.netCents).toBe(100000 + 5000 - 40000 - 2000);
    expect(line.csCents).toBe(cutOf(line.netCents, 1000));
    expect(line.hostCents).toBeNull();
  });
  it("holds incomplete costs and reverses cancellations", () => {
    expect(commissionLine(record({ material_cost_cny: "" }), "live").pendingReason).toBe("料子本钱未登记");
    expect(commissionLine(record({}, { expenses: [] }), "live").pendingReason).toBe("发货成本未登记");
    const reversed = commissionLine(record({ cancelled: true }), "live");
    expect(reversed.status).toBe("reversed");
    expect(reversed.netCents).toBe(0);
  });
  it("pays the supervisor from ready net profit only", () => {
    const ready = commissionLine(record(), "live");
    const pending = commissionLine(record({ id: "o2", material_cost_cny: null }), "live");
    const summary = commissionSummary([ready, pending]);
    expect(summary.pending).toBe(1);
    expect(summary.supervisor).toBe(cutOf(ready.netCents, 500));
    expect(commissionPeople([ready]).hosts[0]).toEqual({ name: "host", cents: ready.hostCents });
    expect(summary.unassigned).toBe(0);
  });
});

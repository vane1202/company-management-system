import { afterEach, describe, expect, it, vi } from "vitest";
import { changeScopeAccount, readScopePreference, scopeAccounts } from "./opsScope";
const accounts = [{ id: "a", label: "a", platform: "Facebook", personas: ["A", "shared"] }, { id: "b", label: "b", platform: "Facebook", personas: ["B", "shared"] }];
afterEach(() => vi.unstubAllGlobals());
describe("首页广告户与人设范围", () => {
  it("广告户联动人设，兼容时保留，冲突时恢复全部；单独人设可跨本人账户", () => {
    expect(changeScopeAccount({ account: "a", persona: "A", platform: "" }, "b", accounts).persona).toBe("");
    expect(changeScopeAccount({ account: "a", persona: "shared", platform: "" }, "b", accounts).persona).toBe("shared");
    expect(scopeAccounts({ account: "", persona: "shared", platform: "" }, accounts).map(a => a.id)).toEqual(["a", "b"]);
    expect(scopeAccounts({ account: "b", persona: "shared", platform: "" }, accounts).map(a => a.id)).toEqual(["b"]);
  });
  it("按本人恢复筛选及日期，损坏或未来日期不用于查询", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => store.get(key) || null });
    store.set("person-a", JSON.stringify({ filters: { account: "a", persona: "A" }, preset: "custom", range: { from: "2026-11-01", to: "2026-11-14" } }));
    expect(readScopePreference("person-a", "2026-11-15").filters.account).toBe("a");
    expect(readScopePreference("person-b", "2026-11-15").filters.account).toBe("");
    expect(readScopePreference("person-a", "2026-11-10").preset).toBe("day");
    store.set("person-a", "broken");
    expect(readScopePreference("person-a", "2026-11-15").filters.persona).toBe("");
  });
});

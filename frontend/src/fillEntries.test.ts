import { describe, expect, it } from "vitest";
import { canUseFillEntry, fillEntryFromPath, fillLink, isLocalOnlyOrigin } from "./fillEntries";
import { navItems } from "./access";

describe("客服固定填报入口", () => {
  it("识别两个独立入口和尾斜线，不接受任意外部跳转", () => {
    expect(fillEntryFromPath("/fill/fans")).toBe("fans");
    expect(fillEntryFromPath("/fill/orders/")).toBe("orders");
    expect(fillEntryFromPath("https://example.com/fill/fans")).toBeNull();
    expect(fillEntryFromPath("/fill/dashboard")).toBeNull();
  });
  it("相同入口按登录客服身份工作，不在链接中指定或冒充员工", () => {
    expect(fillLink("https://internal.example.com", "fans")).toBe("https://internal.example.com/fill/fans");
    expect(fillLink("https://internal.example.com", "orders")).toBe("https://internal.example.com/fill/orders");
    expect(fillLink("https://internal.example.com", "fans")).not.toContain("userId");
    expect(canUseFillEntry("cs", "fans")).toBe(true);
    expect(canUseFillEntry("cs", "orders")).toBe(true);
  });
  it("主管查看本组汇总，不进入客服填报入口", () => {
    expect(canUseFillEntry("cs_supervisor", "fans")).toBe(false);
    expect(canUseFillEntry("cs_supervisor", "orders")).toBe(false);
    for (const role of ["boss", "admin", "assistant", "ops", "editor"] as const) {
      expect(canUseFillEntry(role, "fans")).toBe(false);
      expect(canUseFillEntry(role, "orders")).toBe(false);
    }
  });
  it("区分客服填报与管理汇总，防止把本机链接当成远程地址", () => {
    expect(navItems("cs").find((item) => item.id === "orders")?.label).toBe("订单填报");
    expect(navItems("boss").find((item) => item.id === "orders")?.label).toBe("直播间经营");
    expect(navItems("boss").some((item) => item.id === "summary")).toBe(true);
    expect(isLocalOnlyOrigin("http://127.0.0.1:13080")).toBe(true);
    expect(isLocalOnlyOrigin("https://internal.example.com")).toBe(false);
  });
});

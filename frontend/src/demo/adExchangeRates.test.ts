import { describe, expect, it, vi } from "vitest";
import { convertAdSpend, createAdFxClient, FX_REFRESH_MS, type FxQuote } from "./adExchangeRates";

const clock = Date.parse("2026-11-12T05:30:00Z");
const quote = (date: string, rate = "7.000000"): FxQuote => ({ currency: "USD", date, rate, updatedAt: "2026-11-12T05:15:00Z", checkedAt: clock, source: "Exchangerate.dev", sourceDate: date, delayed: true, stale: false });
const payload = (rate = 7, timestamp = "2026-11-12T05:15:00Z") => ({ result: "success", base: "USD", rates: { CNY: rate }, effective_at: { CNY: timestamp }, source: "live", stale: { CNY: false } });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("广告参考汇率", () => {
  it("今日按最新汇率；每个消耗日先汇总美元、再折算，跨日累计人民币", async () => {
    const lookup = vi.fn(async (date: string) => quote(date, date === "2026-11-11" ? "6.000000" : "7.000000"));
    const view = await convertAdSpend([{ date: "2026-11-11", amount: "10.00" }, { date: "2026-11-12", amount: "12.20" }, { date: "2026-11-12", amount: "7.00" }], "29.20", lookup);
    expect(view.cny).toBe("194.40");
    expect(view.usd).toBe("29.20");
    expect(lookup.mock.calls.map(([date]) => date)).toEqual(["2026-11-11", "2026-11-12"]);
  });
  it("每天独立精确四舍五入到分", async () => {
    const view = await convertAdSpend([{ date: "2026-11-11", amount: "0.01" }, { date: "2026-11-12", amount: "0.01" }], "0.02", async date => quote(date, "6.500000"));
    expect(view.cny).toBe("0.14");
  });
  it("某天缺汇率时不显示部分折算合计或用今日汇率补历史", async () => {
    const view = await convertAdSpend([{ date: "2026-11-11", amount: "10.00" }, { date: "2026-11-12", amount: "20.00" }], "30.00", async date => date === "2026-11-11" ? null : quote(date));
    expect(view.cny).toBeNull(); expect(view.missingDates).toEqual(["2026-11-11"]); expect(view.usd).toBe("30.00");
  });
  it("明细与汇总不一致或未分类记录存在时显示待折算", async () => {
    expect((await convertAdSpend([], "29.20", async date => quote(date))).cny).toBeNull();
    expect((await convertAdSpend([{ date: "2026-11-12", amount: "29.20" }], "29.20", async date => quote(date), 1)).cny).toBeNull();
  });
  it("真实零保留为零，不需要请求汇率", async () => {
    const lookup = vi.fn(); expect((await convertAdSpend([], "0.00", lookup)).cny).toBe("0.00"); expect(lookup).not.toHaveBeenCalled();
  });
  it("一小时内复用最新汇率，并合并并发请求", async () => {
    let now = clock;
    const fetcher = vi.fn(async () => response(payload()));
    const client = createAdFxClient({ fetcher: fetcher as typeof fetch, storage: null, now: () => now });
    await Promise.all([client.get("2026-11-12"), client.get("2026-11-12")]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += FX_REFRESH_MS - 1; await client.get("2026-11-12"); expect(fetcher).toHaveBeenCalledTimes(1);
    now++; await client.get("2026-11-12"); expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.exchangerate.dev/v1/latest/USD?symbols=CNY"); expect(options.credentials).toBe("omit"); expect(options.referrerPolicy).toBe("no-referrer");
  });
  it("历史汇率跨页面重载复用，后续最新汇率不会改变历史折算", async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const fetcher = vi.fn(async (url: string) => response(url.includes("latest") ? payload(7) : { result: "success", base: "USD", date: "2026-11-11", rates: { CNY: 6 }, data_updated_at: "2026-11-11T00:00:00Z" }));
    const first = createAdFxClient({ fetcher: fetcher as typeof fetch, storage, now: () => clock });
    expect((await first.get("2026-11-11"))?.rate).toBe("6.000000");
    const second = createAdFxClient({ fetcher: fetcher as typeof fetch, storage, now: () => clock + FX_REFRESH_MS });
    await second.get("2026-11-12");
    expect((await second.get("2026-11-11"))?.rate).toBe("6.000000"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("刷新失败保留上次成功的最新汇率，并标为更新延迟", async () => {
    let now = clock;
    const fetcher = vi.fn().mockResolvedValueOnce(response(payload())).mockRejectedValue(Error("offline"));
    const client = createAdFxClient({ fetcher, storage: null, now: () => now });
    await client.get("2026-11-12"); now += FX_REFRESH_MS;
    const old = await client.get("2026-11-12"); expect(old?.rate).toBe("7.000000"); expect(old?.stale).toBe(true);
    await client.get("2026-11-12"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("拒绝非法汇率、错误币种及未来行情", async () => {
    for (const bad of [{ ...payload(), base: "EUR" }, payload(-1), payload(0), payload(Infinity), payload(7, "2099-01-01T00:00:00Z")]) {
      const client = createAdFxClient({ fetcher: vi.fn(async () => response(bad)) as typeof fetch, storage: null, now: () => clock });
      expect(await client.get("2026-11-12")).toBeNull();
    }
  });
  it("本地缓存不可用仍可请求；周末沿用服务明确返回的上一发布日并保留日期", async () => {
    const storage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("full"); } };
    const fetcher = vi.fn(async () => response({ result: "success", base: "USD", date: "2026-11-06", rates: { CNY: 6.8 }, data_updated_at: "2026-11-06T00:00:00Z", is_forward_filled: true }));
    const client = createAdFxClient({ fetcher: fetcher as typeof fetch, storage, now: () => clock });
    const saved = await client.get("2026-11-07"); expect(saved?.date).toBe("2026-11-07"); expect(saved?.sourceDate).toBe("2026-11-06");
  });
  it("跨日后重新获取最新行情，旧最新缓存不当成昨天的定稿汇率", async () => {
    let now = clock;
    const fetcher = vi.fn(async (url: string) => response(url.includes("latest") ? payload(7) : { result: "success", base: "USD", date: "2026-11-12", rates: { CNY: 6.9 }, data_updated_at: "2026-11-12T00:00:00Z" }));
    const client = createAdFxClient({ fetcher: fetcher as typeof fetch, storage: null, now: () => now });
    await client.get("2026-11-12"); now += 86400000;
    expect((await client.get("2026-11-12"))?.rate).toBe("6.900000");
    expect(fetcher.mock.calls[1][0]).toContain("/2026-11-12/USD");
  });
});

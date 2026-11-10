import { describe, expect, it } from "vitest";
import { createToastStore, MAX_TOASTS, SUCCESS_TIMEOUT_MS } from "./toastStore";

function fakeTimer() {
  let now = 0, seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    timer: { set: (fn: () => void, ms: number) => { const id = ++seq; pending.set(id, { at: now + ms, fn }); return id; }, clear: (h: unknown) => { pending.delete(h as number); } },
    advance(ms: number) { now += ms; for (const [id, t] of [...pending]) if (t.at <= now) { pending.delete(id); t.fn(); } }
  };
}

describe("角落轻提示", () => {
  it("成功约 3 秒后自动消失", () => {
    const clock = fakeTimer(), store = createToastStore(clock.timer);
    store.success("张三：已录入提成 ¥ 300.00");
    expect(store.getItems()).toHaveLength(1);
    clock.advance(SUCCESS_TIMEOUT_MS - 1);
    expect(store.getItems()).toHaveLength(1);
    clock.advance(1);
    expect(store.getItems()).toHaveLength(0);
  });
  it("失败不自动消失，需手动关闭；相同失败不重复堆叠", () => {
    const clock = fakeTimer(), store = createToastStore(clock.timer);
    const id = store.error("网络中断，本次未保存，请检查网络后重试");
    store.error("网络中断，本次未保存，请检查网络后重试");
    clock.advance(60_000);
    expect(store.getItems()).toEqual([{ id, kind: "error", text: "网络中断，本次未保存，请检查网络后重试" }]);
    store.dismiss(id);
    expect(store.getItems()).toHaveLength(0);
  });
  it("超出上限时先挤掉最早的成功提示，保留失败提示", () => {
    const clock = fakeTimer(), store = createToastStore(clock.timer);
    store.error("失败 A");
    for (let i = 0; i < MAX_TOASTS; i += 1) store.success(`成功 ${i}`);
    const items = store.getItems();
    expect(items).toHaveLength(MAX_TOASTS);
    expect(items[0]).toMatchObject({ kind: "error", text: "失败 A" });
    expect(items.some((item) => item.text === "成功 0")).toBe(false);
  });
  it("空文案不显示；订阅者会收到变化；clear 清空", () => {
    const clock = fakeTimer(), store = createToastStore(clock.timer);
    let calls = 0; const off = store.subscribe(() => { calls += 1; });
    expect(store.success("  ")).toBe(-1);
    store.success("已保存");
    store.clear();
    off();
    store.success("不再通知");
    expect(calls).toBe(2);
    expect(store.getItems()).toHaveLength(1);
  });
});

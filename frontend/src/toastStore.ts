/** 角落轻提示的状态（不依赖 React，便于单测）。成功约 3 秒自动消失；失败一直保留，需手动关闭。 */
export type ToastKind = "success" | "error";
export type ToastItem = { id: number; kind: ToastKind; text: string };

export const SUCCESS_TIMEOUT_MS = 3000;
/** 同时最多显示的条数；超出时先挤掉最早的成功提示，失败提示只有在全是失败时才挤掉最早一条。 */
export const MAX_TOASTS = 4;

type Timer = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

export function createToastStore(timer: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }) {
  let items: ToastItem[] = [];
  let seq = 0;
  const timers = new Map<number, unknown>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  function dismiss(id: number) {
    const handle = timers.get(id);
    if (handle !== undefined) { timer.clear(handle); timers.delete(id); }
    const next = items.filter((item) => item.id !== id);
    if (next.length !== items.length) { items = next; emit(); }
  }

  function push(kind: ToastKind, text: string): number {
    const message = text.trim();
    if (!message) return -1;
    // 同一条失败已在显示时不重复堆叠。
    const same = items.find((item) => item.kind === kind && item.text === message);
    if (same && kind === "error") return same.id;
    if (same) dismiss(same.id);
    const id = ++seq;
    let next = [...items, { id, kind, text: message }];
    while (next.length > MAX_TOASTS) {
      const drop = next.find((item) => item.kind === "success") ?? next[0];
      const handle = timers.get(drop.id);
      if (handle !== undefined) { timer.clear(handle); timers.delete(drop.id); }
      next = next.filter((item) => item.id !== drop.id);
    }
    items = next;
    if (kind === "success") timers.set(id, timer.set(() => { timers.delete(id); dismiss(id); }, SUCCESS_TIMEOUT_MS));
    emit();
    return id;
  }

  return {
    success: (text: string) => push("success", text),
    error: (text: string) => push("error", text),
    dismiss,
    clear() { for (const handle of timers.values()) timer.clear(handle); timers.clear(); items = []; emit(); },
    getItems: () => items,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
  };
}

export const toast = createToastStore();

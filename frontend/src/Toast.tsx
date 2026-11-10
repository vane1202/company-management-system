import { useSyncExternalStore } from "react";
import { toast, type ToastItem } from "./toastStore";

export { toast };

/**
 * 角落轻提示：桌面在右下角；手机放在底部导航上方并留安全区，不额外遮挡底栏。
 * 成功放在常驻的 polite 区（role=status），失败放在常驻的 alert 区，读屏都能播报。
 */
export function ToastHost() {
  const items = useSyncExternalStore(toast.subscribe, toast.getItems, toast.getItems);
  const success = items.filter((item) => item.kind === "success");
  const errors = items.filter((item) => item.kind === "error");
  return <div className="toast-host">
    <div className="toast-region" role="alert" aria-live="assertive">{errors.map((item) => <ToastCard key={item.id} item={item} />)}</div>
    <div className="toast-region" role="status" aria-live="polite">{success.map((item) => <ToastCard key={item.id} item={item} />)}</div>
  </div>;
}

function ToastCard({ item }: { item: ToastItem }) {
  return <div className={`toast toast-${item.kind}`}>
    <span className="toast-mark" aria-hidden="true">{item.kind === "success" ? "✓" : "!"}</span>
    <p>{item.kind === "error" ? <span className="sr-only">操作失败：</span> : null}{item.text}</p>
    <button type="button" className="toast-close" aria-label="关闭提示" onClick={() => toast.dismiss(item.id)}>×</button>
  </div>;
}

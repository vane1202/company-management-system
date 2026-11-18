import { useEffect, useId, useRef, useState } from "react";
import { computeTipPosition, type TipPosition } from "./infoTipPosition";

/**
 * 口径说明的 ⓘ：点按（手机）或点击/键盘（桌面）打开，点外面、Esc、滚动时关闭。
 * 用固定定位并夹在视口内，窄屏不溢出。不可放进另一个 <button> 里。
 */
export function InfoTip({ text, label = "口径说明", scrollable = false, inline = false }: { text: string; label?: string; scrollable?: boolean; inline?: boolean }) {
  const [pos, setPos] = useState<TipPosition | "inline" | null>(null);
  const id = useId(), ref = useRef<HTMLSpanElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setPos(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setPos(null); button.current?.focus(); } };
    const hide = (e: Event) => { if (!scrollable || !ref.current?.contains(e.target as Node)) setPos(null); };
    // Let the click finish before collapsing an inline tip, which moves the controls below it.
    const outsideEvent = inline ? "click" : "pointerdown";
    document.addEventListener(outsideEvent, close);
    document.addEventListener("keydown", esc);
    if (!inline) {
      window.addEventListener("scroll", hide, { passive: true, capture: true });
      window.addEventListener("resize", hide);
    }
    return () => { document.removeEventListener(outsideEvent, close); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", hide, { capture: true }); window.removeEventListener("resize", hide); };
  }, [pos, scrollable, inline]);
  function toggle() {
    if (pos) { setPos(null); return; }
    setPos(inline ? "inline" : computeTipPosition(button.current!.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
  }
  return <span className={inline ? "info-tip info-tip-inline" : "info-tip"} ref={ref}>
    <button ref={button} type="button" className="info-tip-button" aria-label={label} aria-expanded={!!pos} aria-describedby={pos ? id : undefined} onClick={e => { e.stopPropagation(); toggle(); }}>ⓘ</button>
    {pos === "inline" && <span role="tooltip" id={id} className="info-tip-pop info-tip-pop-inline">{text}</span>}
    {pos && pos !== "inline" && <span role="tooltip" id={id} className="info-tip-pop" style={{ left: pos.left, width: pos.width, ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }), ...(scrollable ? { maxHeight: pos.maxHeight, overflowY: "auto" as const } : {}) }}>{text}</span>}
  </span>;
}

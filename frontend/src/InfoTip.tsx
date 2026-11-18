import { useEffect, useId, useRef, useState } from "react";
import { computeTipPosition, type TipPosition } from "./infoTipPosition";

/**
 * 口径说明的 ⓘ：点按（手机）或点击/键盘（桌面）打开，点外面、Esc、滚动时关闭。
 * 用固定定位并夹在视口内，窄屏不溢出。不可放进另一个 <button> 里。
 */
export function InfoTip({ text, label = "口径说明", scrollable = false }: { text: string; label?: string; scrollable?: boolean }) {
  const [pos, setPos] = useState<TipPosition | null>(null);
  const id = useId(), ref = useRef<HTMLSpanElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setPos(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setPos(null); button.current?.focus(); } };
    const hide = (e: Event) => { if (!scrollable || !ref.current?.contains(e.target as Node)) setPos(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    window.addEventListener("resize", hide);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", hide, { capture: true }); window.removeEventListener("resize", hide); };
  }, [pos, scrollable]);
  function toggle() {
    if (pos) { setPos(null); return; }
    setPos(computeTipPosition(button.current!.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
  }
  return <span className="info-tip" ref={ref}>
    <button ref={button} type="button" className="info-tip-button" aria-label={label} aria-expanded={!!pos} aria-describedby={pos ? id : undefined} onClick={e => { e.stopPropagation(); toggle(); }}>ⓘ</button>
    {pos && <span role="tooltip" id={id} className="info-tip-pop" style={{ left: pos.left, width: pos.width, ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }), ...(scrollable ? { maxHeight: pos.maxHeight, overflowY: "auto" as const } : {}) }}>{text}</span>}
  </span>;
}

import { useEffect, useId, useRef, useState } from "react";

/**
 * 口径说明的 ⓘ：点按（手机）或点击/键盘（桌面）打开，点外面、Esc、滚动时关闭。
 * 用固定定位并夹在视口内，窄屏不溢出。不可放进另一个 <button> 里。
 */
export function InfoTip({ text, label = "口径说明" }: { text: string; label?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const id = useId(), ref = useRef<HTMLSpanElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setPos(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setPos(null); button.current?.focus(); } };
    const hide = () => setPos(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    window.addEventListener("resize", hide);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", hide, { capture: true }); window.removeEventListener("resize", hide); };
  }, [pos]);
  function toggle() {
    if (pos) { setPos(null); return; }
    const r = button.current!.getBoundingClientRect(), width = Math.min(280, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    setPos({ top: r.bottom + 6, left, width });
  }
  return <span className="info-tip" ref={ref}>
    <button ref={button} type="button" className="info-tip-button" aria-label={label} aria-expanded={!!pos} aria-describedby={pos ? id : undefined} onClick={e => { e.stopPropagation(); toggle(); }}>ⓘ</button>
    {pos && <span role="tooltip" id={id} className="info-tip-pop" style={{ top: pos.top, left: pos.left, width: pos.width }}>{text}</span>}
  </span>;
}

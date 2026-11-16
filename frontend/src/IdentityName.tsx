import { useState } from "react";

const storageKey = "cms.identity-name-hidden";

export function useIdentityPrivacy(userId?: string) {
  const [preferences, setPreferences] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) || "{}") || {}; }
    catch { return {}; }
  });
  const hidden = !!(userId && preferences[userId]);
  function toggle() {
    if (!userId) return;
    setPreferences(previous => {
      const next = { ...previous, [userId]: !previous[userId] };
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the toggle usable without storage. */ }
      return next;
    });
  }
  function reset() {
    setPreferences({});
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be unavailable. */ }
  }
  return { hidden, toggle, reset };
}

export function identityLabel(name: string, hidden: boolean) {
  const letters = Array.from(name.trim());
  if (!letters.length) return "未设置姓名";
  return hidden ? "＊".repeat(Math.max(1, letters.length - 1)) + letters.at(-1) : name.trim();
}

export function IdentityName({ name, hidden, onToggle }: { name: string; hidden: boolean; onToggle: () => void }) {
  const action = hidden ? "显示姓名" : "隐藏姓名";
  return <button type="button" className="identity-name" aria-label={action} aria-pressed={hidden} title={action} onClick={onToggle}>
    <span>{identityLabel(name, hidden)}</span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {hidden ? <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.8 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7a19 19 0 0 1-3.2 3.9M6.2 6.2A19 19 0 0 0 2 12s4 7 10 7a11 11 0 0 0 5.8-1.8" /></> : <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
    </svg>
  </button>;
}

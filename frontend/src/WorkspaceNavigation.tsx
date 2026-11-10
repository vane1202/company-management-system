import { useLayoutEffect, useRef, useState } from "react";
import type { Page } from "./access";
import type { Role } from "./api";
import { WorkspaceHistory, readWorkspaceRoute, type WorkspaceRoute, type WorkspaceSnapshot } from "./workspaceHistory";

export function useWorkspaceNavigation(userId: string | undefined, role: Role | undefined) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>();
  const controller = useRef<WorkspaceHistory>();
  const owner = userId && role ? `${userId}:${role}` : "";
  useLayoutEffect(() => {
    if (!owner || !role) { setSnapshot(undefined); return; }
    const history = new WorkspaceHistory(window, owner, role, setSnapshot);
    controller.current = history;
    setSnapshot(history.snapshot());
    return () => { history.dispose(); controller.current = undefined; };
  }, [owner, role]);
  useLayoutEffect(() => {
    if (!snapshot || snapshot.entry.owner !== owner) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
      window.scrollTo({ top: snapshot.entry.scrollY, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot?.entry.key, owner]);
  const current = snapshot?.entry.owner === owner ? snapshot : undefined;
  const route = current?.entry.route ?? readWorkspaceRoute(window.location.href);
  return {
    route,
    views: current?.views ?? { [route.page]: route },
    navigate: (next: WorkspaceRoute) => controller.current?.navigate(next),
    up: (target?: WorkspaceRoute) => controller.current?.up(target)
  };
}

export function WorkspaceBackbar({ page, detail, homeLabel, pageLabel, onUp, onHome }: { page: Page; detail: boolean; homeLabel: string; pageLabel: string; onUp: () => void; onHome: () => void }) {
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const banner = document.querySelector(".demo-preview-banner");
    if (!banner) return;
    const measure = () => bar.current?.style.setProperty("--workspace-sticky-offset", `${banner.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(banner);
    return () => observer.disconnect();
  }, []);
  return <nav ref={bar} className="workspace-backbar" aria-label="页面返回导航">
    <button type="button" className="workspace-back secondary" onClick={onUp}><span aria-hidden="true">←</span> 返回{detail ? "订单列表" : homeLabel}</button>
    <ol className="workspace-breadcrumb">
      <li><button type="button" onClick={onHome}>{homeLabel}</button></li>
      <li>{detail ? <button type="button" onClick={onUp}>{pageLabel}</button> : <span aria-current="page">{pageLabel}</span>}</li>
      {detail && <li><span aria-current="page">订单详情</span></li>}
    </ol>
    <span className="workspace-mobile-title" aria-live="polite">{detail ? "订单详情" : pageLabel}</span>
  </nav>;
}

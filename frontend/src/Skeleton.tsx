/** 加载占位：固定尺寸的灰块，读屏忽略（外层容器用 aria-busy 表示读取中）。 */
export function Skeleton({ width = "3em", height = "0.9em", block = false, className = "" }: { width?: string; height?: string; block?: boolean; className?: string }) {
  return <span className={`skeleton ${block ? "skeleton-block" : ""} ${className}`} style={{ width, height }} aria-hidden="true" />;
}

/** 启动页：外壳轮廓 + 几块占位，代替纯文字“加载中…”。 */
export function BootSkeleton() {
  return <div className="page boot-skeleton" aria-busy="true">
    <span className="sr-only" role="status">加载中…</span>
    <Skeleton block width="40%" height="1.4rem" />
    <Skeleton block width="100%" height="4.5rem" />
    <Skeleton block width="100%" height="4.5rem" />
    <Skeleton block width="100%" height="4.5rem" />
  </div>;
}

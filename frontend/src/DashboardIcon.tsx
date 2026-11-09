import type { Page } from "./access";

const paths: Record<Page | "refresh" | "arrow", string> = {
  home: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  finance: "M3 5h18v14H3z M3 9h18 M15 14h3 M7 14h2",
  fans: "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21v-2a6 6 0 0 1 12 0v2 M19 7v8 M15 11h8",
  summary: "M3 20h18 M6 16v-5 M12 16V4 M18 16V8",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6",
  ops: "M3 9v6h4l11 5V4L7 9z M7 15l2 6 M21 9v6",
  editor: "M3 5h18v14H3z M3 9h18 M7 5l3 4 M14 5l3 4 M10 12l5 2-5 2z",
  dashboard: "M3 19l6-6 4 3 8-12 M15 4h6v6",
  people: "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21v-2a6 6 0 0 1 12 0v2 M16 3a4 4 0 0 1 0 8 M17 15a5 5 0 0 1 5 5v1",
  csAccounts: "M7 2h10v20H7z M10 5h4 M11 19h2 M10 9h4v5h-4z",
  salaries: "M3 5h18v14H3z M3 9h18 M15 14h3",
  modules: "M4 5h16v6H4z M4 15h16v6H4z M8 8h1 M15 18h1",
  refresh: "M20 8a8 8 0 1 0 0 8 M20 3v5h-5",
  arrow: "M5 12h14 M14 7l5 5-5 5"
};
export function DashboardIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="dashboard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

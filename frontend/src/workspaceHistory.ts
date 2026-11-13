import type { Page } from "./access";
import type { Role } from "./api";
import { canUseFillEntry, fillEntries, fillEntryFromPath } from "./fillEntries";
import { validLiveView, liveViewKey, type LiveView } from './liveBusinessNavigation';

const pages: readonly Page[] = ["home", "finance", "fans", "summary", "orders", "ops", "editor", "dashboard", "people", "csAccounts", "salaries", "modules", "assessment"];
export type WorkspaceRoute = { page: Page; orderId?: string; live?: LiveView; orderList?: true };
type Trail = { key: string; route: WorkspaceRoute; position: number; scrollY: number };
export type WorkspaceEntry = Trail & { owner: string; parents: Trail[] };
export type WorkspaceSnapshot = { entry: WorkspaceEntry; views: Partial<Record<Page, WorkspaceRoute>> };
export type NavigationHost = {
  location: { href: string };
  history: { state: unknown; scrollRestoration: "auto" | "manual"; replaceState(data: unknown, unused: string, url?: string): void; pushState(data: unknown, unused: string, url: string): void; go(delta: number): void };
  readonly scrollY: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
const stateKey = "cmsWorkspaceNavigation";
let sequence = 0;
const newKey = () => `${Date.now().toString(36)}-${++sequence}`;

export function readWorkspaceRoute(href: string): WorkspaceRoute {
  const url = new URL(href);
  const requested = url.searchParams.get("page");
  const pageFromUrl = fillEntryFromPath(url.pathname) ?? (pages.includes(requested as Page) ? requested as Page : "home");
  const page = import.meta.env.MODE === "demo" && url.searchParams.get("role") === "boss" && pageFromUrl === "home" ? "dashboard" : pageFromUrl;
  const id = url.searchParams.get("order");
  const route:WorkspaceRoute = page === "orders" && id && /^[a-z\d_-]{1,128}$/i.test(id) ? { page, orderId: id } : { page };
  if(page==='orders'){
    try{const live=JSON.parse(url.searchParams.get('live')||'null');if(validLiveView(live))route.live=live;}catch{/* Invalid external state falls back to the room list. */}
    if(url.searchParams.get('view')==='orders')route.orderList=true;
  }
  return route;
}
export function workspaceUrl(href: string, route: WorkspaceRoute, role: Role): string {
  const url = new URL(href);
  const fill = route.page === "fans" || route.page === "orders" ? route.page : null;
  url.pathname = fill && canUseFillEntry(role, fill) ? fillEntries[fill].path : "/";
  const demoBossRoot = import.meta.env.MODE === "demo" && role === "boss" && route.page === "dashboard";
  if (route.page === "home" || demoBossRoot || fill && canUseFillEntry(role, fill)) url.searchParams.delete("page");
  else url.searchParams.set("page", route.page);
  if (route.page === "orders" && route.orderId) url.searchParams.set("order", route.orderId);
  else url.searchParams.delete("order");
  if(route.page==='orders'&&route.live)url.searchParams.set('live',JSON.stringify(route.live));else url.searchParams.delete('live');
  if(route.page==='orders'&&route.orderList)url.searchParams.set('view','orders');else url.searchParams.delete('view');
  url.hash = "";
  return url.pathname + url.search;
}
export function sameRoute(a: WorkspaceRoute, b: WorkspaceRoute): boolean { return a.page === b.page && a.orderId === b.orderId && a.orderList===b.orderList && liveViewKey(a.live)===liveViewKey(b.live); }
export function parentRoute(route: WorkspaceRoute): WorkspaceRoute {
  if(route.page==='orders'&&route.orderId){const {orderId,...parent}=route;return parent;}
  if(route.page==='orders'&&route.orderList)return{page:'orders',...(route.live?{live:route.live}:{})};
  if(route.page==='orders'&&route.live&&route.live.view!=='rooms'){const {roomKey,...live}=route.live;return{page:'orders',live:{...live,view:'rooms'}};}
  return{page:'home'};
}
function validTrail(value: unknown): value is Trail {
  const v = value as Trail | null;
  return !!v && typeof v.key === "string" && v.key.length < 100 && Number.isSafeInteger(v.position) && v.position >= 0 && Number.isFinite(v.scrollY) && v.scrollY >= 0 && !!v.route && pages.includes(v.route.page) && (!v.route.orderId || v.route.page === "orders" && typeof v.route.orderId === "string" && /^[a-z\d_-]{1,128}$/i.test(v.route.orderId)) && (!v.route.live||v.route.page==='orders'&&validLiveView(v.route.live)) && (!v.route.orderList||v.route.page==='orders'&&v.route.orderList===true);
}
function stateObject(state: unknown): Record<string, unknown> { return state && typeof state === "object" ? state as Record<string, unknown> : {}; }

/** Owns only this app's history entries; the up button never blindly leaves the site. */
export class WorkspaceHistory {
  private entry: WorkspaceEntry;
  private views: Partial<Record<Page, WorkspaceRoute>> = {};
  private scroll = new Map<string, number>();
  private lastPageScroll: Partial<Record<Page, number>> = {};
  private restoration: "auto" | "manual";
  private onScroll = () => { this.scroll.set(this.entry.key, Math.max(0, this.host.scrollY)); };
  private onHide = () => { this.capture(); };
  private onPop = () => {
    this.onScroll();
    const next = this.readEntry();
    next.scrollY = this.scroll.get(next.key) ?? next.scrollY;
    this.entry = next;
    this.views[next.route.page] = next.route;
    this.write(false);
    this.emit();
  };
  constructor(private host: NavigationHost, private owner: string, private role: Role, private notify: (snapshot: WorkspaceSnapshot) => void) {
    this.entry = this.readEntry();
    this.views[this.entry.route.page] = this.entry.route;
    this.restoration = host.history.scrollRestoration;
    host.history.scrollRestoration = "manual";
    this.write(false);
    host.addEventListener("scroll", this.onScroll);
    host.addEventListener("popstate", this.onPop);
    host.addEventListener("pagehide", this.onHide);
  }
  snapshot(): WorkspaceSnapshot { return { entry: this.entry, views: { ...this.views } }; }
  private readEntry(): WorkspaceEntry {
    const route = readWorkspaceRoute(this.host.location.href);
    const saved = stateObject(this.host.history.state)[stateKey] as WorkspaceEntry | undefined;
    if (validTrail(saved) && saved.owner === this.owner && Array.isArray(saved.parents) && saved.parents.length <= 32 && saved.parents.every(validTrail) && sameRoute(saved.route, route)) return { ...saved, parents: [...saved.parents] };
    return { key: newKey(), route, owner: this.owner, position: 0, scrollY: 0, parents: [] };
  }
  private write(push: boolean) {
    const state = { ...stateObject(this.host.history.state), [stateKey]: this.entry };
    if (push) this.host.history.pushState(state, "", workspaceUrl(this.host.location.href, this.entry.route, this.role));
    else this.host.history.replaceState(state, "");
  }
  private capture() {
    this.entry = { ...this.entry, scrollY: Math.max(0, this.host.scrollY) };
    this.scroll.set(this.entry.key, this.entry.scrollY);
    if (!this.entry.route.orderId && !this.entry.route.live) this.lastPageScroll[this.entry.route.page] = this.entry.scrollY;
    this.write(false);
  }
  private emit() { this.notify(this.snapshot()); }
  navigate(route: WorkspaceRoute) {
    if (sameRoute(route, this.entry.route)) return;
    this.capture();
    const previous = this.entry;
    this.entry = { key: newKey(), route, owner: this.owner, position: previous.position + 1, scrollY: route.orderId || route.live ? 0 : this.lastPageScroll[route.page] ?? 0, parents: [...previous.parents.slice(-31), { key: previous.key, route: previous.route, position: previous.position, scrollY: previous.scrollY }] };
    this.views[route.page] = route;
    this.write(true);
    this.emit();
  }
  up(target = parentRoute(this.entry.route)) {
    this.capture();
    const parent = [...this.entry.parents].reverse().find(entry => sameRoute(entry.route, target) && entry.position < this.entry.position);
    if (parent) { this.host.history.go(parent.position - this.entry.position); return; }
    // Direct links have no in-app parent. Replace the detail instead of returning to an external site.
    this.entry = { key: newKey(), route: target, owner: this.owner, position: this.entry.position, scrollY: this.lastPageScroll[target.page] ?? 0, parents: this.entry.parents };
    this.views[target.page] = target;
    this.host.history.replaceState({ ...stateObject(this.host.history.state), [stateKey]: this.entry }, "", workspaceUrl(this.host.location.href, target, this.role));
    this.emit();
  }
  dispose() {
    this.capture();
    this.host.removeEventListener("scroll", this.onScroll);
    this.host.removeEventListener("popstate", this.onPop);
    this.host.removeEventListener("pagehide", this.onHide);
    this.host.history.scrollRestoration = this.restoration;
  }
}

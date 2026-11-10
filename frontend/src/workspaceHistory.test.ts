import { describe, expect, it } from "vitest";
import { WorkspaceHistory, parentRoute, readWorkspaceRoute, workspaceUrl, type NavigationHost, type WorkspaceSnapshot } from "./workspaceHistory";
import {defaultLiveView} from './liveBusinessNavigation';
import type { Page } from "./access";

class BrowserFixture implements NavigationHost {
  location: { href: string };
  scrollY = 0;
  entries: { href: string; state: unknown }[];
  index = 0;
  goes: number[] = [];
  listeners = new Map<string, Set<() => void>>();
  history: NavigationHost["history"];
  constructor(href = "https://example.test/?role=boss") {
    this.location = { href };
    this.entries = [{ href, state: { unrelatedState: "preserved" } }];
    const host = this;
    this.history = {
      scrollRestoration: "auto",
      get state() { return host.entries[host.index].state; },
      replaceState(state, _unused, url) {
        const href = url === undefined ? host.location.href : new URL(url, host.location.href).href;
        host.entries[host.index] = { href, state: structuredClone(state) };
        host.location.href = href;
      },
      pushState(state, _unused, url) {
        const href = new URL(url, host.location.href).href;
        host.entries.splice(host.index + 1);
        host.entries.push({ href, state: structuredClone(state) });
        host.index++;
        host.location.href = href;
      },
      go(delta) {
        host.goes.push(delta);
        const next = host.index + delta;
        if (next < 0 || next >= host.entries.length) return;
        host.index = next;
        host.location.href = host.entries[next].href;
        host.emit("popstate");
      }
    };
  }
  addEventListener(type: string, handler: () => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(handler); }
  removeEventListener(type: string, handler: () => void) { this.listeners.get(type)?.delete(handler); }
  emit(type: string) { this.listeners.get(type)?.forEach(handler => handler()); }
  scroll(y: number) { this.scrollY = y; this.emit("scroll"); }
}
function setup(href?: string) {
  const browser = new BrowserFixture(href);
  const snapshots: WorkspaceSnapshot[] = [];
  const navigation = new WorkspaceHistory(browser, "boss-id:boss", "boss", snapshot => { snapshots.push(snapshot); browser.scrollY = snapshot.entry.scrollY; });
  return { browser, navigation, snapshots };
}

describe("统一工作台返回与浏览器历史", () => {
  it('财务核定与售后收款为独立明细，日期与直播间上下文可刷新和返回',()=>{
    for(const view of ['paid','afterSales'] as const){
      const route={page:'orders' as const,live:{...defaultLiveView(),view,filters:{room:'LIVE-01',host:'主播甲',persona:'',operator:''}}};
      const url=workspaceUrl('https://example.test/?role=boss',route,'boss');
      const {navigation,browser}=setup('https://example.test'+url);
      expect(readWorkspaceRoute(browser.location.href)).toEqual(route);
      navigation.up();expect(navigation.snapshot().entry.route.live?.view).toBe('rooms');
      expect(navigation.snapshot().entry.route.live?.filters.room).toBe('LIVE-01');
    }
  });
  it('直播间列表、收支与订单逐级返回，保留日期、平台来源筛选和各级位置',()=>{
    const {browser,navigation}=setup();
    const rooms={page:'orders' as const,live:{...defaultLiveView(),range:{from:'2026-11-01',to:'2026-11-10'},filters:{room:'',host:'',persona:'来源甲',operator:'客服甲'}}};
    browser.scroll(260);navigation.navigate(rooms);browser.scroll(420);
    const income={page:'orders' as const,live:{...rooms.live,view:'income' as const,roomKey:'LIVE-02'}};
    navigation.navigate(income);browser.scroll(180);
    navigation.navigate({...income,orderId:'order-02'});
    expect(readWorkspaceRoute(browser.location.href)).toEqual({...income,orderId:'order-02'});
    navigation.up();expect(navigation.snapshot().entry.route).toEqual(income);expect(browser.scrollY).toBe(180);
    navigation.up();expect(navigation.snapshot().entry.route).toEqual(rooms);expect(browser.scrollY).toBe(420);
    navigation.up();expect(navigation.snapshot().entry.route).toEqual({page:'home'});expect(browser.scrollY).toBe(260);
  });
  it('直接打开直播间费用时，返回列表而不离站；刷新可解析相同上下文',()=>{
    const detail={page:'orders' as const,live:{...defaultLiveView(),view:'expenses' as const,roomKey:'__unassigned__'}};
    const url=workspaceUrl('https://example.test/?role=boss',detail,'boss');
    const {navigation,browser}=setup('https://example.test'+url);
    expect(readWorkspaceRoute(browser.location.href)).toEqual(detail);
    navigation.up();expect(navigation.snapshot().entry.route).toEqual({page:'orders',live:defaultLiveView()});
    expect(browser.goes).toEqual([]);
  });
  it('畸形直播间链接不注入筛选或破坏旧订单链接',()=>{
    expect(readWorkspaceRoute('https://example.test/?page=orders&live=bad-json&order=demo-1')).toEqual({page:'orders',orderId:'demo-1'});
    const url=workspaceUrl('https://example.test/?page=orders&view=orders&live=bad-json',{page:'home'},'boss');
    expect(url).toBe('/');
  });
  it("四个汇总目的地均能回首页，原首页位置保持", () => {
    for (const page of ["editor", "summary", "ops", "orders"] as Page[]) {
      const { browser, navigation } = setup();
      browser.scroll(725);
      navigation.navigate({ page });
      expect(readWorkspaceRoute(browser.location.href)).toEqual({ page });
      expect(new URL(browser.location.href).searchParams.get("role")).toBe("boss");
      navigation.up();
      expect(navigation.snapshot().entry.route.page).toBe("home");
      expect(navigation.snapshot().entry.scrollY).toBe(725);
      expect(browser.entries).toHaveLength(2);
      navigation.dispose();
    }
  });
  it("订单详情逐级回列表再回首页，两个层级位置分别恢复", () => {
    const { browser, navigation } = setup();
    browser.scroll(680); navigation.navigate({ page: "orders" });
    browser.scroll(340); navigation.navigate({ page: "orders", orderId: "demo-order-1" });
    expect(parentRoute(navigation.snapshot().entry.route)).toEqual({ page: "orders" });
    navigation.up();
    expect(navigation.snapshot().entry.route).toEqual({ page: "orders" });
    expect(navigation.snapshot().entry.scrollY).toBe(340);
    navigation.up();
    expect(navigation.snapshot().entry.route).toEqual({ page: "home" });
    expect(navigation.snapshot().entry.scrollY).toBe(680);
  });
  it("浏览器后退前进恢复各路由，不反复新增历史或丢失已访问页面", () => {
    const { browser, navigation } = setup();
    navigation.navigate({ page: "summary" }); browser.scroll(190);
    navigation.navigate({ page: "orders" });
    browser.history.go(-1);
    expect(navigation.snapshot().entry.route.page).toBe("summary");
    expect(navigation.snapshot().entry.scrollY).toBe(190);
    browser.history.go(1);
    expect(navigation.snapshot().entry.route.page).toBe("orders");
    expect(Object.keys(navigation.snapshot().views).sort()).toEqual(["home", "orders", "summary"]);
    expect(browser.entries).toHaveLength(3);
  });
  it("直接打开订单详情时返回明确上级，不调用后退离开应用", () => {
    const { browser, navigation } = setup("https://example.test/?role=boss&page=orders&order=demo-order-2");
    navigation.up();
    expect(readWorkspaceRoute(browser.location.href)).toEqual({ page: "orders" });
    expect(browser.goes).toEqual([]);
    expect(browser.entries).toHaveLength(1);
    navigation.up();
    expect(readWorkspaceRoute(browser.location.href)).toEqual({ page: "home" });
  });
  it("从侧栏跨模块后返回首页，跳到首页历史而非另一个模块", () => {
    const { browser, navigation } = setup();
    navigation.navigate({ page: "editor" }); navigation.navigate({ page: "ops" });
    navigation.up();
    expect(browser.goes).toEqual([-2]);
    expect(navigation.snapshot().entry.route.page).toBe("home");
  });
  it("页间切换保留该页最后详情，返回列表才清除详情选择", () => {
    const { navigation } = setup();
    navigation.navigate({ page: "orders" }); navigation.navigate({ page: "orders", orderId: "demo-order-1" });
    navigation.navigate({ page: "summary" });
    expect(navigation.snapshot().views.orders?.orderId).toBe("demo-order-1");
    navigation.up({ page: "orders", orderId: "demo-order-1" });
    navigation.up();
    expect(navigation.snapshot().views.orders).toEqual({ page: "orders" });
  });
  it("刷新初始化读取同一路由，重复点击当前模块不新增历史", () => {
    const { browser, navigation } = setup();
    navigation.navigate({ page: "salaries" }); browser.scroll(80); navigation.dispose();
    const restored = new WorkspaceHistory(browser, "boss-id:boss", "boss", () => {});
    expect(restored.snapshot().entry.route.page).toBe("salaries");
    expect(restored.snapshot().entry.scrollY).toBe(80);
    restored.navigate({ page: "salaries" });
    expect(browser.entries).toHaveLength(2);
  });
  it("切换登录身份后不继承前一身份的返回栈和访问缓存", () => {
    const { browser, navigation } = setup();
    navigation.navigate({ page: "orders" }); navigation.dispose();
    const other = new WorkspaceHistory(browser, "another-id:boss", "boss", () => {});
    expect(other.snapshot().entry.parents).toEqual([]);
    expect(Object.keys(other.snapshot().views)).toEqual(["orders"]);
    other.up(); expect(browser.goes).toEqual([]);
  });
  it("仅接管自己的历史字段，释放监听并恢复原浏览器滚动模式", () => {
    const { browser, navigation } = setup();
    expect(browser.history.scrollRestoration).toBe("manual");
    expect((browser.history.state as any).unrelatedState).toBe("preserved");
    navigation.dispose();
    expect(browser.history.scrollRestoration).toBe("auto");
    expect([...browser.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
  });
  it("管理端页面参数保留演示身份，客服固定入口保持兼容", () => {
    expect(workspaceUrl("https://example.test/?role=finance", { page: "salaries" }, "finance")).toBe("/?role=finance&page=salaries");
    expect(workspaceUrl("https://example.test/?role=boss&page=ops&order=stale", { page: "home" }, "boss")).toBe("/?role=boss");
    expect(workspaceUrl("https://example.test/", { page: "orders", orderId: "valid-id" }, "cs")).toBe("/fill/orders?order=valid-id");
    expect(readWorkspaceRoute("https://example.test/fill/orders?page=home&order=valid-id")).toEqual({ page: "orders", orderId: "valid-id" });
    expect(readWorkspaceRoute("https://example.test/?page=unknown")).toEqual({ page: "home" });
    expect(readWorkspaceRoute("https://example.test/?page=orders&order=../../bad")).toEqual({ page: "orders" });
  });
});

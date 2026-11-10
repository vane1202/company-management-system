import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { httpErrorMessage, isFetchNetworkError, NETWORK_ERROR, NETWORK_ERROR_READ, SERVER_ERROR, SERVER_ERROR_READ, SESSION_EXPIRED, SESSION_EXPIRED_READ, toErrorMessage } from "./errors";

describe("失败原因翻译（纯函数）", () => {
  it("401 只有“未登录”或无文案时视为登录过期；具体 401 原样保留", () => {
    expect(httpErrorMessage(401, "未登录", true)).toBe(SESSION_EXPIRED);
    expect(httpErrorMessage(401, "", true)).toBe("登录已过期，请重新登录；本次内容未保存");
    expect(httpErrorMessage(401, undefined, false)).toBe(SESSION_EXPIRED_READ);
    expect(httpErrorMessage(401, "登录名或密码不正确", true)).toBe("登录名或密码不正确");
  });
  it("5xx 无具体文案（含后端兜底“服务器内部错误”）→ 服务器出错", () => {
    expect(httpErrorMessage(500, "服务器内部错误", true)).toBe(SERVER_ERROR);
    expect(httpErrorMessage(502, undefined, true)).toBe("服务器出错，本次未保存，请稍后重试");
    expect(httpErrorMessage(503, "", false)).toBe(SERVER_ERROR_READ);
    expect(httpErrorMessage(500, "数据库维护中", true)).toBe("数据库维护中");
  });
  it("400/403/409/413 用后端中文原文；无文案时给出状态码", () => {
    expect(httpErrorMessage(400, "业务日无效", true)).toBe("业务日无效");
    expect(httpErrorMessage(403, "仅可填报近 3 个业务日（含今天）", true)).toBe("仅可填报近 3 个业务日（含今天）");
    expect(httpErrorMessage(409, "该员工本月工资单已锁定，需先由财务解锁才能修改项目", true)).toBe("该员工本月工资单已锁定，需先由财务解锁才能修改项目");
    expect(httpErrorMessage(404, "", true)).toBe("请求失败（404）");
  });
  it("浏览器断网的英文 TypeError 翻译为中文；其他错误照旧", () => {
    expect(isFetchNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isFetchNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isFetchNetworkError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isFetchNetworkError(new TypeError("x is undefined"))).toBe(false);
    expect(toErrorMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR);
    expect(toErrorMessage(new Error("无权查看"))).toBe("无权查看");
    expect(toErrorMessage({}, "加载失败")).toBe("加载失败");
  });
});

describe("请求层把失败翻译成中文原因", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const respond = (status: number, body: string) => vi.fn(async () => new Response(body, { status }));

  it("写操作断网：网络中断，本次未保存", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(api.saveOps({})).rejects.toMatchObject({ message: NETWORK_ERROR, code: "NETWORK" });
  });
  it("读取断网：说明未能读取，而不是“未保存”", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Load failed"); }));
    await expect(api.opsReports()).rejects.toMatchObject({ message: NETWORK_ERROR_READ });
  });
  it("写操作 401 未登录 → 登录已过期；登录失败的 401 保留原因", async () => {
    vi.stubGlobal("fetch", respond(401, JSON.stringify({ error: "未登录" })));
    await expect(api.saveOps({})).rejects.toMatchObject({ message: SESSION_EXPIRED, status: 401 });
    vi.stubGlobal("fetch", respond(401, JSON.stringify({ error: "登录名或密码不正确" })));
    await expect(api.login("a", "b")).rejects.toMatchObject({ message: "登录名或密码不正确" });
  });
  it("网关返回非 JSON 的 502 → 服务器出错；409 保留后端原文", async () => {
    vi.stubGlobal("fetch", respond(502, "<html>Bad Gateway</html>"));
    await expect(api.saveOps({})).rejects.toMatchObject({ message: SERVER_ERROR, status: 502 });
    vi.stubGlobal("fetch", respond(409, JSON.stringify({ error: "工资单状态已变更，请刷新后再操作" })));
    await expect(api.saveOps({})).rejects.toMatchObject({ message: "工资单状态已变更，请刷新后再操作" });
  });
});

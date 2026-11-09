import { describe, expect, it } from "vitest";
import { assertNotDemoDatabase, inspectDatabaseUrl } from "./safeDatabase.js";

describe("集成测试数据库安全门槛", () => {
  it("解析地址时不依赖完整连接即可识别库名和端口", () => {
    expect(inspectDatabaseUrl("postgres://cms:secret@127.0.0.1:15432/cms")).toEqual({
      host: "127.0.0.1",
      port: "15432",
      name: "cms"
    });
  });

  it("拒绝演示库名或 15433 端口", () => {
    expect(() => assertNotDemoDatabase("postgres://cms:secret@127.0.0.1:15433/cms")).toThrow(/演示库/);
    expect(() => assertNotDemoDatabase("postgres://cms:secret@127.0.0.1:15432/cms_demo")).toThrow(/演示库/);
  });

  it("允许 15432 上的非演示库", () => {
    expect(assertNotDemoDatabase("postgres://cms:secret@127.0.0.1:15432/cms")).toMatchObject({
      port: "15432",
      name: "cms"
    });
  });
});

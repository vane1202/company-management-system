import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { isInLan, parseLanConfig, restrictLanClients } from "../src/lib/lan.js";
import { csrfAndOriginGuard } from "../src/routes/auth.js";

const config = { lanHost: "192.168.1.58", lanAllowedCidr: "192.168.1.0/24" };
describe("明确的局域网入口与来源限制", () => {
  it("未启用 LAN 时保留原绑定，配置必须成对且仅限私有网段", () => {
    expect(parseLanConfig()).toEqual({});
    expect(parseLanConfig(config.lanHost, config.lanAllowedCidr)).toEqual(config);
    for (const [host, cidr] of [["192.168.1.58", ""], ["", "192.168.1.0/24"], ["0.0.0.0", "0.0.0.0/0"], ["198.18.0.1", "198.18.0.0/30"], ["192.168.1.58", "192.168.2.0/24"], ["192.168.1.58", "192.168.1.58/24"], ["192.168.1.58", "192.0.0.0/8"]]) expect(() => parseLanConfig(host,cidr)).toThrow();
  });
  it("网段按地址位匹配，拒绝不同子网、VPN、IPv6 和畸形来源", () => {
    expect(isInLan("192.168.1.20", config.lanAllowedCidr)).toBe(true);
    expect(isInLan("::ffff:192.168.1.20", config.lanAllowedCidr)).toBe(true);
    for (const ip of ["192.168.10.20", "192.168.2.20", "198.18.0.1", "::1", "", "192.168.1.999"]) expect(isInLan(ip,config.lanAllowedCidr)).toBe(false);
  });
  function fixture(local: string, remote: string) {
    const app = express();
    app.use((req, _res, next) => { Object.defineProperty(req.socket,"localAddress",{value:local,configurable:true}); Object.defineProperty(req.socket,"remoteAddress",{value:remote,configurable:true}); next(); });
    app.use(restrictLanClients(config));
    app.get("/", (_req,res) => res.json({ok:true}));
    return app;
  }
  it("允许本机和同网段，直接阻止不在网段的 LAN 请求", async () => {
    await request(fixture("127.0.0.1","127.0.0.1")).get("/").expect(200);
    await request(fixture(config.lanHost,"192.168.1.20")).get("/").expect(200);
    await request(fixture(config.lanHost,"198.18.0.1")).get("/").set("X-Forwarded-For","192.168.1.20").expect(403);
  });
  it("LAN 来源需显式列入允许名单，CSRF 保护保持有效", async () => {
    const app = express();
    app.use((req,_res,next) => { req.session = { csrfToken:"test-only-csrf" } as typeof req.session; next(); });
    app.use(csrfAndOriginGuard(["http://127.0.0.1:13080","http://192.168.1.58:13080"]));
    app.post("/write",(_req,res) => res.json({ok:true}));
    app.use((error: {status:number;message:string},_req:express.Request,res:express.Response,_next:express.NextFunction) => res.status(error.status).json({error:error.message}));
    await request(app).post("/write").set("Origin","http://192.168.1.58:13080").set("X-CSRF-Token","test-only-csrf").expect(200);
    await request(app).post("/write").set("Origin","http://192.168.1.58:13080").expect(403);
    await request(app).post("/write").set("Origin","http://198.18.0.1:13080").set("X-CSRF-Token","test-only-csrf").expect(403);
  });
});

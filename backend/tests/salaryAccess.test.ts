import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { Pool } from "pg";
import type { Express } from "express";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/lib/password.js";
import { assertNotDemoDatabase } from "./safeDatabase.js";

const ORIGIN="http://127.0.0.1:13080",PASSWORD="SalaryFixtureOnly1234";
describe("财务工资维护与BOSS只读核算（隔离数据库）",()=>{
  let db:Pool,app:Express; const ids:Record<string,string>={};
  const clients:Record<string,{agent:ReturnType<typeof request.agent>;token:string}>={};
  function get(who:string,url:string){return clients[who].agent.get(url);}
  function write(who:string,method:"post"|"patch",url:string,body:object){return clients[who].agent[method](url).set("Origin",ORIGIN).set("X-CSRF-Token",clients[who].token).send(body);}
  async function create(name:string,body:object={}){return (await write("finance","post","/api/salaries",{userId:ids[name],monthlyAmount:"3100.00",effectiveFrom:"2026-01-01",effectiveTo:"2026-01-31",...body}).expect(201)).body.salary;}
  beforeAll(async()=>{
    const url=process.env.TEST_DATABASE_URL??"",target=assertNotDemoDatabase(url);
    if(target.name!=="cms_salary_test"||target.port!=="16542"||target.host!=="127.0.0.1")throw Error("仅允许16542独立cms_salary_test");
    process.env.DATABASE_URL=url;process.env.SESSION_SECRET="isolated-payroll-fixture-secret-for-tests";process.env.APP_ORIGIN=ORIGIN;process.env.LOGIN_MAX_ATTEMPTS="200";
    db=createPool(url);await migrate(db);await db.query("TRUNCATE users,teams,session CASCADE");
    const hash=await hashPassword(PASSWORD);
    for(const [name,role] of [["finance","finance"],["boss","boss"],["admin","admin"],["supervisor","cs_supervisor"],["assistant","assistant"],["cashier","cs"],["opsone","ops"],["opstwo","ops"],["editor","editor"]])ids[name]=(await db.query("INSERT INTO users(username,display_name,password_hash,role,must_change_password) VALUES($1,$1,$2,$3,FALSE) RETURNING id",[name,hash,role])).rows[0].id;
    ids.wechat=(await db.query("INSERT INTO users(username,display_name,password_hash,role,must_change_password,account_kind,wechat_id) VALUES('asset_wx','测试微信',$1,'cs',FALSE,'cs_wechat','Fixture_Salary_Wechat') RETURNING id",[hash])).rows[0].id;
    app=createApp(db,loadConfig());
    for(const name of ["finance","boss","admin","supervisor","assistant","cashier"]){const agent=request.agent(app),csrf=(await agent.get("/api/auth/csrf")).body.csrfToken;const login=await agent.post("/api/auth/login").set("Origin",ORIGIN).set("X-CSRF-Token",csrf).send({username:name,password:PASSWORD}).expect(200);clients[name]={agent,token:login.body.csrfToken};}
  });
  afterAll(async()=>{await db?.end();});
  it("财务和BOSS可读，管理员主管客服助理不能读取或改工资",async()=>{
    for(const role of ["finance","boss"])for(const url of ["/api/salaries","/api/salaries/employees","/api/salaries/summary?from=2026-01-01&to=2026-01-31"])expect((await get(role,url).expect(200)).headers["cache-control"]).toBe("private, no-store");
    for(const role of ["admin","supervisor","cashier","assistant"]){for(const url of ["/api/salaries","/api/salaries/employees","/api/salaries/summary"])await get(role,url).expect(403);await write(role,"post","/api/salaries",{}).expect(403);}
    await write("boss","post","/api/salaries",{}).expect(403);
  });
  it("工资员工目录只含必要字段，不含微信资产与账号管理权限",async()=>{
    const employees=(await get("finance","/api/salaries/employees")).body.employees;expect(employees.some((e:any)=>e.id===ids.wechat)).toBe(false);expect(employees[0]).toHaveProperty("displayName");expect(JSON.stringify(employees)).not.toMatch(/password|mustChangePassword|managedTeamIds|wechatId/);
    for(const path of ["/api/admin/users","/api/admin/teams","/api/orders","/api/ops-reports","/api/dashboard/summary"])await get("finance",path).expect(403);
    await write("finance","post","/api/salaries",{userId:ids.wechat,monthlyAmount:"100.00",effectiveFrom:"2026-01-01"}).expect(400);
  });
  it("财务建工资、网络重试去重、区间重叠和错误日期被拒绝",async()=>{
    const salary=await create("opsone"),payload={userId:ids.opsone,monthlyAmount:"3100.00",effectiveFrom:"2026-01-01",effectiveTo:"2026-01-31"};
    expect((await write("finance","post","/api/salaries",payload).expect(200)).body.salary.id).toBe(salary.id);
    await write("finance","post","/api/salaries",{...payload,monthlyAmount:"3200.00"}).expect(409);
    await write("finance","post","/api/salaries",{...payload,effectiveFrom:"2026-02-01",effectiveTo:"2026-01-01"}).expect(400);
    await write("finance","post","/api/salaries",{...payload,monthlyAmount:"1.001"}).expect(400);
    expect((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_type='salary' AND entity_id=$1",[salary.id])).rows[0].n).toBe(1);
  });
  it("整月、部分月份、跨月和员工筛选精确核算，BOSS与财务数据相同",async()=>{
    await create("opstwo",{monthlyAmount:"6200.01",effectiveFrom:"2026-01-16",effectiveTo:"2026-02-28"});
    const full=(await get("boss","/api/salaries/summary?from=2026-01-01&to=2026-01-31")).body;
    expect(full).toMatchObject({totalAllocated:"6300.00",employeeCount:2,recordCount:2});expect(full.roles).toEqual([{role:"ops",employeeCount:2,allocated:"6300.00"}]);
    const selected=(await get("finance",`/api/salaries/summary?from=2026-01-16&to=2026-02-28&userId=${ids.opstwo}`)).body;expect(selected.totalAllocated).toBe("9400.01");expect(selected.employees).toHaveLength(1);expect(selected.employees[0].records[0].allocated).toBe("9400.01");
    expect((await get("finance","/api/salaries/summary?from=2026-01-01&to=2026-01-31")).body).toEqual(full);
    await get("finance","/api/salaries/summary?from=2026-01-31&to=2026-01-01").expect(400);await get("finance","/api/salaries/summary?from=2020-01-01&to=2026-01-01").expect(400);
  });
  it("财务调整工资有版本锁与原因，BOSS能看修改轨迹且不能修改",async()=>{
    const salary=await create("editor"),payload={monthlyAmount:"3500.50",effectiveFrom:salary.effectiveFrom,effectiveTo:salary.effectiveTo,recordVersion:salary.recordVersion,reason:"修正约定月薪"};
    await write("boss","patch",`/api/salaries/${salary.id}`,payload).expect(403);
    const updated=await write("finance","patch",`/api/salaries/${salary.id}`,payload).expect(200);expect(updated.body.salary.recordVersion).not.toBe(salary.recordVersion);
    await write("finance","patch",`/api/salaries/${salary.id}`,payload).expect(409);
    await write("finance","patch",`/api/salaries/${salary.id}`,{...payload,recordVersion:updated.body.salary.recordVersion,reason:""}).expect(400);
    const history=(await get("boss",`/api/salaries/${salary.id}/history`).expect(200)).body.history;expect(history).toHaveLength(2);expect(history[0]).toMatchObject({action:"salary_update",actorName:"finance",before:{monthlyAmount:"3100.00"},after:{monthlyAmount:"3500.50",reason:"修正约定月薪"}});
    await get("admin",`/api/salaries/${salary.id}/history`).expect(403);
  });
  it("调薪先结束旧区间，新增下一段；已停用员工历史仍计入",async()=>{
    const salary=(await get("finance",`/api/salaries?userId=${ids.editor}`)).body.salaries[0];
    await write("finance","patch",`/api/salaries/${salary.id}`,{monthlyAmount:"3500.50",effectiveFrom:"2026-01-01",effectiveTo:"2026-01-15",recordVersion:salary.recordVersion,reason:"月中调薪，结束旧标准"}).expect(200);
    await create("editor",{monthlyAmount:"4000.00",effectiveFrom:"2026-01-16",effectiveTo:"2026-01-31"});await db.query("UPDATE users SET is_active=FALSE WHERE id=$1",[ids.editor]);
    const result=(await get("boss",`/api/salaries/summary?from=2026-01-01&to=2026-01-31&userId=${ids.editor}`)).body;expect(result).toMatchObject({employeeCount:1,recordCount:2,totalAllocated:"3758.30"});expect(result.employees[0].isActive).toBe(false);
  });
  it("两个财务页面并发修改时只有一个旧版本能保存，员工归属不可改",async()=>{
    const salary=await create("cashier"),body={monthlyAmount:"3200.00",effectiveFrom:"2026-01-01",effectiveTo:"2026-01-31",recordVersion:salary.recordVersion,reason:"并发核对"};
    const responses=await Promise.all([write("finance","patch",`/api/salaries/${salary.id}`,body),write("finance","patch",`/api/salaries/${salary.id}`,{...body,monthlyAmount:"3300.00"})]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const fresh=(await get("finance",`/api/salaries?userId=${ids.cashier}`)).body.salaries[0];await write("finance","patch",`/api/salaries/${salary.id}`,{...body,userId:ids.boss,recordVersion:fresh.recordVersion}).expect(400);
  });
});

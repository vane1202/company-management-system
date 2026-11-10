import request from 'supertest';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {createPool} from '../src/db.js';
import {createApp} from '../src/app.js';
import {migrate} from '../src/migrate.js';
import {loadConfig} from '../src/config.js';
import {hashPassword} from '../src/lib/password.js';
import {parseServiceIdentity} from '../src/lib/csAccounts.js';
import {businessToday} from '../src/lib/dates.js';
import {assertNotDemoDatabase} from './safeDatabase.js';
describe('平台账号标识规范',()=>{
 it('WhatsApp国际号码与链接归一，Messenger使用稳定ID而非昵称',()=>{
  expect(parseServiceIdentity('whatsapp','+60 (123) 456-789')).toEqual({platform:'whatsapp',identifier:'+60123456789'});
  expect(parseServiceIdentity('whatsapp','https://wa.me/60123456789')).toEqual({platform:'whatsapp',identifier:'+60123456789'});
  expect(parseServiceIdentity('messenger','https://m.me/Example.Page')).toEqual({platform:'messenger',identifier:'example.page'});
  for(const [platform,id]of [['whatsapp','0123456789'],['messenger','客户昵称'],['messenger','https://evil.example/user'],['wechat','Sample123']])expect(()=>parseServiceIdentity(platform,id)).toThrow();
 });
});
const origin='http://127.0.0.1:13080',password='ServiceFixture1234';
describe('预录WhatsApp/Messenger账号与名单选择登记',()=>{
 let db:Pool,app:ReturnType<typeof createApp>,today:string;const ids:Record<string,string>={},clients:Record<string,Client>={};
 type Client={agent:ReturnType<typeof request.agent>;token:string};
 const write=(c:Client,m:'post'|'put'|'patch',p:string,b:object)=>c.agent[m](p).set('Origin',origin).set('X-CSRF-Token',c.token).send(b);
 async function anonymous(){const agent=request.agent(app);return{agent,token:(await agent.get('/api/auth/csrf')).body.csrfToken};}
 async function code(accountId?:string,teamId=ids.team){return(await write(clients.admin,'post','/api/cs-accounts/registration-codes',accountId?{accountId}:{teamId}).expect(201)).body.code as string;}
 async function create(platform:string,accountIdentifier:string,teamId=ids.team){return(await write(clients.admin,'post','/api/cs-accounts',{platform,accountIdentifier,teamId,phoneLabel:'虚构设备'}).expect(201)).body.id as string;}
 beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL??'',target=assertNotDemoDatabase(url);if(target.host!=='127.0.0.1'||target.port!=='16542'||target.name!=='cms_commerce_test')throw Error('仅允许隔离cms_commerce_test:16542');
  process.env.DATABASE_URL=url;process.env.SESSION_SECRET='isolated-service-fixture-secret-not-production';process.env.APP_ORIGIN=origin;process.env.LOGIN_MAX_ATTEMPTS='200';const config=loadConfig();today=businessToday(new Date(),config.businessTimezone);db=createPool(url);await migrate(db);await db.query('TRUNCATE users,teams,session CASCADE');await db.query("DELETE FROM app_settings WHERE key='business_modules'");const hash=await hashPassword(password);
  for(const [name,role]of [['admin','admin'],['boss','boss'],['sup','cs_supervisor'],['unassigned','cs_supervisor'],['finance','finance']])ids[name]=(await db.query('INSERT INTO users(username,display_name,password_hash,role,must_change_password) VALUES($1,$1,$2,$3,FALSE) RETURNING id',['svc_'+name,hash,role])).rows[0].id;
  for(const name of ['team','otherTeam'])ids[name]=(await db.query('INSERT INTO teams(name) VALUES($1) RETURNING id',['虚构'+name])).rows[0].id;
  await db.query('INSERT INTO supervisor_scopes(supervisor_id,team_id) VALUES($1,$2)',[ids.sup,ids.team]);app=createApp(db,config);
  for(const name of ['admin','boss','sup','unassigned','finance']){const c=await anonymous(),r=await write(c,'post','/api/auth/login',{username:'svc_'+name,password}).expect(200);c.token=r.body.csrfToken;clients[name]=c;}
 });
 afterAll(async()=>{await db?.end();});
 it('管理员预录平台账号，校验格式、防重并限制主管范围',async()=>{
  ids.wa=await create('whatsapp','+999000000001');ids.ms=await create('messenger','https://m.me/Fictional.Service');ids.other=await create('messenger','fictional.other',ids.otherTeam);
  await write(clients.admin,'post','/api/cs-accounts',{platform:'messenger',accountIdentifier:'FICTIONAL.SERVICE',teamId:ids.team}).expect(409);
  await write(clients.sup,'post','/api/cs-accounts',{platform:'messenger',accountIdentifier:'wrong.scope',teamId:ids.otherTeam}).expect(403);
  const rows=(await clients.admin.agent.get('/api/cs-accounts').expect(200)).body.accounts;expect(rows.find((r:any)=>r.id===ids.wa)).toMatchObject({platform:'whatsapp',accountIdentifier:'+999000000001',wechatId:'WhatsApp · +999000000001'});
  expect((await clients.sup.agent.get('/api/cs-accounts')).body.accounts.map((r:any)=>r.id).sort()).toEqual([ids.wa,ids.ms].sort());
  for(const name of ['boss','finance'])await write(clients[name],'post','/api/cs-accounts',{}).expect(403);
 });
 it('只有持有效登记码者可读取授权名单，选其他组或其他绑定账号均拒绝',async()=>{
  const c=await anonymous(),token=await code();await write(c,'post','/api/auth/cs-device/options',{registrationCode:'bad'}).expect(400);
  const options=(await write(c,'post','/api/auth/cs-device/options',{registrationCode:token}).expect(200)).body.accounts;expect(options.map((a:any)=>a.id).sort()).toEqual([ids.wa,ids.ms].sort());
  await write(c,'post','/api/auth/cs-device',{registrationCode:token,accountId:ids.other}).expect(400);
  const bound=await code(ids.wa);expect((await write(c,'post','/api/auth/cs-device/options',{registrationCode:bound})).body.accounts.map((a:any)=>a.id)).toEqual([ids.wa]);await write(c,'post','/api/auth/cs-device',{registrationCode:bound,accountId:ids.ms}).expect(400);
  const r=await write(c,'post','/api/auth/cs-device',{registrationCode:bound,accountId:ids.wa}).expect(200);c.token=r.body.csrfToken;clients.device=c;
  expect(r.body.user).toMatchObject({id:ids.wa,accountKind:'cs_service',servicePlatform:'whatsapp',accountIdentifier:'+999000000001'});expect(JSON.stringify(r.headers['set-cookie'])).toContain('HttpOnly');
  await write(await anonymous(),'post','/api/auth/cs-device',{registrationCode:bound,accountId:ids.wa}).expect(400);await c.agent.get('/api/cs-accounts').expect(403);
 });
 it('加粉与线索跟随接待平台，前端隐藏之外后端也拒绝串渠道',async()=>{
  const c=clients.device,report={businessDate:today,pageName:'虚构来源人设',msToday:0,wsToday:1,msMonth:0,wsMonth:1,validToday:1,commReplied:1,commReadNoReply:0,commUnread:0,commInvalid:0};
  await write(c,'put','/api/fan-reports',{...report,msToday:1}).expect(400);await write(c,'put','/api/fan-reports',report).expect(200);
  const lead={requestKey:randomUUID(),receivedOn:today,pageName:'虚构来源人设',operatorName:'虚构经办员',customerLabel:'虚构客户',channel:'ms',contactStatus:'unread'};
  await write(c,'post','/api/fan-leads',lead).expect(400);ids.lead=(await write(c,'post','/api/fan-leads',{...lead,channel:'ws'}).expect(200)).body.id;
  await write(c,'patch','/api/fan-leads/'+ids.lead,{...lead,version:1,reason:'测试串渠道'}).expect(400);
  const data=(await clients.boss.agent.get('/api/fan-leads')).body.leads;expect(data[0]).toMatchObject({accountId:ids.wa,teamId:ids.team,channel:'ws',wechatId:'WhatsApp · +999000000001'});
  expect((await clients.unassigned.agent.get('/api/fan-leads')).body.leads).toEqual([]);
 });
 it('同一码并发只可兑换一次；重发/停用立即撤销设备会话',async()=>{
  const token=await code(),a=await anonymous(),b=await anonymous(),results=await Promise.all([write(a,'post','/api/auth/cs-device',{registrationCode:token,accountId:ids.wa}),write(b,'post','/api/auth/cs-device',{registrationCode:token,accountId:ids.ms})]);expect(results.map(r=>r.status).sort()).toEqual([200,400]);
  const c=await anonymous(),r=await write(c,'post','/api/auth/cs-device',{registrationCode:await code(ids.wa),accountId:ids.wa}).expect(200);c.token=r.body.csrfToken;await code(ids.wa);await c.agent.get('/api/auth/me').expect(401);
  const newer=await code(ids.wa);await write(clients.admin,'put','/api/cs-accounts/'+ids.wa+'/status',{isActive:false}).expect(200);await write(await anonymous(),'post','/api/auth/cs-device',{registrationCode:newer,accountId:ids.wa}).expect(400);await write(clients.admin,'put','/api/cs-accounts/'+ids.wa+'/status',{isActive:true}).expect(200);
 });
 it('更换平台必须新增主体，员工角色与工资不接纳接待账号',async()=>{
  await write(clients.admin,'patch','/api/cs-accounts/'+ids.ms,{platform:'whatsapp',accountIdentifier:'+999000000002'}).expect(400);
  await write(clients.admin,'patch','/api/admin/users/'+ids.ms,{role:'boss'}).expect(400);
  const rows=(await clients.admin.agent.get('/api/admin/users')).body.users;expect(rows.find((r:any)=>r.id===ids.ms).accountKind).toBe('cs_service');
  expect((await clients.finance.agent.get('/api/salaries/employees')).body.employees.some((e:any)=>e.id===ids.ms)).toBe(false);
 });
});

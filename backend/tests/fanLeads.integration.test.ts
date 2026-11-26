import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {Pool} from 'pg';
import type {Express} from 'express';
import {createPool} from '../src/db.js';
import {migrate} from '../src/migrate.js';
import {createApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';
import {hashPassword} from '../src/lib/password.js';
import {businessToday,addDays} from '../src/lib/dates.js';
import {assertNotDemoDatabase} from './safeDatabase.js';
const origin='http://127.0.0.1:13080',password='FictionalLeadTest1234';
describe('线索隔离与归属集成',()=>{
 let db:Pool,app:Express,today:string;const ids:Record<string,string>={},clients:Record<string,{agent:ReturnType<typeof request.agent>;token:string}>={};
 const post=(name:string,path:string,body:object)=>clients[name].agent.post(path).set('Origin',origin).set('X-CSRF-Token',clients[name].token).send(body);
 const patch=(name:string,id:string,body:object)=>clients[name].agent.patch('/api/fan-leads/'+id).set('Origin',origin).set('X-CSRF-Token',clients[name].token).send(body);
 const get=(name:string,path='/api/fan-leads')=>clients[name].agent.get(path);
 const body=(extra:object={})=>({requestKey:randomUUID(),receivedOn:today,pageName:'虚构主页',operatorName:'虚构客服',channel:'ms',customerLabel:'虚构客户',customerRef:randomUUID(),contactStatus:'replied',repliedOn:today,qualifiedOn:today,needSummary:'白冰手镯，预算4000台币',...extra});
 beforeAll(async()=>{const url=process.env.TEST_DATABASE_URL??'',target=assertNotDemoDatabase(url);if(target.host!=='127.0.0.1'||target.port!=='16542'||target.name!=='cms_commerce_test')throw Error('仅允许隔离 cms_commerce_test:16542');process.env.DATABASE_URL=url;process.env.SESSION_SECRET='isolated-fan-lead-test-secret-not-for-production';process.env.APP_ORIGIN=origin;process.env.LOGIN_MAX_ATTEMPTS='200';const config=loadConfig();today=businessToday(new Date(),config.businessTimezone);db=createPool(url);await migrate(db);await db.query('TRUNCATE users,teams,session CASCADE');await db.query("DELETE FROM app_settings WHERE key='business_modules'");const hash=await hashPassword(password);
  for(const [name,role] of [['cs','cs'],['other','cs'],['boss','boss'],['admin','admin'],['finance','finance'],['supervisor','cs_supervisor'],['unassigned','cs_supervisor']])ids[name]=(await db.query('INSERT INTO users(username,display_name,password_hash,role,must_change_password) VALUES($1,$1,$2,$3,FALSE) RETURNING id',['lead_'+name,hash,role])).rows[0].id;
  for(const key of ['team','otherTeam'])ids[key]=(await db.query('INSERT INTO teams(name) VALUES($1) RETURNING id',[key])).rows[0].id;
  for(const [name,team] of [['cs','team'],['other','otherTeam']])await db.query('INSERT INTO team_memberships(user_id,team_id,start_date) VALUES($1,$2,$3)',[ids[name],ids[team],addDays(today,-30)]);
  await db.query('INSERT INTO supervisor_scopes(supervisor_id,team_id) VALUES($1,$2)',[ids.supervisor,ids.team]);app=createApp(db,config);
  for(const name of ['cs','other','boss','admin','finance','supervisor','unassigned']){const agent=request.agent(app),csrf=(await agent.get('/api/auth/csrf')).body.csrfToken,r=await agent.post('/api/auth/login').set('Origin',origin).set('X-CSRF-Token',csrf).send({username:'lead_'+name,password}).expect(200);clients[name]={agent,token:r.body.csrfToken};}
 });
 afterAll(async()=>{await db?.end();});
 it('相同请求键幂等，客户标识防重，未回复不自动无效',async()=>{
  const p=body({contactStatus:'read_no_reply',repliedOn:'',qualifiedOn:'',needSummary:''}),first=await post('cs','/api/fan-leads',p).expect(200);expect((await post('cs','/api/fan-leads',p).expect(200)).body.id).toBe(first.body.id);await post('cs','/api/fan-leads',{...p,requestKey:randomUUID()}).expect(409);
  const r=(await get('cs').expect(200)).body;expect(r.leads).toHaveLength(1);expect(r.totals).toMatchObject({received:1,replied:0,invalid:0,sameDay:0});
 });
 it('旧客户今日明确需求，不进入今日新增批次，流失保留初步转化',async()=>{
  const p=body({receivedOn:addDays(today,-1),repliedOn:addDays(today,-1),qualifiedOn:'',needSummary:''}),id=(await post('cs','/api/fan-leads',p).expect(200)).body.id;
  await patch('cs',id,{...p,qualifiedOn:today,needSummary:'白冰手镯，预算4000台币',lossReason:'报价后拉黑',reason:'今日追问明确需求，后因价格流失',version:1}).expect(200);
  expect((await get('boss').expect(200)).body.leads.some((l:any)=>l.id===id)).toBe(false);
  const yesterday=(await get('boss','/api/fan-leads?from='+addDays(today,-1)+'&to='+addDays(today,-1)).expect(200)).body;expect(yesterday.totals).toMatchObject({received:1,sameDayRate:0,sevenDayRate:100,lost:1});
  await patch('cs',id,{...p,reason:'过期版本',version:1}).expect(409);await patch('other',id,{...p,reason:'越权',version:2}).expect(403);
  expect((await get('supervisor','/api/fan-leads/'+id+'/history').expect(200)).body.history).toHaveLength(2);
 });
 it('BOSS只读、管理员财务无业务权限、主管仅本组，原日报未被改写',async()=>{
  const p=body(),otherId=(await post('other','/api/fan-leads',p).expect(200)).body.id;
  for(const name of ['boss','supervisor','admin','finance'])await post(name,'/api/fan-leads',body()).expect(403);
  for(const name of ['admin','finance'])await get(name).expect(403);
  expect((await get('supervisor').expect(200)).body.leads.some((l:any)=>l.id===otherId)).toBe(false);await get('supervisor','/api/fan-leads/'+otherId+'/history').expect(403);expect((await get('unassigned').expect(200)).body.leads).toEqual([]);
  expect((await db.query('SELECT count(*) AS n FROM fan_reports')).rows[0].n).toBe('0');
 });
 it('客资按记录关联订单，无效库只归集主管确认，提成只公开已核定本人金额',async()=>{
  const search='核对同名客户';
  const a=(await post('cs','/api/fan-leads',body({customerLabel:search})).expect(200)).body.id;
  const b=(await post('cs','/api/fan-leads',body({customerLabel:search})).expect(200)).body.id;
  const foreign=(await post('other','/api/fan-leads',body({customerLabel:search})).expect(200)).body.id;
  const sale={requestKey:randomUUID(),businessDate:today,personaName:'演示主页',dealChannel:'private',
    operatorName:'虚构客服',customerLabel:search,customerCurrency:'CNY',items:[{kind:'service',label:'虚构加工',priceCny:'200.00'}]};
  const orderId=(await post('cs','/api/order-records',{...sale,customerLeadId:a}).expect(200)).body.id;
  await post('cs','/api/order-records',{...sale,requestKey:randomUUID(),customerLeadId:foreign}).expect(404);
  const unlinked=(await post('cs','/api/order-records',{...sale,requestKey:randomUUID()}).expect(200)).body.id;
  await post('other',`/api/order-records/${unlinked}/customer`,{customerLeadId:foreign,reason:'校验隔离'}).expect(404);
  await post('cs',`/api/order-records/${unlinked}/customer`,{customerLeadId:b,reason:'核对原单号'}).expect(200);
  await post('cs',`/api/order-records/${unlinked}/customer`,{customerLeadId:a,reason:'不得覆盖关联'}).expect(409);
  const orders=(await get('cs','/api/orders').expect(200)).body.orders;
  expect(orders.find((row:any)=>row.id===orderId)).toMatchObject({customerLeadId:a,customerBalance:'200.00',customerCurrency:'CNY'});
  expect(orders.find((row:any)=>row.id===unlinked).customerLeadId).toBe(b);
  const book='/api/fan-leads/customer-book';
  expect((await get('cs',book+'?search='+encodeURIComponent(search)).expect(200)).body.rows.map((r:any)=>r.id).sort()).toEqual([a,b].sort());
  await get('supervisor',book).expect(403);

  const invalidDraft=body({customerLabel:'待主管复核的客资',qualifiedOn:'',invalidReasonCode:'custom',invalidReason:'恶意测试广告'});
  const pending=(await post('cs','/api/fan-leads',invalidDraft).expect(200)).body.id;
  const preset=(await post('cs','/api/fan-leads',{...invalidDraft,requestKey:randomUUID(),customerRef:randomUUID(),invalidReasonCode:'misclick'}).expect(200)).body.id;
  const archived=async()=> (await get('cs',book+'?invalid=true').expect(200)).body.rows;
  expect(await archived()).toEqual([]);
  await post('supervisor','/api/customer-reviews/'+pending,{decision:'approve',version:1}).expect(200);
  expect(await archived()).toMatchObject([{id:pending,reviewedAt:expect.any(String)}]);
  const customers=(await get('cs',book).expect(200)).body.rows.map((r:any)=>r.id);
  expect(customers).not.toContain(pending);
  expect(customers).toContain(preset);
  await post('supervisor','/api/customer-reviews/'+pending,{decision:'restore',version:2,note:'恢复沟通'}).expect(200);
  expect(await archived()).toEqual([]);

  const overview='/api/fan-leads/personal-overview';
  const current=(await get('cs',overview).expect(200)).body;
  expect(current).toMatchObject({privateAmount:'400.00',orderCount:2,commission:null});
  expect(current.monthFans).toBeGreaterThan(0);
  await db.query(`INSERT INTO payroll_months(user_id,pay_month,status,locked_base,locked_commission,locked_bonus,locked_deduction,locked_net,locked_at,locked_by,updated_by)
    VALUES ($1,$2,'locked',0,120,0,0,120,now(),$3,$3)`,[ids.cs,today.slice(0,7),ids.finance]);
  expect((await get('cs',overview).expect(200)).body.commission).toBe('120.00');
  expect((await get('other',overview).expect(200)).body.commission).toBeNull();
  await get('boss',overview).expect(403);
 });
 it('作废需说明和版本，保留审计、从分母剔除，未来和超范围日期拒绝',async()=>{
  const id=(await post('cs','/api/fan-leads',body()).expect(200)).body.id;await patch('cs',id,{version:1,void:true}).expect(400);await patch('cs',id,{version:1,void:true,reason:'重复客户，保留另一主记录'}).expect(200);expect((await get('cs').expect(200)).body.leads.find((l:any)=>l.id===id).voidReason).toContain('重复');await patch('cs',id,{version:2,void:true,reason:'再次'}).expect(409);
  await post('cs','/api/fan-leads',body({receivedOn:addDays(today,1)})).expect(400);await get('boss','/api/fan-leads?from=2020-01-01&to='+today).expect(400);
 });
});

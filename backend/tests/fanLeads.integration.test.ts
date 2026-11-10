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
 it('作废需说明和版本，保留审计、从分母剔除，未来和超范围日期拒绝',async()=>{
  const id=(await post('cs','/api/fan-leads',body()).expect(200)).body.id;await patch('cs',id,{version:1,void:true}).expect(400);await patch('cs',id,{version:1,void:true,reason:'重复客户，保留另一主记录'}).expect(200);expect((await get('cs').expect(200)).body.leads.find((l:any)=>l.id===id).voidReason).toContain('重复');await patch('cs',id,{version:2,void:true,reason:'再次'}).expect(409);
  await post('cs','/api/fan-leads',body({receivedOn:addDays(today,1)})).expect(400);await get('boss','/api/fan-leads?from=2020-01-01&to='+today).expect(400);
 });
});

import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,it,expect } from "vitest";
import type { Express } from "express";
import type { Pool } from "pg";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/lib/password.js";
import { businessToday } from "../src/lib/dates.js";
import { assertNotDemoDatabase } from "./safeDatabase.js";

const origin="http://127.0.0.1:13080",password="CommerceFixture1234";
describe("成交、客户付款与财务结算隔离",()=>{
 let db:Pool,app:Express,today:string;const users:Record<string,string>={},clients:Record<string,{agent:ReturnType<typeof request.agent>;token:string}>={};
 function post(who:string,path:string,body:object){return clients[who].agent.post(path).set("Origin",origin).set("X-CSRF-Token",clients[who].token).send(body);}
 function get(who:string,path:string){return clients[who].agent.get(path);}
 const body=(extra:object={})=>({requestKey:randomUUID(),orderRef:"FIX-"+randomUUID(),businessDate:today,personaName:"虚构主页",personaCode:"P-TEST",liveRoomCode:"LIVE-TEST",hostName:"虚构主播",customerCode:"C-TEST",operatorName:"虚构经办",customerLabel:"虚构客户",source:"测试",customerCurrency:"TWD",customerDue:"3000.00",items:[{kind:"material",label:"虚构原石",priceCny:"100.05"},{kind:"finished",label:"虚构成品",priceCny:"20.00"}],...extra});
 async function order(extra:object={},who="cashier"){return(await post(who,"/api/order-records",body(extra)).expect(200)).body.id as string;}
 async function payment(id:string,extra:object={}){const b={requestKey:randomUUID(),paymentDate:today,amount:"1000.00",currency:"TWD",purpose:"deposit",channel:"测试代收账户",thirdParty:true,reference:randomUUID(),...extra};return(await post("cashier",`/api/order-records/${id}/payments`,b).expect(200)).body.id as string;}
 const settlement=(paymentId:string,extra:object={})=>({requestKey:randomUUID(),reference:randomUUID(),channel:"测试代收账户",currency:"TWD",settledOn:today,feeAmount:"30.00",feeCurrency:"TWD",feePercent:"3",fxRate:"0.21",netCny:"203.70",allocations:[{paymentId,foreignAmount:"1000.00",netCny:"203.70"}],...extra});
 beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL??"",inspected=assertNotDemoDatabase(url);if(inspected.name!=="cms_commerce_test"||inspected.port!=="16542"||inspected.host!=="127.0.0.1")throw Error("只允许独立本地 cms_commerce_test:16542");
  process.env.DATABASE_URL=url;process.env.SESSION_SECRET="isolated-commerce-fixture-secret-not-for-production";process.env.APP_ORIGIN=origin;process.env.LOGIN_MAX_ATTEMPTS="200";
  const config=loadConfig();today=businessToday(new Date(),config.businessTimezone);db=createPool(url);await migrate(db);await db.query("TRUNCATE users,teams,session CASCADE");await db.query("DELETE FROM app_settings WHERE key='business_modules'");const hash=await hashPassword(password);
  for(const [name,role] of [["production","editor"],["operations","ops"],["cashier","cs"],["othercs","cs"],["boss","boss"],["admin","admin"],["finance","finance"],["supervisor","cs_supervisor"],["unassigned","cs_supervisor"]])users[name]=(await db.query("INSERT INTO users(username,display_name,password_hash,role,must_change_password) VALUES($1,$1,$2,$3,FALSE) RETURNING id",[name,hash,role])).rows[0].id;
  const team=(await db.query("INSERT INTO teams(name) VALUES('虚构测试组') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO team_memberships(user_id,team_id,start_date) VALUES($1,$2,$3)",[users.cashier,team,today]);await db.query("INSERT INTO supervisor_scopes(supervisor_id,team_id) VALUES($1,$2)",[users.supervisor,team]);app=createApp(db,config);
  for(const name of Object.keys(users)){const agent=request.agent(app),token=(await agent.get("/api/auth/csrf")).body.csrfToken;const r=await agent.post("/api/auth/login").set("Origin",origin).set("X-CSRF-Token",token).send({username:name,password}).expect(200);clients[name]={agent,token:r.body.csrfToken};}
 });
 afterAll(async()=>{await db?.end();});

 it('直播间首页按成交、追加收费及成本各自发生日统计，筛选与实际资金分开',async()=>{
  const persona='LIVE-'+randomUUID(),yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const oldId=await order({businessDate:yesterday,personaCode:persona,liveRoomCode:'DATE-A',customerCurrency:'CNY',items:[{kind:'material',label:'旧原石',priceCny:'100.00'}]});
  const newId=await order({personaCode:persona,liveRoomCode:'DATE-B',customerCurrency:'CNY',items:[{kind:'material',label:'新原石',priceCny:'300.00'}]});
  for(const [id,value]of [[oldId,'20.00'],[newId,'40.00']])await post('cashier','/api/order-records/'+id+'/charges',{businessDate:today,label:'设计追加费',amountCny:value,requestKey:randomUUID()}).expect(200);
  const oldCost=(await post('cashier','/api/order-records/'+oldId+'/expenses',{businessDate:today,category:'sourcing',label:'今日配货',amountCny:'30.00',requestKey:randomUUID()}).expect(200)).body.id;
  await post('cashier','/api/order-records/'+oldId+'/expenses',{businessDate:yesterday,category:'goods',label:'昨日供货',amountCny:'45.00',requestKey:randomUUID()}).expect(200);
  await post('cashier','/api/order-records/'+newId+'/expenses',{businessDate:today,category:'shipping',label:'今日运费',amountCny:'15.00',requestKey:randomUUID()}).expect(200);
  await payment(oldId,{currency:'CNY',amount:'100.00',thirdParty:false});
  await post('finance','/api/finance/payables/payments',{expenseId:oldCost,paidOn:today,payee:'商家',account:'测试公司',reference:randomUUID(),amountCny:'10.00',requestKey:randomUUID()}).expect(200);
  const url='/api/dashboard/live-business?from='+today+'&to='+today+'&persona='+persona;
  const r=(await get('boss',url).expect(200)).body;
  expect(r.totals).toMatchObject({performanceCny:'390.00',newSalesCny:'330.00',additionalCny:'60.00',expenseCny:'45.00',supplierPaidCny:'10.00',companyReceivedCny:'100.00',newOrderCount:1,customerReceipts:{CNY:'100.00',TWD:'0.00',USD:'0.00'}});
  expect(r.rooms.find((x:any)=>x.roomCode==='DATE-A').totals).toMatchObject({performanceCny:'20.00',expenseCny:'30.00',newOrderCount:0});
  const filtered=(await get('boss',url+'&room=DATE-A').expect(200)).body;expect(filtered.totals.performanceCny).toBe('20.00');expect(filtered.totals.expenseCny).toBe('30.00');expect(filtered.ads.spendUsd).toBe(r.ads.spendUsd);
  expect((await get('boss','/api/dashboard/live-business?from='+yesterday+'&to='+yesterday+'&persona='+persona)).body.totals).toMatchObject({performanceCny:'110.00',expenseCny:'45.00'});
  for(const who of ['admin','finance','supervisor','cashier'])await get(who,url).expect(403);
  await get('boss','/api/dashboard/live-business?from=bad&to='+today).expect(400);await get('boss','/api/dashboard/live-business?room[]=bad').expect(400);
 });


 it('历史广告日报关联账户时更新原记录，不重复形成消耗',async()=>{
  const code='AD-CLASSIFY-'+randomUUID();await post('operations','/api/ad-accounts',{code,name:'分类测试户',openedOn:today,openingUsd:'100.00'}).expect(200);
  const b={businessDate:today,personaName:'广告归类测试',spendUsd:'5.00'};
  const put=(body:object)=>clients.operations.agent.put('/api/ops-reports').set('Origin',origin).set('X-CSRF-Token',clients.operations.token).send(body);
  const original=(await put(b).expect(200)).body.report;
  const after=(await put({...b,adAccountRef:code,reportId:original.id}).expect(200)).body.report;
  expect(after.id).toBe(original.id);expect(after.adAccountRef).toBe(code);
  expect((await db.query('SELECT count(*)::int AS count FROM ops_reports WHERE persona_name=$1',[b.personaName])).rows[0].count).toBe(1);
  expect((await get('boss','/api/ad-accounts')).body.accounts.find((a:any)=>a.code===code)).toMatchObject({spent_usd:'5.00',balance_usd:'95.00'});
 });


 it('财务通过成本项查看关联留底，不能跨订单读取图片',async()=>{
  const id=await order(),d=(await get('cashier','/api/order-records/'+id)).body;
  const e=(await post('cashier','/api/order-records/'+id+'/expenses',{requestKey:randomUUID(),businessDate:today,category:'goods',label:'原石供货',amountCny:'10.00',itemId:d.items[0].id})).body.id;
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
  const a=(await clients.cashier.agent.post('/api/order-records/'+id+'/attachments?filename=fixture.png&itemId='+d.items[0].id).set('Origin',origin).set('X-CSRF-Token',clients.cashier.token).set('Content-Type','image/png').send(bytes).expect(200)).body.id;
  expect((await get('finance','/api/finance/payables/'+e+'/attachments')).body.attachments[0].id).toBe(a);
  await get('finance','/api/finance/payables/'+e+'/attachments/'+a).expect(200);
  await get('admin','/api/finance/payables/'+e+'/attachments/'+a).expect(403);await get('supervisor','/api/finance/payables/'+e+'/attachments/'+a).expect(403);
  const other=await order(),otherExpense=(await post('cashier','/api/order-records/'+other+'/expenses',{requestKey:randomUUID(),businessDate:today,category:'goods',label:'其他原石',amountCny:'10.00'})).body.id;
  await get('finance','/api/finance/payables/'+otherExpense+'/attachments/'+a).expect(404);
 });
 it('历史拍剪明确归类时更新同一行，不能留下重复库存',async()=>{
  const send=(b:object)=>clients.production.agent.put('/api/editor-reports').set('Origin',origin).set('X-CSRF-Token',clients.production.token).send(b);
  const b={businessDate:today,personaName:'历史归类测试',shootCount:1,editCount:1,sentToOpsCount:0,inventorySnapshot:8};
  const before=(await send(b).expect(200)).body.report;expect(before.editorName).toBe(null);
  const after=(await send({...b,reportId:before.id,editorName:'十七'}).expect(200)).body.report;expect(after.id).toBe(before.id);expect(after.editorName).toBe('十七');
  expect((await db.query('SELECT count(*)::int AS count FROM editor_reports WHERE persona_name=$1',['历史归类测试'])).rows[0].count).toBe(1);
  await send({...b,reportId:'bad',editorName:'十七'}).expect(400);
 });


 it("新增成交须独立登记人设、直播间主播和客户ID",async()=>{
  await post('cashier','/api/order-records',body({personaCode:''})).expect(400);
  const id=await order(),d=(await get('boss',`/api/order-records/${id}`)).body;
  expect(d.details).toMatchObject({personaCode:'P-TEST',liveRoomCode:'LIVE-TEST',hostName:'虚构主播',customerCode:'C-TEST'});
 });
 it("设计收费追加应收；市场配货真实成本独立且不加10%代购费",async()=>{
  const id=await order({customerCurrency:'CNY'}),b={requestKey:randomUUID(),businessDate:today,label:'设计雕刻费',amountCny:'600.00'};
  const charge=await post('cashier',`/api/order-records/${id}/charges`,b).expect(200);expect((await post('cashier',`/api/order-records/${id}/charges`,b).expect(200)).body.id).toBe(charge.body.id);
  await post('cashier',`/api/order-records/${id}/expenses`,{requestKey:randomUUID(),businessDate:today,category:'sourcing',label:'市场购入替代成品',amountCny:'450.00',counterparty:'虚构商家'}).expect(200);
  let d=(await get('boss',`/api/order-records/${id}`)).body;expect(d.order.amount).toBe('730.06');expect(d.details.customerDue).toBe('730.06');expect(d.expenseTotal).toBe('450.00');expect(d.order.custom_product_cost).toBe('450.00');expect(d.charges[0].amount_cny).toBe('600.00');
  await payment(id,{currency:'CNY',thirdParty:false,amount:'730.06',purpose:'full'});
  await post('cashier',`/api/order-records/${id}/charges/${charge.body.id}/void`,{reason:'不能取消已收费用'}).expect(409);
  expect((await get('boss',`/api/order-records/${id}`)).body.balance).toBe('0.00');
 });
 it("外币追加应收按客户约定，不随公司成本或结汇改变",async()=>{
  const id=await order(),b={requestKey:randomUUID(),businessDate:today,label:'设计费',amountCny:'200.00',customerAmount:'900.00'};
  const c=await post('cashier',`/api/order-records/${id}/charges`,b).expect(200);let d=(await get('boss',`/api/order-records/${id}`)).body;expect(d.details.customerDue).toBe('3900.00');expect(d.order.amount).toBe('330.06');
  await post('cashier',`/api/order-records/${id}/charges/${c.body.id}/void`,{reason:'重复报价'}).expect(200);d=(await get('boss',`/api/order-records/${id}`)).body;expect(d.details.customerDue).toBe('3000.00');expect(d.order.amount).toBe('130.06');
  await post('boss',`/api/order-records/${id}/charges`,b).expect(403);
 });
 it("公司费用分次付款并发不超付，关联付款未纠正时客服不能作废成本",async()=>{
  const id=await order(),e=(await post('cashier',`/api/order-records/${id}/expenses`,{requestKey:randomUUID(),businessDate:today,category:'design',label:'雕刻',amountCny:'100.00',counterparty:'虚构雕刻师'}).expect(200)).body.id;
  const b={expenseId:e,paidOn:today,payee:'虚构雕刻师',account:'公司测试账户',reference:randomUUID(),amountCny:'70.00',requestKey:randomUUID()};
  const results=await Promise.all([post('finance','/api/finance/payables/payments',b),post('finance','/api/finance/payables/payments',{...b,reference:randomUUID(),requestKey:randomUUID()})]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const p=results.find(r=>r.status===200)!.body.id,f=(await get('boss','/api/finance/payables')).body;expect(f.expenses.find((x:any)=>x.id===e)).toMatchObject({paid_cny:'70.00',pending_cny:'30.00',paymentState:'partial',persona_code:'P-TEST',live_room_code:'LIVE-TEST'});
  await post('cashier',`/api/order-records/${id}/expenses/${e}/void`,{reason:'录错'}).expect(409);
  await post('finance',`/api/finance/payables/payments/${p}/void`,{reason:'转账登记重复'}).expect(200);
  await post('cashier',`/api/order-records/${id}/expenses/${e}/void`,{reason:'业务成本录错'}).expect(200);
  await get('admin','/api/finance/payables').expect(403);await get('supervisor','/api/finance/payables').expect(403);await post('boss','/api/finance/payables/payments',b).expect(403);await post('cashier','/api/finance/payables/payments',b).expect(403);
 });
 it("历史费用不推测已付或未付，财务明确核对后才进入付款台账",async()=>{
  const id=await order(),e=(await post('cashier',`/api/order-records/${id}/expenses`,{requestKey:randomUUID(),businessDate:today,category:'goods',label:'旧供货款',amountCny:'80.00'})).body.id;
  await db.query('UPDATE order_expenses SET payment_tracking_started=FALSE WHERE id=$1',[e]);
  expect((await get('finance','/api/finance/payables')).body.expenses.find((x:any)=>x.id===e)).toMatchObject({paymentState:'unknown',pending_cny:null});
  await post('finance','/api/finance/payables/payments',{expenseId:e,paidOn:today,payee:'供货商',account:'测试',reference:randomUUID(),amountCny:'20.00',requestKey:randomUUID()}).expect(409);
  await post('finance',`/api/finance/payables/expenses/${e}/track`,{reason:'已核对凭据，等待补录实际付款'}).expect(200);
  expect((await get('finance','/api/finance/payables')).body.expenses.find((x:any)=>x.id===e)).toMatchObject({paymentState:'unpaid',pending_cny:'80.00'});
 });
 it("广告预存实付CNY与消耗USD分开，日报多个人设消耗只扣一次",async()=>{
  const code='AD-'+randomUUID();await post('operations','/api/ad-accounts',{code,name:'测试广告户',openedOn:today,openingUsd:'100.00'}).expect(200);
  const topup={accountRef:code,paidOn:today,creditedUsd:'500.00',paidCny:'3600.00',paymentAccount:'测试付款户',reference:randomUUID(),requestKey:randomUUID()};
  const t=await post('operations','/api/ad-accounts/topups',topup).expect(200);expect((await post('operations','/api/ad-accounts/topups',topup).expect(200)).body.id).toBe(t.body.id);
  for(const [personaName,spendUsd] of [['测试人设甲','50.00'],['测试人设乙','20.00']])await clients.operations.agent.put('/api/ops-reports').set('Origin',origin).set('X-CSRF-Token',clients.operations.token).send({businessDate:today,personaName,spendUsd,adAccountRef:code}).expect(200);
  let a=(await get('boss','/api/ad-accounts')).body.accounts.find((x:any)=>x.code===code);expect(a).toMatchObject({topped_usd:'500.00',spent_usd:'70.00',balance_usd:'530.00'});
  await post('finance',`/api/ad-accounts/topups/${t.body.id}/void`,{reason:'充值登记错误'}).expect(200);a=(await get('boss','/api/ad-accounts')).body.accounts.find((x:any)=>x.code===code);expect(a.balance_usd).toBe('30.00');
  await get('admin','/api/ad-accounts').expect(403);await get('cashier','/api/ad-accounts').expect(403);await post('boss','/api/ad-accounts/topups',topup).expect(403);
 });
 it("三位拍剪老师可各自负责多个人设，同人设库存逐师取末次",async()=>{
  const baselineInventory=(await get('boss','/api/editor-reports/summary')).body.endingInventory;
  const put=async(editorName:string,personaName:string,inventorySnapshot:number)=>clients.production.agent.put('/api/editor-reports').set('Origin',origin).set('X-CSRF-Token',clients.production.token).send({businessDate:today,editorName,personaName,inventorySnapshot,shootCount:1,editCount:1,sentToOpsCount:1}).expect(200);
  await put('魏磊','测试A',5);await put('魏磊','测试B',3);await put('尚杰','测试A',7);await put('十七','测试C',4);
  const rows=(await get('boss','/api/editor-reports')).body.reports;expect(rows.filter((r:any)=>r.editorName==='魏磊')).toHaveLength(2);
  expect((await get('boss','/api/editor-reports/summary')).body.endingInventory).toBe(baselineInventory+19);
  await put('魏磊','测试A',6);expect((await get('boss','/api/editor-reports/summary')).body.endingInventory).toBe(baselineInventory+20);
  await clients.production.agent.put('/api/editor-reports').set('Origin',origin).set('X-CSRF-Token',clients.production.token).send({businessDate:today,editorName:'其他人',personaName:'A'}).expect(400);
 });
 it("逐块10%精确到分，成品不加费，旧统计仅计一次成交",async()=>{
  const id=await order(),d=(await get("boss",`/api/order-records/${id}`).expect(200)).body;
  expect(d.order.amount).toBe("130.06");expect(d.items.find((i:any)=>i.kind==="material").buying_fee_cny).toBe("10.01");expect(d.items.find((i:any)=>i.kind==="finished").buying_fee_cny).toBe("0.00");expect(d.balance).toBe("3000.00");expect(d.paid).toBe("0.00");
  const list=(await get("boss","/api/orders")).body.orders;expect(list.find((o:any)=>o.id===id)).toMatchObject({amount:"130.06",workflowEnabled:true});
 });
 it("同请求重试只建一单，变更内容及他人同键不重放",async()=>{
  const b=body(),first=await post("cashier","/api/order-records",b).expect(200);const second=await post("cashier","/api/order-records",b).expect(200);expect(second.body.id).toBe(first.body.id);
  await post("cashier","/api/order-records",{...b,operatorName:"改名"}).expect(409);await post("othercs","/api/order-records",b).expect(409);
 });
 it("人民币应收由成交合计计算，客户输入不能篡改金额",async()=>{
  const id=await order({customerCurrency:"CNY",customerDue:"1.00"});expect((await get("cashier",`/api/order-records/${id}`)).body.details.customerDue).toBe("130.06");await post("cashier","/api/order-records",body({items:[{kind:"material",label:"错误",priceCny:"1.001"}]})).expect(400);
 });
 it("无有效收款时可更正成交，带版本与原因并保留修改轨迹",async()=>{
  const id=await order(),base=body({version:1,reason:"测试录错成交",items:[{kind:"material",label:"更正料子",priceCny:"200.00"}]});
  function edit(who:string,payload:object){return clients[who].agent.patch(`/api/order-records/${id}`).set("Origin",origin).set("X-CSRF-Token",clients[who].token).send(payload);}
  await edit("cashier",base).expect(200);let d=(await get("boss",`/api/order-records/${id}`)).body;expect(d.order.amount).toBe("220.00");expect(d.details.version).toBe(2);await edit("cashier",base).expect(409);await edit("othercs",{...base,version:2}).expect(404);await payment(id);await edit("cashier",{...base,version:3}).expect(409);
  const log=(await db.query("SELECT before_data,after_data FROM audit_logs WHERE entity_id=$1 AND action='order_record_correct'",[id])).rows[0];expect(log.before_data.order.amount).toBe("130.06");expect(log.after_data.reason).toBe("测试录错成交");
 });
 it("主管范围与员工轮换分离，管理员和财务不能读成本档案",async()=>{
  const id=await order();await get("supervisor",`/api/order-records/${id}`).expect(200);await get("unassigned",`/api/order-records/${id}`).expect(404);await get("othercs",`/api/order-records/${id}`).expect(404);await get("admin",`/api/order-records/${id}`).expect(403);await get("finance",`/api/order-records/${id}`).expect(403);
  await post("supervisor",`/api/order-records/${id}/shipping`,{shippedOn:today}).expect(403);await post("boss","/api/order-records",body()).expect(403);
  const prior=await order({businessDate:"2025-01-01"});await get("supervisor",`/api/order-records/${prior}`).expect(404);
 });
 it("作废付款后仍保留其约定币种，不能改币种重解释旧抵扣额",async()=>{
  const id=await order(),p=await payment(id);await post("cashier",`/api/order-records/${id}/payments/${p}/void`,{reason:"测试纠错"}).expect(200);
  const patch=body({version:3,reason:"修改成交",customerCurrency:"USD",customerDue:"100.00"});
  await clients.cashier.agent.patch(`/api/order-records/${id}`).set("Origin",origin).set("X-CSRF-Token",clients.cashier.token).send(patch).expect(409);
  const d=(await get("cashier",`/api/order-records/${id}`)).body;expect(d.details.customerCurrency).toBe("TWD");expect(d.payments[0].credit_amount).toBe("1000.00");expect(d.balance).toBe("3000.00");
 });
 it("分次定金尾款、收款幂等与超过欠款拒绝",async()=>{
  const id=await order(),b={requestKey:randomUUID(),paymentDate:today,amount:"1000.00",currency:"TWD",purpose:"deposit",channel:"测试代收账户",thirdParty:true};
  const one=await post("cashier",`/api/order-records/${id}/payments`,b).expect(200);expect((await post("cashier",`/api/order-records/${id}/payments`,b).expect(200)).body.id).toBe(one.body.id);
  expect((await get("cashier",`/api/order-records/${id}`)).body.balance).toBe("2000.00");await payment(id,{amount:"2000.00",purpose:"balance"});expect((await get("cashier",`/api/order-records/${id}`)).body.balance).toBe("0.00");await post("cashier",`/api/order-records/${id}/payments`,{...b,requestKey:randomUUID(),amount:"1.00"}).expect(409);
 });
 it("并发收款不能超收；拒绝跨订单重放与不明币种",async()=>{
  const id=await order({customerDue:"1000.00"});const b={paymentDate:today,amount:"700.00",currency:"TWD",purpose:"deposit",channel:"并发账户",thirdParty:true};const key=randomUUID(),secondKey=randomUUID();
  const results=await Promise.all([post("cashier",`/api/order-records/${id}/payments`,{...b,requestKey:key}),post("cashier",`/api/order-records/${id}/payments`,{...b,requestKey:secondKey})]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const usedKey=results[0].status===200?key:secondKey;
  await post("cashier",`/api/order-records/${await order()}/payments`,{...b,requestKey:usedKey}).expect(409);await post("cashier",`/api/order-records/${id}/payments`,{...b,currency:"HKD",requestKey:randomUUID()}).expect(400);
 });
 it("异币付款明确抵扣金额，不采用未来结汇汇率",async()=>{
  const id=await order();await payment(id,{currency:"USD",amount:"100.00",creditAmount:"3000.00"});const d=(await get("cashier",`/api/order-records/${id}`)).body;expect(d.balance).toBe("0.00");expect(d.payments[0]).toMatchObject({amount:"100.00",currency:"USD",credit_amount:"3000.00"});
 });
 it("结汇扣点由公司承担，客户结清不受净到账差异影响",async()=>{
  const id=await order({customerDue:"1000.00"}),p=await payment(id),b=settlement(p),s=await post("finance","/api/finance/settlements",b).expect(200);expect((await post("finance","/api/finance/settlements",b).expect(200)).body.id).toBe(s.body.id);
  const f=(await get("finance","/api/finance").expect(200)).body;expect(f.payments.find((x:any)=>x.id===p).pendingAmount).toBe("0.00");expect(f.settlements.find((x:any)=>x.id===s.body.id)).toMatchObject({net_cny:"203.70",fee_amount:"30.00"});expect((await get("boss",`/api/order-records/${id}`)).body.balance).toBe("0.00");
  expect(JSON.stringify(f)).not.toContain("custom_product_cost");expect(JSON.stringify(f)).not.toContain("image_bytes");
 });
 it("部分结算和多单匹配，净到账分配合计必须相等",async()=>{
  const p=await payment(await order()),q=await payment(await order());const allocations=[{paymentId:p,foreignAmount:"400.00",netCny:"80.00"},{paymentId:q,foreignAmount:"700.00",netCny:"140.00"}];
  await post("finance","/api/finance/settlements",settlement(p,{netCny:"220.00",allocations})).expect(200);const f=(await get("finance","/api/finance")).body;expect(f.payments.find((x:any)=>x.id===p).pendingAmount).toBe("600.00");expect(f.payments.find((x:any)=>x.id===q).pendingAmount).toBe("300.00");await post("finance","/api/finance/settlements",settlement(p,{netCny:"1.00",allocations})).expect(400);
 });
 it("并发结算不重复消耗收款，直接人民币不能伪装成第三方",async()=>{
  const p=await payment(await order());const responses=await Promise.all([post("finance","/api/finance/settlements",settlement(p)),post("finance","/api/finance/settlements",settlement(p))]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  const direct=await payment(await order({customerCurrency:"CNY"}),{amount:"10.00",currency:"CNY",thirdParty:false});await post("finance","/api/finance/settlements",settlement(direct,{currency:"CNY"})).expect(409);
 });
 it("作废结算只恢复待结算，已结算收款须先由财务纠错",async()=>{
  const id=await order(),p=await payment(id),s=(await post("finance","/api/finance/settlements",settlement(p)).expect(200)).body.id;
  await post("cashier",`/api/order-records/${id}/payments/${p}/void`,{reason:"录错"}).expect(409);
  await post("finance",`/api/finance/settlements/${s}/void`,{reason:"结算录错"}).expect(200);let d=(await get("cashier",`/api/order-records/${id}`)).body;expect(d.balance).toBe("2000.00");expect(d.payments[0].settled_amount).toBe("0.00");await post("cashier",`/api/order-records/${id}/payments/${p}/void`,{reason:"原付款重复登记"}).expect(200);d=(await get("cashier",`/api/order-records/${id}`)).body;expect(d.balance).toBe("3000.00");expect(d.payments[0].void_reason).toBe("原付款重复登记");
 });
 it("费用明细同步旧汇总字段且不重复计入，可纠错保留痕迹",async()=>{
  const id=await order();let expenseId="";for(const [category,value] of [["goods","400.00"],["certificate","6.00"],["box","9.00"],["shipping","30.00"],["labor","5.00"]]){const b={requestKey:randomUUID(),businessDate:today,category,label:"虚构费用",amountCny:value};const r=await post("cashier",`/api/order-records/${id}/expenses`,b).expect(200);expect((await post("cashier",`/api/order-records/${id}/expenses`,b)).body.id).toBe(r.body.id);if(category==="box")expenseId=r.body.id;}
  let d=(await get("boss",`/api/order-records/${id}`)).body;expect(d.expenseTotal).toBe("450.00");expect(d.order).toMatchObject({custom_product_cost:"415.00",labor_cost:"5.00",shipping_cost:"30.00"});await post("cashier",`/api/order-records/${id}/expenses/${expenseId}/void`,{reason:"包装费录错"}).expect(200);expect((await post("cashier",`/api/order-records/${id}/expenses/${expenseId}/void`,{reason:"网络重试不改原原因"}).expect(200)).body.id).toBe(expenseId);d=(await get("boss",`/api/order-records/${id}`)).body;expect(d.expenseTotal).toBe("441.00");expect(d.order.custom_product_cost).toBe("406.00");
 });
 it("原图按订单权限读取，不入静态目录，防伪造格式和跨单关联",async()=>{
  const id=await order();const image=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=","base64");
  function upload(path:string,bytes=image,type="image/png"){return clients.cashier.agent.post(path).set("Origin",origin).set("X-CSRF-Token",clients.cashier.token).set("Content-Type",type).send(bytes);}
  const a=(await upload(`/api/order-records/${id}/attachments?filename=fixture.png`).expect(200)).body.id;expect((await upload(`/api/order-records/${id}/attachments?filename=same.png`).expect(200)).body.id).toBe(a);
  const path=`/api/order-records/${id}/attachments/${a}`,r=await get("boss",path).expect(200);expect(r.headers["cache-control"]).toBe("private, no-store");expect(Buffer.compare(r.body,image)).toBe(0);await get("supervisor",path).expect(200);for(const name of ["admin","finance","othercs","unassigned"])await get(name,path).expect(name==="othercs"||name==="unassigned"?404:403);
  await upload(`/api/order-records/${id}/attachments`,Buffer.from("<svg>bad image</svg>")).expect(400);await upload(`/api/order-records/${id}/attachments`,image,"image/jpeg").expect(400);await upload(`/api/order-records/${id}/attachments`,Buffer.alloc(8*1024*1024+1)).expect(413);
  const other=await order(),item=(await get("cashier",`/api/order-records/${other}`)).body.items[0].id;await upload(`/api/order-records/${id}/attachments?itemId=${item}`,Buffer.concat([image,Buffer.from("new")])).expect(400);
 });
 it("财务只能登记结算，BOSS只读，管理员只配置",async()=>{
  for(const who of ["admin","supervisor","cashier"])await get(who,"/api/finance").expect(403);await get("boss","/api/finance").expect(200);
  for(const path of ["/api/admin/users","/api/cs-accounts","/api/dashboard/summary","/api/orders","/api/ops-reports"])await get("finance",path).expect(403);
  await post("boss","/api/finance/settlements",{}).expect(403);await post("cashier","/api/finance/settlements",{}).expect(403);await post("finance","/api/order-records",body()).expect(403);
  const r=await post("admin","/api/admin/users",{username:"new_finance",displayName:"测试财务",password:"NewFinanceFixture1234",role:"finance"}).expect(201);expect(r.body.user.role).toBe("finance");
 });
 it("旧记录不补造付款，新档案不允许旧接口覆盖金额",async()=>{
  const legacy=(await post("cashier","/api/orders",{orderRef:"LEGACY-"+randomUUID(),amount:"99.00",businessDate:today}).expect(201)).body.order.id;expect((await get("cashier",`/api/order-records/${legacy}`)).body.legacy).toBe(true);await post("cashier",`/api/order-records/${legacy}/payments`,{}).expect(409);
  const id=await order();await clients.cashier.agent.patch(`/api/orders/${id}`).set("Origin",origin).set("X-CSRF-Token",clients.cashier.token).send({amount:"1.00"}).expect(409);
 });
 it("发货不改变应收已付，模块关闭禁止新增订单资料且保留读取",async()=>{
  const id=await order();await post("cashier",`/api/order-records/${id}/shipping`,{shippedOn:today}).expect(200);let d=(await get("cashier",`/api/order-records/${id}`)).body;expect(d.details.shippedOn).toBe(today);expect(d.order.status).toBe("shipped");expect(d.paid).toBe("0.00");
  const config=(await get("admin","/api/modules")).body;await clients.admin.agent.put("/api/modules").set("Origin",origin).set("X-CSRF-Token",clients.admin.token).send({version:config.version,modules:{...config.modules,orders:false}}).expect(200);await post("cashier","/api/order-records",body()).expect(403);await get("cashier",`/api/order-records/${id}`).expect(200);
 });
});

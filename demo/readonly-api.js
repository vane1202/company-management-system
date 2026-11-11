/* Public fictional UI preview. No real authentication, database, or business write service. */
(() => {
  "use strict";
  const nativeFetch = window.fetch.bind(window);
  const roles = ["boss", "admin", "cs_supervisor", "finance"];
  const requestedRole = new URLSearchParams(window.location.search).get("role");
  let role = roles.includes(requestedRole) ? requestedRole : window.sessionStorage.getItem("cms-fictional-role") || "boss";
  if (!roles.includes(role)) role = "";
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const shift = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  const money = (cents) => { const sign = cents < 0n ? "-" : ""; const n = cents < 0n ? -cents : cents; return sign + n / 100n + "." + String(n % 100n).padStart(2, "0"); };
  const cents = (value) => BigInt(String(value).replace(".", ""));
  const sumMoney = (rows, key) => money(rows.reduce((sum, row) => sum + cents(row[key] || "0.00"), 0n));
  const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const meta = { today, timezone: "Asia/Shanghai", backfillDays: 3, disclaimer: "公开只读演示：所有账号、金额和记录均为虚构，不连接正式后台，不用于真实经营判断。" };
  const names = { boss: "演示 BOSS", admin: "演示后台管理员", cs_supervisor: "演示客服主管", finance:"演示财务" };
  const usernames = { boss: "demo_boss", admin: "demo_admin", cs_supervisor: "demo_supervisor", finance:"demo_finance" };
  const currentUser = () => ({ id: "demo-" + role, username: usernames[role], displayName: names[role], role, isActive: true, mustChangePassword: false, accountKind: "employee" });
  const teams = [{ id: "demo-team-a", name: "演示一组" }, { id: "demo-team-b", name: "演示二组" }];
  // 第 3 个虚构微信归演示一组、今日未报，用于展示“今日未报”提示；无订单、无加粉记录。
  const accounts = [...teams, teams[0]].map((team, i) => ({ id: "demo-wechat-" + (i + 1), wechatId: "Demo_WeChat_0" + (i + 1), phoneLabel: "演示客服手机 0" + (i + 1), isActive: true, teamId: team.id, teamName: team.name, createdAt: today + "T01:00:00Z" }));
  accounts.forEach((a,i)=>{a.platform=i===1?'whatsapp':'messenger';a.accountIdentifier=i===1?'+999000000002':'demo.messenger.0'+(i+1);a.wechatId=(a.platform==='whatsapp'?'WhatsApp':'Messenger')+' · '+a.accountIdentifier;});
  const staff = [...roles.map((r) => ({ id: "demo-" + r, username: usernames[r], displayName: names[r], role: r, isActive: true, accountKind: "employee", managedTeamIds: r === "cs_supervisor" ? [teams[0].id] : [], currentTeam: null })), ...["ops", "editor", "assistant"].map((r) => ({ id: "demo-" + r, username: "demo_" + r, displayName: {ops:"演示运营",editor:"演示拍剪",assistant:"演示助理"}[r], role: r, isActive: true, accountKind: "employee", currentTeam: null }))];
  const assetUsers = accounts.map((a) => ({ id: a.id, username: a.wechatId, displayName: a.wechatId, wechatId: a.wechatId, accountKind: "cs_service", role: "cs", isActive: true, currentTeam: { id: a.teamId, name: a.teamName } }));
  const fans = [
    { id:"demo-fan-1", userId:accounts[0].id, businessDate:today, pageName:"演示主页 A", msToday:4, wsToday:3, msMonth:120, wsMonth:48, validToday:5, commReplied:3, commReadNoReply:1, commUnread:1, commInvalid:1, addedCount:7 },
    { id:"demo-fan-2", userId:accounts[1].id, businessDate:today, pageName:"演示主页 B", msToday:3, wsToday:2, msMonth:96, wsMonth:35, validToday:4, commReplied:2, commReadNoReply:1, commUnread:1, commInvalid:1, addedCount:5 },
    { id:"demo-fan-3", userId:accounts[0].id, businessDate:shift(today,-1), pageName:"演示主页 A", msToday:2, wsToday:2, msMonth:116, wsMonth:45, validToday:3, commReplied:2, commReadNoReply:0, commUnread:1, commInvalid:1, addedCount:4 },
    // 近 7 天趋势用的虚构历史日报；shift(today,-4) 故意没有任何填报，用来展示趋势线断开。
    { id:"demo-fan-4", userId:accounts[0].id, businessDate:shift(today,-2), pageName:"演示主页 A", msToday:3, wsToday:2, msMonth:114, wsMonth:43, validToday:4, commReplied:2, commReadNoReply:1, commUnread:1, commInvalid:1, addedCount:5 },
    { id:"demo-fan-5", userId:accounts[1].id, businessDate:shift(today,-2), pageName:"演示主页 B", msToday:2, wsToday:1, msMonth:93, wsMonth:33, validToday:2, commReplied:1, commReadNoReply:1, commUnread:0, commInvalid:1, addedCount:3 },
    { id:"demo-fan-6", userId:accounts[0].id, businessDate:shift(today,-3), pageName:"演示主页 A", msToday:4, wsToday:2, msMonth:111, wsMonth:41, validToday:5, commReplied:3, commReadNoReply:1, commUnread:1, commInvalid:1, addedCount:6 },
    { id:"demo-fan-7", userId:accounts[0].id, businessDate:shift(today,-5), pageName:"演示主页 A", msToday:2, wsToday:1, msMonth:105, wsMonth:39, validToday:2, commReplied:1, commReadNoReply:1, commUnread:0, commInvalid:1, addedCount:3 },
    { id:"demo-fan-8", userId:accounts[1].id, businessDate:shift(today,-5), pageName:"演示主页 B", msToday:1, wsToday:1, msMonth:90, wsMonth:32, validToday:2, commReplied:1, commReadNoReply:0, commUnread:1, commInvalid:0, addedCount:2 },
    { id:"demo-fan-9", userId:accounts[1].id, businessDate:shift(today,-6), pageName:"演示主页 B", msToday:3, wsToday:1, msMonth:88, wsMonth:31, validToday:3, commReplied:2, commReadNoReply:1, commUnread:0, commInvalid:1, addedCount:4 }
  ].map((row) => ({ ...row, note:"虚构演示记录", recordVersion:1, updatedAt:row.businessDate+"T02:00:00Z", isLegacyUnclassified:false }));
  fans.forEach(f=>{const index=accounts.findIndex(a=>a.id===f.userId);if(index===1){f.wsToday=f.addedCount;f.msToday=0;f.wsMonth=f.businessDate===today?83:f.wsMonth;f.msMonth=0;}else{f.msToday=f.addedCount;f.wsToday=0;f.msMonth=f.businessDate===today?216:f.msMonth;f.wsMonth=0;}});
  const orders = [
    { id:"demo-order-1", userId:accounts[0].id, businessDate:today, orderRef:"DEMO-A-001", customerLabel:"演示客户甲", amount:"1290.50", status:"shipped", customProductCost:"900.00", laborCost:"50.00", shippingCost:"20.00" },
    { id:"demo-order-2", userId:accounts[0].id, businessDate:today, orderRef:"DEMO-A-002", customerLabel:"演示客户乙", amount:"680.00", status:"placed", customProductCost:"400.00", laborCost:"20.00", shippingCost:"10.00" },
    { id:"demo-order-3", userId:accounts[1].id, businessDate:shift(today,-1), orderRef:"DEMO-B-001", customerLabel:"演示客户丙", amount:"950.00", status:"in_production", customProductCost:"600.00", laborCost:"30.00", shippingCost:"15.00" },
    { id:"demo-order-4", userId:accounts[1].id, businessDate:today, orderRef:"DEMO-B-002", customerLabel:"演示客户丁", amount:"180.00", status:"refunded", customProductCost:"80.00", laborCost:"0.00", shippingCost:"0.00" },
    // 两笔昨日虚构开单：一笔已登记跑单（回冲原开单日），一笔未付款、可由本组主管登记跑单。
    { id:"demo-order-5", userId:accounts[0].id, businessDate:shift(today,-1), orderRef:"DEMO-A-003", customerLabel:"演示客户戊", amount:"330.00", status:"placed", customProductCost:"0.00", laborCost:"0.00", shippingCost:"0.00", cancelled:true },
    { id:"demo-order-6", userId:accounts[0].id, businessDate:shift(today,-1), orderRef:"DEMO-A-004", customerLabel:"演示客户己", amount:"550.00", status:"placed", customProductCost:"0.00", laborCost:"0.00", shippingCost:"0.00" }
  ].map((row) => ({ ...row, wechatId:accounts.find((a)=>a.id===row.userId).wechatId, displayName:accounts.find((a)=>a.id===row.userId).wechatId, accountKind:"cs_service", isCustom:true, recordVersion:1, updatedAt:row.businessDate+"T03:00:00Z" }));
  const ops = [{ id:"demo-ops-1",userId:"demo-ops",businessDate:today,personaName:"演示主页 A",adAccountRef:"DEMO-ADS-01",platform:"演示平台",spendUsd:"29.20",consultCount:6,consultCostUsd:"4.87",clickCount:180,ctrPercent:"1.25",balanceUsd:"120.80",promoCost:"0.00",promoVideoCount:2,note:"全部数值为虚构示例", recordVersion:1,updatedAt:today+"T03:20:00Z" }];
  const editors = [4,3,2,4,3,2].map((inventorySnapshot,i)=>({id:'demo-editor-'+(i+1),userId:'demo-editor',editorName:['魏磊','尚杰','十七'][Math.floor(i/2)],businessDate:today,personaName:['演示人设 A','演示人设 B'][i%2],shootCount:[2,1,1,1,1,0][i],editCount:[1,1,1,1,0,0][i],sentToOpsCount:i<3?1:0,finishedCount:0,publishedCount:0,inventorySnapshot,inventoryAdjusted:false,recordVersion:1,updatedAt:today+'T03:30:00Z'}));
  const visibleAccounts = () => role === "cs_supervisor" ? accounts.filter((a)=>a.teamId===teams[0].id) : accounts;
  const leadFixtures = fans.filter(f=>f.businessDate>=shift(today,-1)).flatMap(f=>Array.from({length:f.addedCount},(_,i)=>{
    const a=accounts.find(a=>a.id===f.userId),same=i===0||i===2,late=f.businessDate!==today&&i===1,qual=same?f.businessDate:late?today:null;
    return {id:'demo-lead-'+f.id+'-'+i,accountId:a.id,wechatId:a.wechatId,teamId:a.teamId,teamName:a.teamName,receivedOn:f.businessDate,pageName:f.pageName,personaCode:a.id===accounts[0].id?'DEMO-P-A':'DEMO-P-B',operatorName:a.id===accounts[0].id?'演示客服甲':'演示客服乙',channel:i<f.msToday?'ms':'ws',customerLabel:'虚构线索客户 '+(i+1),customerRef:'DEMO-'+f.id+'-'+i,contactStatus:qual||i===1?'replied':i%2?'read_no_reply':'unread',repliedOn:qual||i===1?f.businessDate:null,qualifiedOn:qual,needSummary:qual?'虚构示例：白冰手镯，预算4000台币':'',invalidReason:i===f.addedCount-1?'虚构示例：垃圾推广':'',lossReason:i===2?'虚构示例：报价后因预算不接受流失':'',nextFollowup:!qual?today:null,note:'纯虚构线索，不含用户提供的真实客户姓名或报表',version:1,voidedAt:null,voidReason:null};
  }));
  function leadDemo(q){const from=q.get('from')||today,to=q.get('to')||today,allowed=visibleAccounts().map(a=>a.id);return {from,to,today,leads:leadFixtures.filter(l=>allowed.includes(l.accountId)&&l.receivedOn>=from&&l.receivedOn<=to),reports:fans.filter(f=>allowed.includes(f.userId)&&f.businessDate>=from&&f.businessDate<=to).map(f=>({accountId:f.userId,businessDate:f.businessDate,pageName:f.pageName,msToday:f.msToday,wsToday:f.wsToday,addedCount:f.addedCount}))};}
  const visibleTeams = () => role === "cs_supervisor" ? [teams[0]] : teams;
  const visibleOrders = () => orders.filter((o)=>visibleAccounts().some((a)=>a.id===o.userId));
  orders.forEach((o,index)=>{o.workflowEnabled=index<3||index>=4;o.cancelled=!!o.cancelled;Object.assign(o,{personaCode:index===2?'DEMO-P-B':'DEMO-P-A',personaName:index===2?'演示人设 B':'演示人设 A',liveRoomCode:index===2?'DEMO-LIVE-02':'DEMO-LIVE-01',hostName:index===2?'演示主播乙':'演示主播甲',customerCode:'DEMO-C-'+(index+1),operatorName:'演示经办员'});});
  // Same acquisition persona may lead into different receiving groups/rooms; it is not a fixed room assignment.
  Object.assign(orders[2],{personaCode:'DEMO-P-A',personaName:'演示人设 A'});
  Object.assign(orders[3],{liveRoomCode:'',hostName:'',personaCode:'',personaName:'',customerCode:'',operatorName:''});
  const payments=[
    {id:"demo-payment-a",order_id:orders[0].id,order_ref:orders[0].orderRef,customer_label:orders[0].customerLabel,persona_name:"演示人设 A",wechat_id:accounts[0].wechatId,payment_date:today,amount:"1290.50",currency:"CNY",credit_amount:"1290.50",customer_currency:"CNY",purpose:"full",channel:"演示支付宝账户",third_party:false,reference:"DEMO-PAY-001",voided_at:null,settled_amount:"0.00",pendingAmount:"0.00"},
    {id:"demo-payment-b",order_id:orders[1].id,order_ref:orders[1].orderRef,customer_label:orders[1].customerLabel,persona_name:"演示人设 A",wechat_id:accounts[0].wechatId,payment_date:today,amount:"1200.00",currency:"TWD",credit_amount:"1200.00",customer_currency:"TWD",purpose:"deposit",channel:"演示台币代收账户",third_party:true,reference:"DEMO-PAY-002",voided_at:null,settled_amount:"0.00",pendingAmount:"1200.00"},
    {id:"demo-payment-c",order_id:orders[2].id,order_ref:orders[2].orderRef,customer_label:orders[2].customerLabel,persona_name:"演示人设 B",wechat_id:accounts[1].wechatId,payment_date:today,amount:"140.00",currency:"USD",credit_amount:"140.00",customer_currency:"USD",purpose:"full",channel:"演示美元代收账户",third_party:true,reference:"DEMO-PAY-003",voided_at:null,settled_amount:"50.00",pendingAmount:"90.00"}
  ];
  const settlements=[{id:"demo-settlement-a",reference:"DEMO-SET-001",channel:"演示美元代收账户",currency:"USD",settled_on:today,fee_amount:"1.00",fee_currency:"USD",fee_percent:"2.0000",fx_rate:"6.600000",net_cny:"323.40",note:"虚构部分结算；扣费已体现在净到账",voided_at:null,void_reason:null,allocations:[{paymentId:"demo-payment-c",foreignAmount:"50.00",netCny:"323.40"}]}];
  /* 虚构工资数据：工资标准、财务手工项目（提成/奖金/扣款）与锁定状态。经营估算与工资页共用同一组标准。 */
  const salaryStaff=[{id:"demo-ops",displayName:"演示运营",username:"demo_ops",role:"ops"},{id:"demo-editor",displayName:"演示拍剪",username:"demo_editor",role:"editor"},{id:"demo-cs_supervisor",displayName:"演示客服主管",username:"demo_supervisor",role:"cs_supervisor"}];
  const salaryStandards=[{id:"demo-salary-1",userId:"demo-ops",monthlyAmount:"6000.00",effectiveFrom:"2026-01-01",effectiveTo:null},{id:"demo-salary-2",userId:"demo-editor",monthlyAmount:"5200.00",effectiveFrom:"2026-01-01",effectiveTo:null},{id:"demo-salary-3",userId:"demo-cs_supervisor",monthlyAmount:"4800.00",effectiveFrom:"2026-01-01",effectiveTo:null}];
  const thisMonth=today.slice(0,7);
  const payrollItems=[
    {id:"demo-pi-1",userId:"demo-ops",kind:"commission",amount:"1280.50",note:"演示：投放达标提成（财务手填）"},
    {id:"demo-pi-2",userId:"demo-ops",kind:"deduction",amount:"100.00",note:"演示：借支扣回"},
    {id:"demo-pi-3",userId:"demo-editor",kind:"bonus",amount:"300.00",note:"演示：全勤奖"},
    {id:"demo-pi-4",userId:"demo-editor",kind:"bonus",amount:"50.00",note:"演示：重复录入",voided:true,voidReason:"演示：重复录入作废"},
    {id:"demo-pi-5",userId:"demo-cs_supervisor",kind:"deduction",amount:"5000.00",note:"演示：扣回多发（负数实发示例）"}
  ].map(i=>({...i,month:thisMonth,version:i.voided?2:1,createdAt:today+"T02:00:00Z",createdByName:"演示财务",voided:!!i.voided,voidedAt:i.voided?today+"T03:00:00Z":null,voidReason:i.voidReason||null,voidedByName:i.voided?"演示财务":null,correctsId:null,correctedById:null}));
  const lockedPayroll={"demo-ops":true};
  const dim=(iso)=>new Date(Date.UTC(Number(iso.slice(0,4)),Number(iso.slice(5,7)),0)).getUTCDate();
  const addDay=(iso)=>shift(iso,1);
  function allocate(rows,from,to){
    let total=0n;
    for(const row of rows){
      const start=row.effectiveFrom>from?row.effectiveFrom:from,end=row.effectiveTo&&row.effectiveTo<to?row.effectiveTo:to;if(start>end)continue;
      const monthly=cents(row.monthlyAmount);let cursor=start;
      while(cursor<=end){const ms=cursor.slice(0,8)+"01",me=ms.slice(0,8)+String(dim(ms)).padStart(2,"0"),segEnd=me<end?me:end,days=BigInt(Math.round((Date.parse(segEnd)-Date.parse(cursor))/86400000)+1),total_days=BigInt(dim(ms));total+=cursor===ms&&segEnd===me?monthly:monthly*days/total_days;cursor=addDay(segEnd);}
    }
    return money(total);
  }
  function payrollMonth(month,userId){
    const from=month+"-01",to=month+"-"+String(dim(from)).padStart(2,"0");
    const staffRows=salaryStaff.filter(e=>!userId||e.id===userId).map(e=>{
      const records=salaryStandards.filter(r=>r.userId===e.id&&r.effectiveFrom<=to&&(!r.effectiveTo||r.effectiveTo>=from));
      const items=payrollItems.filter(i=>i.userId===e.id&&i.month===month);
      const live=items.filter(i=>!i.voided);const pick=k=>money(live.filter(i=>i.kind===k).reduce((t,i)=>t+cents(i.amount),0n));
      const base=allocate(records,from,to),commission=pick("commission"),bonus=pick("bonus"),deduction=pick("deduction"),net=money(cents(base)+cents(commission)+cents(bonus)-cents(deduction));
      const locked=month===thisMonth&&!!lockedPayroll[e.id];
      return {userId:e.id,displayName:e.displayName,username:e.username,role:e.role,isActive:true,base,commission,bonus,deduction,net,netNegative:net.startsWith("-"),status:locked?"locked":"draft",statusVersion:locked?1:0,lockedAt:locked?today+"T04:00:00Z":null,liveBase:base,liveNet:net,changedAfterLock:false,baseRecords:records.map(r=>({id:r.id,monthlyAmount:r.monthlyAmount,effectiveFrom:r.effectiveFrom,effectiveTo:r.effectiveTo,allocated:allocate([r],from,to)})),items};
    }).filter(e=>e.baseRecords.length||e.items.length);
    const tot=rows=>{const t=Object.fromEntries(["base","commission","bonus","deduction","net"].map(k=>[k,sumMoney(rows,k)]));return {...t,netNegative:t.net.startsWith("-")};};
    return {month,period:{from,to},totals:{...tot(staffRows),employeeCount:staffRows.length,negativeCount:staffRows.filter(e=>e.netNegative).length,lockedCount:staffRows.filter(e=>e.status==="locked").length},roles:[...new Set(staffRows.map(e=>e.role))].map(r=>{const m=staffRows.filter(e=>e.role===r);return {role:r,employeeCount:m.length,...tot(m)};}),employees:staffRows,note:"公开演示：实发 = 底薪 + 提成 + 奖金 − 扣款，人民币精确到分；提成、奖金、扣款由财务手工录入。全部金额与人员均为虚构。"};
  }
  function salaryApi(path,q){
    const withStaff=r=>{const e=salaryStaff.find(x=>x.id===r.userId);return {...r,displayName:e.displayName,username:e.username,role:e.role,isActive:true,createdAt:"2026-01-01T01:00:00Z",recordVersion:"1"};};
    if(path==="/api/salaries")return json({salaries:salaryStandards.filter(r=>!q.get("userId")||r.userId===q.get("userId")).map(withStaff)});
    if(path==="/api/salaries/employees")return json({employees:salaryStaff.map(e=>({...e,isActive:true}))});
    if(path==="/api/salaries/summary"){
      const from=q.get("from")||today.slice(0,8)+"01",to=q.get("to")||today,userId=q.get("userId")||"";
      const employees=salaryStaff.filter(e=>!userId||e.id===userId).map(e=>{const records=salaryStandards.filter(r=>r.userId===e.id&&r.effectiveFrom<=to&&(!r.effectiveTo||r.effectiveTo>=from)).map(r=>({...withStaff(r),allocated:allocate([r],from,to)}));return {userId:e.id,displayName:e.displayName,username:e.username,role:e.role,isActive:true,allocated:sumMoney(records,"allocated"),records};}).filter(e=>e.records.length);
      return json({period:{from,to},totalAllocated:sumMoney(employees,"allocated"),employeeCount:employees.length,recordCount:employees.reduce((n,e)=>n+e.records.length,0),roles:[...new Set(employees.map(e=>e.role))].map(r=>({role:r,employeeCount:employees.filter(e=>e.role===r).length,allocated:sumMoney(employees.filter(e=>e.role===r),"allocated")})),employees,note:"公开演示：仅底薪按自然月天数分摊，全部为虚构。"});
    }
    if(path==="/api/salaries/payroll"){const month=q.get("month")||"";if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return json({error:"工资月份格式应为 YYYY-MM"},400);return json(payrollMonth(month,q.get("userId")||""));}
    if(path==="/api/salaries/payroll/items"){const month=q.get("month")||"";return json({items:payrollItems.filter(i=>i.month===month&&(!q.get("userId")||i.userId===q.get("userId")))});}
    if(/^\/api\/salaries\/(payroll\/items\/[^/]+|[^/]+)\/history$/.test(path)||path==="/api/salaries/payroll/months/history")return json({history:[]});
    return json({error:"只读演示未开放此操作或数据范围"},404);
  }
  payments.forEach(p=>{const o=orders.find(o=>o.id===p.order_id);Object.assign(p,{persona_code:o.personaCode,live_room_code:o.liveRoomCode,host_name:o.hostName,customer_code:o.customerCode,operator_name:o.operatorName});});
  function orderRecord(order){
    const index=orders.indexOf(order),raw={id:order.id,order_ref:order.orderRef,customer_label:order.customerLabel,business_date:order.businessDate,amount:order.amount,status:order.status,cancelled:!!order.cancelled,wechat_id:order.wechatId,display_name:order.displayName,note:'虚构演示记录',custom_product_cost:order.customProductCost,labor_cost:order.laborCost,shipping_cost:order.shippingCost};
    if(!order.workflowEnabled)return {order:raw,legacy:true};
    if(index>=4){
      // 虚构未付款开单：无追加、无收款、无成本；料价＋10%代购费即营业额。
      const price=index===4?'300.00':'500.00',fee=index===4?'30.00':'50.00';
      const cancellations=order.cancelled?[{id:'demo-cancellation-'+index,booked_on:order.businessDate,base_amount_cny:order.amount,reason:'虚构：客户跨日明确放弃付款',created_at:order.businessDate+'T10:00:00Z',created_by_name:'演示主管',voided_at:null,void_reason:null,voided_by_name:null}]:[];
      return {order:raw,cancellations,legacy:false,details:{personaName:order.personaName,personaCode:order.personaCode,liveRoomCode:order.liveRoomCode,hostName:order.hostName,customerCode:order.customerCode,operatorName:order.operatorName,source:'演示直播间',customerCurrency:'CNY',customerDue:order.amount,baseCustomerDue:order.amount,shippedOn:null,version:1},items:[{id:'demo-item-'+index,label:'演示原石',material_ref:'DEMO-JADE-'+(index+1),kind:'material',price_cny:price,buying_fee_cny:fee}],charges:[],payments:[],expenses:[],attachments:[],paid:'0.00',balance:order.amount,expenseTotal:'0.00'};
    }
    const cur=['CNY','TWD','USD'][index],due=['1290.50','3200.00','140.00'][index],paid=['1290.50','1200.00','140.00'][index];
    const charges=index===1?[{id:'demo-charge-1',business_date:order.businessDate,label:'设计雕刻费',amount_cny:'200.00',customer_amount:'900.00',note:'虚构配货：客户收费与采购成本分开',voided_at:null}]:index===2?[{id:'demo-charge-2',business_date:today,label:'旧单今日追加设计费',amount_cny:'100.00',customer_amount:'20.00',note:'虚构跨日追加收费',voided_at:null}]:[];
    const items=[{id:'demo-item-'+index,label:index<2?'演示原石':'演示成品',material_ref:'DEMO-JADE-'+(index+1),kind:index<2?'material':'finished',price_cny:index===0?'1173.18':index===1?'436.36':index===2?'850.00':order.amount,buying_fee_cny:index===0?'117.32':index===1?'43.64':'0.00'}];
    const expenses=[{id:'demo-expense-'+index,business_date:order.businessDate,category:'goods',label:'演示商品供货款',amount_cny:index===1?'150.00':order.customProductCost,counterparty:'演示供货方',item_id:items[0].id,note:'虚构成本资料',voided_at:null},{id:'demo-labor-'+index,business_date:order.businessDate,category:'design',label:'演示雕刻工费',amount_cny:order.laborCost,counterparty:'演示加工方',item_id:items[0].id,voided_at:null},{id:'demo-shipping-'+index,business_date:index===2?today:order.businessDate,category:'shipping',label:'演示运费',amount_cny:order.shippingCost,counterparty:'演示承运方',voided_at:null}];
    if(index===1)expenses.push({id:'demo-sourcing-1',business_date:order.businessDate,category:'sourcing',label:'市场购入替代翡翠成品',amount_cny:'250.00',counterparty:'演示市场商家',item_id:items[0].id,note:'原石不满足加工需求，采购成品交付客户',voided_at:null});
    return {order:raw,legacy:false,details:{personaName:order.personaName,personaCode:order.personaCode,liveRoomCode:order.liveRoomCode,hostName:order.hostName,customerCode:order.customerCode,operatorName:order.operatorName,source:'演示直播间',customerCurrency:cur,customerDue:due,baseCustomerDue:index===1?'2300.00':index===2?'120.00':due,shippedOn:order.status==='shipped'?today:null,version:1},items,charges,payments:payments.filter(p=>p.order_id===order.id),expenses,attachments:[],paid,balance:money(cents(due)-cents(paid)),expenseTotal:sumMoney(expenses,'amount_cny')};
  }
  const supplierPayments=[{id:'demo-supplier-payment-1',expense_id:'demo-expense-0',paid_on:today,payee:'演示供货方',account:'演示公司付款户',reference:'DEMO-SUP-PAY-001',amount_cny:'600.00',note:'虚构部分付款',voided_at:null}];
  function payables(){
    const expenses=orders.filter(o=>o.workflowEnabled).flatMap(o=>orderRecord(o).expenses.map(e=>({...e,order_id:o.id,order_ref:o.orderRef,customer_label:o.customerLabel,persona_name:o.personaName,persona_code:o.personaCode,live_room_code:o.liveRoomCode,host_name:o.hostName,customer_code:o.customerCode,operator_name:o.operatorName,wechat_id:o.wechatId,material_ref:'DEMO-JADE-'+(orders.indexOf(o)+1),item_label:'演示商品',paid_cny:e.id==='demo-expense-0'?'600.00':'0.00',pending_cny:money(cents(e.amount_cny)-(e.id==='demo-expense-0'?60000n:0n)),paymentState:e.id==='demo-expense-0'?'partial':'unpaid'})));
    return {expenses,payments:supplierPayments,summary:{costCny:sumMoney(expenses,'amount_cny'),paidCny:'600.00',pendingCny:sumMoney(expenses,'pending_cny'),unknownCount:0}};
  }
  const adLedger={accounts:[{code:'DEMO-ADS-01',name:'演示共享广告户',opened_on:today,opening_usd:'100.00',topped_usd:'50.00',spent_usd:'29.20',balance_usd:'120.80'}],topups:[{id:'demo-topup-1',account_ref:'DEMO-ADS-01',paid_on:today,credited_usd:'50.00',paid_cny:'360.00',payment_account:'演示公司付款户',reference:'DEMO-AD-PAY-001',note:'虚构充值，实付和美元入账独立记录',voided_at:null}],summary:{paidCny:'360.00',creditedUsd:'50.00',spentUsd:'29.20',balanceUsd:'120.80'}};
  const fanTotals = (rows) => {
    const latest=Object.values(rows.reduce((result,row)=>{const key=row.userId+row.pageName;if(!result[key]||row.businessDate>result[key].businessDate)result[key]=row;return result;},{}));
    return {...Object.fromEntries(["msToday","wsToday","validToday","commReplied","commReadNoReply","commUnread","commInvalid"].map((key)=>[key,sum(rows,key)])),msMonth:sum(latest,"msMonth"),wsMonth:sum(latest,"wsMonth")};
  };
  const csv=(values)=>values.map((value)=>'"'+String(value??"").replaceAll('"','""')+'"').join(",");
  function fanSummary(query) {
    const date = query.get("date") || today;
    const id = query.get("accountId");
    const result = visibleTeams().map((team) => {
      const members = visibleAccounts().filter((a)=>a.teamId===team.id && (!id || id===a.id));
      const rows = fans.filter((f)=>f.businessDate===date && members.some((a)=>a.id===f.userId));
      const details = members.map((member) => { const pages=rows.filter((f)=>f.userId===member.id).map((f)=>({...f,reportId:f.id})); return {userId:member.id,displayName:member.wechatId,wechatId:member.wechatId,accountKind:"cs_service",username:member.wechatId,addedCount:pages.length?sum(pages,"addedCount"):null,status:pages.length?"reported":"missing",updatedAt:pages[0]?.updatedAt||null,pages}; });
      const missing=details.filter((d)=>d.status==="missing");
      return {teamId:team.id,teamName:team.name,...fanTotals(rows),totalAdded:sum(rows,"addedCount"),expectedCount:members.length,reportedCount:details.length-missing.length,missingCount:missing.length,missing,details,statsIncomplete:false};
    }).filter((team)=>!id||team.expectedCount>0);
    return {date,teams:result};
  }
  function filteredOrders(query) {
    return visibleOrders().filter((o)=>(!query.get("userId")||o.userId===query.get("userId"))&&(!query.get("from")||o.businessDate>=query.get("from"))&&(!query.get("to")||o.businessDate<=query.get("to"))&&(!query.get("status")||o.status===query.get("status")));
  }
  function dashboardSeries(query) {
    const to=query.get("to")||today, n=query.get("days")==null?7:Number(query.get("days"));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(to)||Number.isNaN(Date.parse(to+"T00:00:00Z")))return json({error:"日期格式无效"},400);
    if(!Number.isInteger(n)||n<1||n>31)return json({error:"天数须为 1–31 的整数"},400);
    const from=shift(to,-(n-1));
    const days=Array.from({length:n},(_,i)=>{const date=shift(from,i),rows=fans.filter((f)=>f.businessDate===date);return {date,reports:rows.length,fanAdded:rows.length?sum(rows,"addedCount"):null,validToday:rows.length?sum(rows,"validToday"):null,partial:date===today};});
    return json({from,to,today,days});
  }
  const paidPerformanceRecords=[{id:'demo-paid-1',business_date:today,live_room_code:'DEMO-LIVE-01',host_name:'演示主播甲',amount_cny:'1290.50',note:'虚构财务专项核定，系统不计算主播提成',created_by_name:'演示财务',voided_at:null,void_reason:null}];
  // 与 BOSS 营业额同口径：开单卡料价＋代购费；历史简版单用原金额。
  function bookingAmount(o){const d=orderRecord(o);return d.legacy?o.amount:money(d.items.reduce((n,i)=>n+cents(i.price_cny)+cents(i.buying_fee_cny),0n));}
  function liveBusiness(query) {
    const period=dashboard(query).period,selected=Object.fromEntries(['room','host','persona','operator'].map(k=>[k,query.get(k)||'']));
    if(![period.from,period.to].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d)))||period.from>period.to)return json({error:'日期范围无效'},400);
    const matchDate=d=>d>=period.from&&d<=period.to;
    const scoped=orders.filter(o=>(!selected.room||(selected.room==='__unassigned__'?!o.liveRoomCode:o.liveRoomCode===selected.room))&&(!selected.host||o.hostName===selected.host)&&(!selected.persona||o.personaCode===selected.persona)&&(!selected.operator||o.operatorName===selected.operator));
    const empty=()=>({performanceCny:'0.00',newSalesCny:'0.00',grossSalesCny:'0.00',cancelledSalesCny:'0.00',grossOrderCount:0,cancelledOrderCount:0,excludedAdditionalCny:'0.00',additionalCny:'0.00',expenseCny:'0.00',supplierPaidCny:'0.00',companyReceivedCny:'0.00',excludedSourceCny:'0.00',newOrderCount:0,expenseCount:0,customerReceipts:{CNY:'0.00',TWD:'0.00',USD:'0.00'}});
    const totals=empty(),rooms=new Map(),events=[];
    const plus=(t,k,v)=>{t[k]=money(cents(t[k])+cents(v));};
    function push(o,id,kind,date,amount,currency='CNY',label=kind,category='') {
      if(!matchDate(date))return;
      const order={...orderRecord(o).order,persona_code:o.personaCode,persona_name:o.personaName,live_room_code:o.liveRoomCode,host_name:o.hostName,customer_code:o.customerCode,operator_name:o.operatorName};
      events.push({id,order_id:o.id,kind,date,amount,currency,label,category,order});
      const key=o.liveRoomCode||'__unassigned__';if(!rooms.has(key))rooms.set(key,{key,roomCode:o.liveRoomCode||'未归属直播间',hosts:[],personas:[],totals:empty()});
      const r=rooms.get(key);if(o.hostName&&!r.hosts.includes(o.hostName))r.hosts.push(o.hostName);const persona=[o.personaCode,o.personaName].filter(Boolean).join(' · ');if(persona&&!r.personas.includes(persona))r.personas.push(persona);
      for(const t of [totals,r.totals]){
        if(kind==='sale'){plus(t,'grossSalesCny',amount);t.grossOrderCount++;if(o.cancelled||o.status==='refunded'){plus(t,'excludedSourceCny',amount);if(o.cancelled){plus(t,'cancelledSalesCny',amount);t.cancelledOrderCount++;}}else{plus(t,'newSalesCny',amount);t.newOrderCount++;}}else if(kind==='charge'){plus(t,o.cancelled||o.status==='refunded'?'excludedAdditionalCny':'additionalCny',amount);}
        if(kind==='expense'){plus(t,'expenseCny',amount);t.expenseCount++;}
        if(kind==='supplier')plus(t,'supplierPaidCny',amount);
        if(kind==='company')plus(t,'companyReceivedCny',amount);
        if(kind==='receipt')t.customerReceipts[currency]=money(cents(t.customerReceipts[currency])+cents(amount));
      }
    }
    for(const o of scoped){const d=orderRecord(o),base=bookingAmount(o);push(o,o.id,'sale',o.businessDate,base,'CNY',o.orderRef);
      if(d.legacy)continue;
      for(const a of d.charges||[])if(!a.voided_at)push(o,a.id,'charge',a.business_date,a.amount_cny,'CNY',a.label);
      for(const e of d.expenses||[])if(!e.voided_at)push(o,e.id,'expense',e.business_date,e.amount_cny,'CNY',e.label,e.category);
      for(const p of d.payments||[])if(!p.voided_at){push(o,p.id,'receipt',p.payment_date,p.amount,p.currency,p.channel);if(!p.third_party&&p.currency==='CNY')push(o,'direct:'+p.id,'company',p.payment_date,p.amount,'CNY',p.channel);}
      for(const s of settlements.filter(s=>!s.voided_at))for(const a of s.allocations){const p=payments.find(p=>p.id===a.paymentId&&p.order_id===o.id&&!p.voided_at);if(p)push(o,'settlement:'+s.id+':'+p.id,'company',s.settled_on,a.netCny,'CNY',s.channel);}
      for(const p of supplierPayments.filter(p=>!p.voided_at)){const e=d.expenses.find(e=>e.id===p.expense_id&&!e.voided_at);if(e)push(o,p.id,'supplier',p.paid_on,p.amount_cny,'CNY',p.payee,e.category);}
    }
    for(const t of [totals,...[...rooms.values()].map(r=>r.totals)])t.performanceCny=t.newSalesCny;
    const ads=ops.filter(r=>matchDate(r.businessDate)&&r.spendUsd!=null).map(r=>({id:r.id,date:r.businessDate,persona:r.personaName,account:r.adAccountRef||'历史未关联',amount:r.spendUsd}));
    const paidRecords=paidPerformanceRecords.filter(r=>!r.voided_at&&matchDate(r.business_date)&&(!selected.room||r.live_room_code===selected.room)&&(!selected.host||r.host_name===selected.host));
    const paidPerformance={amountCny:paidRecords.length?sumMoney(paidRecords,'amount_cny'):null,recordCount:paidRecords.length,scope:'room_host',records:paidRecords.map(r=>({...r,date:r.business_date}))};
    const afterSales={receipts:{CNY:'0.00',TWD:'0.00',USD:'0.00'},recordCount:0,unclassifiedReceiptCount:events.filter(e=>e.kind==='receipt').length,records:[]};
    const legacy=scoped.filter(o=>!o.workflowEnabled&&cents(o.customProductCost)+cents(o.laborCost)+cents(o.shippingCost)>0n);
    return json({period,selected,totals,paidPerformance,afterSales,rooms:[...rooms.values()].sort((a,b)=>Number(cents(b.totals.performanceCny)-cents(a.totals.performanceCny))),events,options:orders.map(o=>({room:o.liveRoomCode,host:o.hostName,persona:o.personaCode,persona_name:o.personaName,operator:o.operatorName})),ads:{scope:'company',spendUsd:sumMoney(ads,'amount'),records:ads,unknownCount:0},legacyCost:{count:legacy.length,amountCny:money(legacy.reduce((n,o)=>n+cents(o.customProductCost)+cents(o.laborCost)+cents(o.shippingCost),0n))},refundMethod:'cancelled_and_legacy_refunded_orders_reverse_original_booking_day',turnoverMethod:'booking_price_plus_buying_fee_excludes_additional_charges'});
  }
  function dashboard(query) {
    const preset=query.get("preset")||"day";
    const weekday=(new Date(today+"T00:00:00Z").getUTCDay()+6)%7;
    const from=query.get("from")||(preset==="month"?today.slice(0,7)+"-01":preset==="week"?shift(today,-weekday):today);
    const to=query.get("to")||today;
    const inRange=(row)=>row.businessDate>=from&&row.businessDate<=to;
    function bundle() {
      const match=(row)=>inRange(row);
      const os=orders.filter(match),fs=fans.filter(match),op=ops.filter(match),ed=editors.filter(match);
      const snapshots=Object.values(ed.reduce((result,row)=>{const key=row.userId+(row.editorName||"")+row.personaName;if(!result[key]||row.businessDate>result[key].businessDate)result[key]=row;return result;},{}));
      return {revenue:sumMoney(os,"amount"),refunds:sumMoney(os.filter((o)=>o.status==="refunded"),"amount"),promoCost:sumMoney(op,"promoCost"),customProductCost:sumMoney(os,"customProductCost"),laborCost:sumMoney(os,"laborCost"),shippingCost:sumMoney(os,"shippingCost"),orderCount:os.filter((o)=>o.status!=="refunded").length,promoVideoCount:sum(op,"promoVideoCount"),shootCount:sum(ed,"shootCount"),finishedCount:sum(ed,"finishedCount"),publishedCount:sum(ed,"publishedCount"),endingInventory:sum(snapshots,"inventorySnapshot"),fanAddedTotal:sum(fs,"addedCount"),...fanTotals(fs),editCount:sum(ed,"editCount"),sentToOpsCount:sum(ed,"sentToOpsCount"),statsIncomplete:false,legacyUnclassifiedAdded:0,opsUsd:{spendUsd:sumMoney(op,"spendUsd"),consultCount:sum(op,"consultCount"),clickCount:sum(op,"clickCount"),endingBalanceUsd:sumMoney(op,"balanceUsd")}};
    }
    const metrics=bundle();
    const days=Math.max(0,Math.floor((Date.parse(to)-Date.parse(from))/86400000)+1);
    const salaryAllocated=allocate(salaryStandards,from,to);void days;
    const estimate=money(cents(metrics.revenue)-cents(metrics.refunds)-cents(metrics.promoCost)-cents(metrics.customProductCost)-cents(metrics.laborCost)-cents(metrics.shippingCost)-cents(salaryAllocated));
    return {period:{from,to},dataCounts:{fans:fans.filter(inRange).length,ops:ops.filter(inRange).length,editor:editors.filter(inRange).length},metrics:{...metrics,salaryAllocated,estimate},reviewRequired:false,overallSalary:{allocated:salaryAllocated,note:"演示经营估算只扣虚构底薪分摊（与工资页同一组工资标准），不含提成、奖金、扣款。全部为虚构。",payrollItemsIncluded:false},formula:"收入 - 退款 - 历史推广费 - 工资 - 定制成本 - 工费 - 运费",estimateNote:"仅演示汇总界面；虚构数据不代表公司经营状况。USD 单独展示。",disclaimer:meta.disclaimer,opsUsd:metrics.opsUsd};
  }
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  // P0 contract exists only in the independent static demo. All rows below are
  // adapted from the same fictional records used by the existing detail pages.
  function bossOverview(query) {
    if(!window.CmsBossOverview)return json({error:'独立演示指标服务未加载'},503);
    try {
      const stamp=new Date(),local=new Date(stamp.getTime()+8*3600000),localTime=local.toISOString().slice(11,19);
      const rows=[];
      const add=(row)=>rows.push({localTime:'00:00:00',...row}); // fictional sample rows are available from local midnight
      for(const o of orders){
        const record=orderRecord(o);
        add({id:o.id,kind:'booking',date:o.businessDate,amount:bookingAmount(o),currency:'CNY',label:o.orderRef,orderId:o.id,excluded:o.cancelled?'跑单回冲原开单日':o.status==='refunded'?'历史退款标记源单':''});
        for(const e of record.expenses||[])if(!e.voided_at)add({id:e.id,kind:'cost',date:e.business_date,amount:e.amount_cny,currency:'CNY',label:e.label,category:e.category,orderId:o.id});
        for(const p of record.payments||[])if(!p.voided_at)add({id:p.id,kind:'payment',date:p.payment_date,amount:p.amount,currency:p.currency,label:o.orderRef+' · '+({deposit:'定金',balance:'尾款',full:'全款'}[p.purpose]||'客户付款'),orderId:o.id});
      }
      for(const o of ops)if(o.spendUsd!=null)add({id:o.id,kind:'ad',date:o.businessDate,amount:o.spendUsd,currency:'USD',label:o.adAccountRef+' · 广告消耗'});
      const lastUpdate=rows.length?stamp.toISOString():null;
      const dataset={rows,coverage:{from:shift(today,-800),to:today},
        rates:[{currency:'TWD',cnyPerUnit:'0.200000',effectiveFrom:shift(today,-800),source:'虚构参考配置'},{currency:'USD',cnyPerUnit:'7.200000',effectiveFrom:shift(today,-800),source:'虚构参考配置'}],
        // A fictional prior-day finance result demonstrates explicit values. Today
        // is deliberately absent, so the headline must say 待财务核算.
        finance:[{date:shift(today,-1),materialCost:'600.00',commission:'70.00',collectionFee:'8.00',source:'虚构财务专项核算'}],
        paidPerformance:paidPerformanceRecords.filter(r=>!r.voided_at).map(r=>({date:r.business_date,amount:r.amount_cny,label:r.live_room_code+' · '+r.host_name})),
        targets:[],sources:['开单卡','客户付款','费用明细','广告消耗','财务专项核算'].map(name=>({name,updatedAt:name==='财务专项核算'?shift(today,-1)+'T04:00:00Z':lastUpdate}))};
      return json(window.CmsBossOverview.build(dataset,Object.fromEntries(query),{today,localTime,asOf:stamp.toISOString()}));
    }catch{return json({error:'演示指标日期或数据格式无效'},400);}
  }
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==="string"?input:input.url,window.location.origin);
    if(!url.pathname.startsWith("/api/"))return nativeFetch(input,options);
    const method=(options.method||(typeof input!=="string"&&input.method)||"GET").toUpperCase();
    const path=url.pathname,q=url.searchParams;
    if(path==="/api/auth/csrf")return json({csrfToken:"public-fictional-demo-token"});
    if(path==="/api/auth/login"&&method==="POST"){
      let body;try{body=JSON.parse(options.body||"{}");}catch{return json({error:"演示输入无效"},400);}
      const selected=roles.find((r)=>usernames[r]===body.username);
      if(!selected||body.password!=="Demo2026View")return json({error:"演示账号：demo_boss / demo_admin / demo_supervisor；统一演示密码 Demo2026View"},401);
      role=selected;window.sessionStorage.setItem("cms-fictional-role",role);return json({user:currentUser(),csrfToken:"public-fictional-demo-token",...meta});
    }
    if(path==="/api/auth/logout"&&method==="POST"){role="";window.sessionStorage.setItem("cms-fictional-role","");return json({ok:true});}
    if(!role)return json({error:"请使用演示账号登录"},401);
    if(path==="/api/auth/me")return json({user:currentUser(),...meta});
    if(path==="/api/auth/meta")return json(meta);
    if(!["GET","HEAD"].includes(method))return json({error:"这是公开只读演示，不保存任何修改。请在正式后台操作。"},403);
    if(path==="/api/modules")return json({version:1,modules:{fans:true,ops:true,editor:true,orders:true},labels:{fans:"客服加粉",ops:"运营投放",editor:"拍剪",orders:"订单"}});
    if(path==='/api/demo/boss-overview')return role==='boss'?bossOverview(q):json({error:'仅BOSS可查看演示经营总览'},403);
    if(role==="admin"&&!/^\/api\/(admin|cs-accounts)(\/|$)/.test(path))return json({error:"演示管理员仅管理系统，不查看业务数据"},403);
    if(/^\/api\/salaries(\/|$)/.test(path))return ["finance","boss"].includes(role)?salaryApi(path,q):json({error:"仅财务与BOSS可查看工资"},403);
    if(/^\/api\/finance\/payables\/[^/]+\/attachments$/.test(path))return ['boss','finance'].includes(role)&&payables().expenses.some(e=>path.includes('/'+e.id+'/'))?json({attachments:[]}):json({error:'无公司成本权限'},403);
    if(path==='/api/finance/payables')return ['boss','finance'].includes(role)?json(payables()):json({error:'无公司付款权限'},403);
    if(path==='/api/ad-accounts')return ['boss','finance'].includes(role)?json(adLedger):json({error:'无广告账户权限'},403);
    if(path==="/api/finance/live-performance")return ['boss','finance'].includes(role)?json({records:paidPerformanceRecords}):json({error:'无财务核定权限'},403);
    if(role==='finance'&&path!=='/api/finance')return json({error:"演示财务仅可查看收款、结算与工资"},403);
    if(path==="/api/finance"&&["finance","boss"].includes(role))return json({payments,settlements,summary:{pending:{CNY:"0.00",TWD:"1200.00",USD:"90.00"},directCny:"1290.50",settledCny:"323.40",totalCny:"1613.90"}});
    if(path.startsWith("/api/order-records/")&&["boss","cs_supervisor"].includes(role)){const id=path.slice("/api/order-records/".length);const order=visibleOrders().find(o=>o.id===id);return order?json(orderRecord(order)):json({error:"订单不存在或不在演示可见范围"},404);}
    if(path==="/api/admin/users"&&role==="admin")return json({users:[...staff,...assetUsers]});
    if(path==="/api/admin/teams"&&role==="admin")return json({teams});
    if(path==="/api/admin/settings"&&role==="admin")return json({settings:{fan_report_backfill_days:"3"}});
    if(path==="/api/cs-accounts")return json({accounts:visibleAccounts()});
    if(path==="/api/cs-accounts/teams")return json({teams:visibleTeams()});
    if(path==='/api/fan-leads'&&['boss','cs_supervisor'].includes(role))return json(leadDemo(q));
    if(/^\/api\/fan-leads\/[^/]+\/history$/.test(path)&&['boss','cs_supervisor'].includes(role)){const id=path.split('/')[3],l=leadFixtures.find(l=>l.id===id&&visibleAccounts().some(a=>a.id===l.accountId));return l?json({history:[{created_at:l.receivedOn+'T02:00:00Z',actor_name:l.operatorName,action:'fan_lead_create',after_data:{qualified_on:l.qualifiedOn,need_summary:l.needSummary}}]}):json({error:'线索不在演示可见范围'},403);}
    if(path==="/api/fan-reports/summary"&&role!=="admin")return json(fanSummary(q));
    if(path==="/api/fan-reports/export"&&role!=="admin")return new Response("\uFEFF"+[csv(["业务日","小组","客服接待账号","加粉数","状态"]),...fanSummary(q).teams.flatMap((team)=>team.details.map((d)=>csv([q.get("date")||today,team.teamName,d.wechatId,d.addedCount,d.status])))].join("\n"),{headers:{"Content-Type":"text/csv;charset=utf-8"}});
    if(q.has("reviewStatus"))return json({error:"审核筛选已停用"},400);
    if(path==="/api/orders"&&role!=="admin"){const rows=filteredOrders(q).map(o=>({...o,bookingAmount:bookingAmount(o)})),valid=rows.filter(r=>!r.cancelled&&r.status!=="refunded");return json({orders:rows,totals:{amount:sumMoney(rows,"amount"),refunds:sumMoney(rows.filter((r)=>r.status==="refunded"&&!r.cancelled),"amount"),cancelled:sumMoney(rows.filter(r=>r.cancelled),"amount"),turnover:sumMoney(valid,"bookingAmount"),turnoverCount:valid.length}});}
    if(role==="boss"){
      if(path==="/api/dashboard/live-business")return liveBusiness(q);
      if(path==="/api/dashboard/summary")return json(dashboard(q));
      if(path==="/api/dashboard/series")return dashboardSeries(q);
      if(path==="/api/ops-reports")return json({reports:ops});
      if(path==="/api/editor-reports")return json({reports:editors});
      if(path==="/api/notes")return json({notes:[{id:"demo-note-1",authorName:"演示说明",targetDate:today,content:"所有金额和客户记录均为虚构；本演示不会连接本地系统。"}]});
      if(path==="/api/reviews")return json({error:"审核流程已停用"},410);
    }
    return json({error:"只读演示未开放此操作或数据范围"},403);
  };
  window.cmsDemoSwitch=(next)=>{if(roles.includes(next)){window.sessionStorage.setItem("cms-fictional-role",next);window.location.assign("/?role="+next);}};
  document.addEventListener("DOMContentLoaded",()=>{
    const roleSelect=document.querySelector('.demo-mobile-role');
    if(roleSelect){roleSelect.value=role;roleSelect.addEventListener('change',()=>window.cmsDemoSwitch(roleSelect.value));}
    document.querySelectorAll("[data-demo-role]").forEach((button)=>{button.addEventListener("click",()=>window.cmsDemoSwitch(button.getAttribute("data-demo-role")));if(button.getAttribute("data-demo-role")===role)button.setAttribute("aria-current","true");});
    document.addEventListener("click",async(event)=>{
      const anchor=event.target.closest('a[href^="/api/"]');
      if(!anchor)return;
      event.preventDefault();const response=await window.fetch(anchor.getAttribute("href"));
      if(!response.ok)return;
      const url=URL.createObjectURL(await response.blob()),download=document.createElement("a");download.href=url;download.download="fictional-demo-fans.csv";download.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    const disableWrites=()=>{
      document.querySelectorAll("form").forEach((form)=>{if(form.querySelector("#password"))return;form.querySelectorAll('button[type="submit"],button:not([type])').forEach((button)=>{if(!button.textContent.includes("查询")){button.disabled=true;button.title="公开只读演示，不保存修改";}});});
      document.querySelectorAll('#root select[aria-label$="角色"]').forEach((select)=>{select.disabled=true;});
      document.querySelectorAll("button").forEach((button)=>{if(/^(确认重新发码|停用|启用|停用账号|启用账号)$/.test(button.textContent.trim())){button.disabled=true;button.title="公开只读演示，不保存修改";}});
    };
    new MutationObserver(disableWrites).observe(document.getElementById("root"),{childList:true,subtree:true});
    disableWrites();
  });
})();

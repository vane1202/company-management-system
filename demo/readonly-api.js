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
  const staff = [...roles.map((r) => ({ id: "demo-" + r, username: usernames[r], displayName: names[r], role: r, isActive: true, accountKind: "employee", managedTeamIds: r === "cs_supervisor" ? [teams[0].id] : [], currentTeam: null })), ...["ops", "editor", "assistant"].map((r) => ({ id: "demo-" + r, username: "demo_" + r, displayName: {ops:"演示运营",editor:"演示拍剪",assistant:"演示助理"}[r], role: r, isActive: true, accountKind: "employee", currentTeam: null }))];
  const assetUsers = accounts.map((a) => ({ id: a.id, username: a.wechatId, displayName: a.wechatId, wechatId: a.wechatId, accountKind: "cs_wechat", role: "cs", isActive: true, currentTeam: { id: a.teamId, name: a.teamName } }));
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
  const orders = [
    { id:"demo-order-1", userId:accounts[0].id, businessDate:today, orderRef:"DEMO-A-001", customerLabel:"演示客户甲", amount:"1290.50", status:"shipped", customProductCost:"900.00", laborCost:"50.00", shippingCost:"20.00" },
    { id:"demo-order-2", userId:accounts[0].id, businessDate:today, orderRef:"DEMO-A-002", customerLabel:"演示客户乙", amount:"680.00", status:"placed", customProductCost:"400.00", laborCost:"20.00", shippingCost:"10.00" },
    { id:"demo-order-3", userId:accounts[1].id, businessDate:shift(today,-1), orderRef:"DEMO-B-001", customerLabel:"演示客户丙", amount:"950.00", status:"in_production", customProductCost:"600.00", laborCost:"30.00", shippingCost:"15.00" },
    { id:"demo-order-4", userId:accounts[1].id, businessDate:today, orderRef:"DEMO-B-002", customerLabel:"演示客户丁", amount:"180.00", status:"refunded", customProductCost:"80.00", laborCost:"0.00", shippingCost:"0.00" }
  ].map((row) => ({ ...row, wechatId:accounts.find((a)=>a.id===row.userId).wechatId, displayName:accounts.find((a)=>a.id===row.userId).wechatId, accountKind:"cs_wechat", isCustom:true, recordVersion:1, updatedAt:row.businessDate+"T03:00:00Z" }));
  const ops = [{ id:"demo-ops-1",userId:"demo-ops",businessDate:today,personaName:"演示主页 A",platform:"演示平台",spendUsd:"29.20",consultCount:6,consultCostUsd:"4.87",clickCount:180,ctrPercent:"1.25",balanceUsd:"120.80",promoCost:"0.00",promoVideoCount:2,note:"全部数值为虚构示例", recordVersion:1,updatedAt:today+"T03:20:00Z" }];
  const editors = [{ id:"demo-editor-1",userId:"demo-editor",businessDate:today,personaName:"演示人设 A",shootCount:6,editCount:4,sentToOpsCount:3,finishedCount:0,publishedCount:0,inventorySnapshot:18,inventoryAdjusted:false, recordVersion:1,updatedAt:today+"T03:30:00Z" }];
  const visibleAccounts = () => role === "cs_supervisor" ? accounts.filter((a)=>a.teamId===teams[0].id) : accounts;
  const visibleTeams = () => role === "cs_supervisor" ? [teams[0]] : teams;
  const visibleOrders = () => orders.filter((o)=>visibleAccounts().some((a)=>a.id===o.userId));
  orders.forEach((o,index)=>{o.workflowEnabled=index<3;});
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
  function orderRecord(order){
    const index=orders.indexOf(order),raw={id:order.id,order_ref:order.orderRef,customer_label:order.customerLabel,business_date:order.businessDate,amount:order.amount,status:order.status,wechat_id:order.wechatId,display_name:order.displayName,note:"虚构演示记录",custom_product_cost:order.customProductCost,labor_cost:order.laborCost,shipping_cost:order.shippingCost};
    if(!order.workflowEnabled)return {order:raw,legacy:true};
    const cur=["CNY","TWD","USD"][index],due=["1290.50","3200.00","140.00"][index],paid=["1290.50","1200.00","140.00"][index];
    return {order:raw,legacy:false,details:{personaName:index===2?"演示人设 B":"演示人设 A",operatorName:"演示经办员",source:"演示直播间",customerCurrency:cur,customerDue:due,shippedOn:order.status==="shipped"?today:null,version:1},items:[{id:"demo-item-"+index,label:index===0?"演示原石":"演示成品",material_ref:"DEMO-JADE-"+(index+1),kind:index===0?"material":"finished",price_cny:index===0?"1173.18":order.amount,buying_fee_cny:index===0?"117.32":"0.00"}],payments:payments.filter(p=>p.order_id===order.id),expenses:[{id:"demo-expense-"+index,business_date:order.businessDate,category:"goods",label:"演示商品成本",amount_cny:order.customProductCost,voided_at:null},{id:"demo-labor-"+index,business_date:order.businessDate,category:"labor",label:"演示工费",amount_cny:order.laborCost,voided_at:null},{id:"demo-shipping-"+index,business_date:order.businessDate,category:"shipping",label:"演示运费",amount_cny:order.shippingCost,voided_at:null}],attachments:[],paid,balance:money(cents(due)-cents(paid)),expenseTotal:money(cents(order.customProductCost)+cents(order.laborCost)+cents(order.shippingCost))};
  }
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
      const details = members.map((member) => { const pages=rows.filter((f)=>f.userId===member.id).map((f)=>({...f,reportId:f.id})); return {userId:member.id,displayName:member.wechatId,wechatId:member.wechatId,accountKind:"cs_wechat",username:member.wechatId,addedCount:pages.length?sum(pages,"addedCount"):null,status:pages.length?"reported":"missing",updatedAt:pages[0]?.updatedAt||null,pages}; });
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
  function dashboard(query) {
    const preset=query.get("preset")||"day";
    const weekday=(new Date(today+"T00:00:00Z").getUTCDay()+6)%7;
    const from=query.get("from")||(preset==="month"?today.slice(0,7)+"-01":preset==="week"?shift(today,-weekday):today);
    const to=query.get("to")||today;
    const inRange=(row)=>row.businessDate>=from&&row.businessDate<=to;
    function bundle() {
      const match=(row)=>inRange(row);
      const os=orders.filter(match),fs=fans.filter(match),op=ops.filter(match),ed=editors.filter(match);
      const snapshots=Object.values(ed.reduce((result,row)=>{const key=row.userId+row.personaName;if(!result[key]||row.businessDate>result[key].businessDate)result[key]=row;return result;},{}));
      return {revenue:sumMoney(os,"amount"),refunds:sumMoney(os.filter((o)=>o.status==="refunded"),"amount"),promoCost:sumMoney(op,"promoCost"),customProductCost:sumMoney(os,"customProductCost"),laborCost:sumMoney(os,"laborCost"),shippingCost:sumMoney(os,"shippingCost"),orderCount:os.filter((o)=>o.status!=="refunded").length,promoVideoCount:sum(op,"promoVideoCount"),shootCount:sum(ed,"shootCount"),finishedCount:sum(ed,"finishedCount"),publishedCount:sum(ed,"publishedCount"),endingInventory:sum(snapshots,"inventorySnapshot"),fanAddedTotal:sum(fs,"addedCount"),...fanTotals(fs),editCount:sum(ed,"editCount"),sentToOpsCount:sum(ed,"sentToOpsCount"),statsIncomplete:false,legacyUnclassifiedAdded:0,opsUsd:{spendUsd:sumMoney(op,"spendUsd"),consultCount:sum(op,"consultCount"),clickCount:sum(op,"clickCount"),endingBalanceUsd:sumMoney(op,"balanceUsd")}};
    }
    const metrics=bundle();
    const days=Math.max(0,Math.floor((Date.parse(to)-Date.parse(from))/86400000)+1);
    const salaryAllocated=allocate(salaryStandards,from,to);void days;
    const estimate=money(cents(metrics.revenue)-cents(metrics.refunds)-cents(metrics.promoCost)-cents(metrics.customProductCost)-cents(metrics.laborCost)-cents(metrics.shippingCost)-cents(salaryAllocated));
    return {period:{from,to},dataCounts:{fans:fans.filter(inRange).length,ops:ops.filter(inRange).length,editor:editors.filter(inRange).length},metrics:{...metrics,salaryAllocated,estimate},reviewRequired:false,overallSalary:{allocated:salaryAllocated,note:"演示经营估算只扣虚构底薪分摊（与工资页同一组工资标准），不含提成、奖金、扣款。全部为虚构。",payrollItemsIncluded:false},formula:"收入 - 退款 - 历史推广费 - 工资 - 定制成本 - 工费 - 运费",estimateNote:"仅演示汇总界面；虚构数据不代表公司经营状况。USD 单独展示。",disclaimer:meta.disclaimer,opsUsd:metrics.opsUsd};
  }
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
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
    if(role==="admin"&&!/^\/api\/(admin|cs-accounts)(\/|$)/.test(path))return json({error:"演示管理员仅管理系统，不查看业务数据"},403);
    if(/^\/api\/salaries(\/|$)/.test(path))return ["finance","boss"].includes(role)?salaryApi(path,q):json({error:"仅财务与BOSS可查看工资"},403);
    if(role==="finance"&&path!=="/api/finance")return json({error:"演示财务仅可查看收款、结算与工资"},403);
    if(path==="/api/finance"&&["finance","boss"].includes(role))return json({payments,settlements,summary:{pending:{CNY:"0.00",TWD:"1200.00",USD:"90.00"},directCny:"1290.50",settledCny:"323.40",totalCny:"1613.90"}});
    if(path.startsWith("/api/order-records/")&&["boss","cs_supervisor"].includes(role)){const id=path.slice("/api/order-records/".length);const order=visibleOrders().find(o=>o.id===id);return order?json(orderRecord(order)):json({error:"订单不存在或不在演示可见范围"},404);}
    if(path==="/api/admin/users"&&role==="admin")return json({users:[...staff,...assetUsers]});
    if(path==="/api/admin/teams"&&role==="admin")return json({teams});
    if(path==="/api/admin/settings"&&role==="admin")return json({settings:{fan_report_backfill_days:"3"}});
    if(path==="/api/cs-accounts")return json({accounts:visibleAccounts()});
    if(path==="/api/cs-accounts/teams")return json({teams:visibleTeams()});
    if(path==="/api/fan-reports/summary"&&role!=="admin")return json(fanSummary(q));
    if(path==="/api/fan-reports/export"&&role!=="admin")return new Response("\uFEFF"+[csv(["业务日","小组","客服微信","加粉数","状态"]),...fanSummary(q).teams.flatMap((team)=>team.details.map((d)=>csv([q.get("date")||today,team.teamName,d.wechatId,d.addedCount,d.status])))].join("\n"),{headers:{"Content-Type":"text/csv;charset=utf-8"}});
    if(q.has("reviewStatus"))return json({error:"审核筛选已停用"},400);
    if(path==="/api/orders"&&role!=="admin"){const rows=filteredOrders(q);return json({orders:rows,totals:{amount:sumMoney(rows,"amount"),refunds:sumMoney(rows.filter((r)=>r.status==="refunded"),"amount")}});}
    if(role==="boss"){
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

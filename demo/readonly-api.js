/* Public UI preview with fictional transactions and an optional registered directory. No authentication, database or business writes. */
(() => {
  "use strict";
  const nativeFetch = window.fetch.bind(window);
  const roles = ["boss", "admin", "cs_supervisor", "finance", "cs", "editor", "ops", "warehouse"];
  const fillPath = window.location.pathname || "";
  const requestedRole = new URLSearchParams(window.location.search).get("role") || (/^\/fill(?:\/(cs|orders|fans|after-sales|attendance|performance))?\/?$/.test(fillPath) ? "cs" : /^\/fill\/editor\/?$/.test(fillPath) ? "editor" : /^\/fill\/ops\/?$/.test(fillPath) ? "ops" : null);
  let role = roles.includes(requestedRole) ? requestedRole : window.sessionStorage.getItem("cms-fictional-role") || "boss";
  if (!roles.includes(role)) role = "";
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const shift = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  const money = (cents) => { const sign = cents < 0n ? "-" : ""; const n = cents < 0n ? -cents : cents; return sign + n / 100n + "." + String(n % 100n).padStart(2, "0"); };
  const cents = (value) => BigInt(String(value).replace(".", ""));
  const sumMoney = (rows, key) => money(rows.reduce((sum, row) => sum + cents(row[key] || "0.00"), 0n));
  const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const meta = { today, timezone: "Asia/Shanghai", backfillDays: 3, disclaimer: window.CmsServiceDirectory ? "人员与接待账号为已登记资料；业务记录和金额为虚构示例，试填不保存，不用于真实经营判断。" : "公开只读演示：所有账号、金额和记录均为虚构，不连接正式后台，不用于真实经营判断。" };
  const names = { warehouse: "演示库房", boss: "演示 BOSS", admin: "演示后台管理员", cs_supervisor: "演示客服主管", finance:"演示财务", cs:"演示客服填报", editor:"演示拍剪填报", ops:"演示运营" };
  const usernames = { warehouse:"demo_warehouse", boss: "demo_boss", admin: "demo_admin", cs_supervisor: "demo_supervisor", finance:"demo_finance", cs:"demo_cs", editor:"demo_editor", ops:"demo_ops" };
  const identityNames = { warehouse:"演示·李库管", boss: "演示·陈明远", admin: "演示·周文", cs_supervisor: "演示·林小禾", finance: "演示·许宁", cs: "演示·何佳", editor: "演示·沈川", ops: "演示·方晨" };
  const opsPeople = window.CmsOpsWorkspace?.people || [{id:"demo-ops",name:identityNames.ops}];
  let opsPersonId = new URLSearchParams(window.location.search).get("operator") || window.sessionStorage.getItem("cms-demo-ops-person") || opsPeople[0].id;
  if (!opsPeople.some(person => person.id === opsPersonId)) opsPersonId = opsPeople[0].id;
  window.sessionStorage.setItem("cms-demo-ops-person",opsPersonId);
  const opsPerson = () => opsPeople.find(person => person.id === opsPersonId);
  const currentUser = () => ({ id: role === "ops" ? opsPersonId : "demo-" + role, username: role === "ops" && opsPersonId !== "demo-ops" ? opsPersonId.replace("demo-", "demo_") : usernames[role], displayName: role === "ops" ? opsPerson().name : identityNames[role], role, isActive: true, mustChangePassword: false, accountKind: "employee" });
  const directoryStorageKey = "cms-demo-service-account-session-v1";
  function currentDirectory() {
    const base = window.CmsServiceDirectory;
    if (!base) return null;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(directoryStorageKey) || "null");
      if (saved?.confirmedOn === base.confirmedOn && saved.team?.id === base.team.id && Array.isArray(saved.accounts) && Array.isArray(saved.people)) return saved;
    } catch { /* Fall back to the confirmed directory. */ }
    return base;
  }
  const teams = [{ id: "demo-team-a", name: "演示一组" }, { id: "demo-team-b", name: "演示二组" }];
  let savedAdminTeams = null;
  try { savedAdminTeams = JSON.parse(window.sessionStorage.getItem("cms-demo-admin-teams") || "null"); } catch { savedAdminTeams = null; }
  if (Array.isArray(savedAdminTeams)) {
    for (const row of savedAdminTeams) {
      const found = teams.find((team) => team.id === row?.id);
      if (found && row?.name) found.name = String(row.name).slice(0, 64);
    }
  }
  // 第 3 个虚构微信归演示一组、今日未报，用于展示“今日未报”提示；无订单、无加粉记录。
  const accounts = [...teams, teams[0]].map((team, i) => ({ id: "demo-wechat-" + (i + 1), wechatId: "Demo_WeChat_0" + (i + 1), phoneLabel: "演示客服手机 0" + (i + 1), isActive: true, teamId: team.id, teamName: team.name, createdAt: today + "T01:00:00Z" }));
  accounts.forEach((a,i)=>{a.platform=i===1?'whatsapp':'messenger';a.accountIdentifier=i===1?'+999000000002':'demo.messenger.0'+(i+1);a.wechatId=(a.platform==='whatsapp'?'WhatsApp':'Messenger')+' · '+a.accountIdentifier;a.holderName=['演示客服甲','演示客服乙','演示客服丙'][i]||'演示客服';});
  const staff = [...roles.filter(r=>r!=="cs"&&r!=="editor").map((r) => ({ id: "demo-" + r, username: usernames[r], displayName: names[r], role: r, isActive: true, accountKind: "employee", managedTeamIds: r === "cs_supervisor" ? [teams[0].id] : [], currentTeam: null })), ...["editor", "assistant"].map((r) => ({ id: "demo-" + r, username: "demo_" + r, displayName: {ops:"演示运营",editor:"演示拍剪",assistant:"演示助理"}[r], role: r, isActive: true, accountKind: "employee", currentTeam: null }))];
  const assetUsers = accounts.map((a) => ({ id: a.id, username: a.wechatId, displayName: a.wechatId, wechatId: a.wechatId, accountKind: "cs_service", role: "cs", isActive: true, currentTeam: { id: a.teamId, name: a.teamName } }));
  if (Array.isArray(savedAdminTeams)) {
    for (const row of savedAdminTeams) {
      if (row?.id && row?.name && !teams.some((team) => team.id === row.id)) teams.push({ id: String(row.id), name: String(row.name).slice(0, 64) });
    }
  }
  function saveAdminTeams() { window.sessionStorage.setItem("cms-demo-admin-teams", JSON.stringify(teams.map((team) => ({ id: team.id, name: team.name })))); }
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
    { id:"demo-order-1", userId:accounts[0].id, businessDate:today, orderRef:"DEMO-A-001", customerLabel:"演示客户甲", amount:"1290.50", status:"shipped", customProductCost:"900.00", laborCost:"50.00", shippingCost:"20.00", materialCost:"900.00", materialLotNo:"D367-32" },
    { id:"demo-order-2", userId:accounts[0].id, businessDate:today, orderRef:"DEMO-A-002", customerLabel:"演示客户乙", amount:"680.00", status:"placed", customProductCost:"400.00", laborCost:"20.00", shippingCost:"10.00" },
    { id:"demo-order-3", userId:accounts[1].id, businessDate:shift(today,-1), orderRef:"DEMO-B-001", customerLabel:"演示客户丙", amount:"950.00", status:"in_production", customProductCost:"600.00", laborCost:"30.00", shippingCost:"15.00" },
    { id:"demo-order-4", userId:accounts[1].id, businessDate:today, orderRef:"DEMO-B-002", customerLabel:"演示客户丁", amount:"180.00", status:"refunded", customProductCost:"80.00", laborCost:"0.00", shippingCost:"0.00" },
    // 两笔昨日虚构开单：一笔已登记跑单（回冲原开单日），一笔未付款、可由本组主管登记跑单。
    { id:"demo-order-5", userId:accounts[0].id, businessDate:shift(today,-1), orderRef:"DEMO-A-003", customerLabel:"演示客户戊", amount:"330.00", status:"placed", customProductCost:"0.00", laborCost:"0.00", shippingCost:"0.00", cancelled:true, materialCost:"200.00", materialLotNo:"D218-07" },
    { id:"demo-order-6", userId:accounts[0].id, businessDate:shift(today,-1), orderRef:"DEMO-A-004", customerLabel:"演示客户己", amount:"550.00", status:"placed", customProductCost:"0.00", laborCost:"0.00", shippingCost:"0.00" }
  ].map((row) => ({ ...row, wechatId:accounts.find((a)=>a.id===row.userId).wechatId, displayName:accounts.find((a)=>a.id===row.userId).wechatId, accountKind:"cs_service", isCustom:true, recordVersion:1, updatedAt:row.businessDate+"T03:00:00Z" }));
  const demoFxRates=[{currency:'TWD',cnyPerUnit:'0.200000',effectiveFrom:shift(today,-800),source:'虚构参考配置'},{currency:'USD',cnyPerUnit:'7.200000',effectiveFrom:shift(today,-800),source:'虚构参考配置'}];
  const makeOps=(date,index,spendUsd,consultCount,clickCount,balanceUsd,extra={})=>({id:'demo-ops-'+date+'-'+index,userId:'demo-ops',businessDate:date,personaName:'演示主页 '+['A','B','C','D'][index],adAccountRef:index<2?'DEMO-ADS-01':'DEMO-ADS-02',platform:index<2?'Facebook':'TikTok',spendUsd,consultCount,clickCount,balanceUsd,consultCostUsd:consultCount?money((cents(spendUsd)+BigInt(consultCount)/2n)/BigInt(consultCount)):null,ctrPercent:clickCount?'1.25':null,promoCost:'0.00',promoVideoCount:0,note:'全部数值为虚构示例；咨询量保留运营上报语义',recordVersion:1,updatedAt:date+'T03:20:00Z',...extra});
  const ops=[makeOps(today,0,'12.20',3,75,'100.80',{consultCostUsd:'4.10',promoVideoCount:1}),makeOps(today,1,'10.00',2,55,'100.80',{promoVideoCount:1}),makeOps(today,2,'7.00',1,50,'20.00'),makeOps(today,3,'0.00',0,0,'20.00')];
  // Same source feeds the overview and analysis. Day -4 is intentionally unreported.
  for(const n of [1,2,3,5,6]){
    const date=shift(today,-n);
    for(let i=0;i<4;i++)ops.push(makeOps(date,i,[(10+n)+'.00',(8+n)+'.00',(5+n)+'.00','4.00'][i],[3,2,1,n===1?0:1][i],[70+n,45+n,35+n,15][i],i<2?'110.00':'30.00'));
  }
  const editors = [4,3,2,4,3,2].map((inventorySnapshot,i)=>({id:'demo-editor-'+(i+1),userId:'demo-editor',editorName:['魏磊','尚杰','十七'][Math.floor(i/2)],businessDate:today,personaName:['演示人设 A','演示人设 B'][i%2],shootCount:[2,1,1,1,1,0][i],editCount:[1,1,1,1,0,0][i],sentToOpsCount:i<3?1:0,finishedCount:0,publishedCount:0,inventorySnapshot,inventoryAdjusted:false,recordVersion:1,updatedAt:today+'T03:30:00Z'}));
  const visibleAccounts = () => role === "cs_supervisor" ? accounts.filter((a)=>a.teamId===teams[0].id) : accounts;
  const leadFixtures = fans.filter(f=>f.businessDate>=shift(today,-1)).flatMap(f=>Array.from({length:f.addedCount},(_,i)=>{
    const a=accounts.find(a=>a.id===f.userId),same=i===0||i===2,late=f.businessDate!==today&&i===1,qual=same?f.businessDate:late?today:null;
    return {id:'demo-lead-'+f.id+'-'+i,accountId:a.id,wechatId:a.wechatId,teamId:a.teamId,teamName:a.teamName,receivedOn:f.businessDate,pageName:f.pageName,sourceAdAccountId:f.id==='demo-fan-3'?'':(a.id===accounts[0].id?'09001':'9002'),personaCode:a.id===accounts[0].id?'DEMO-P-A':'DEMO-P-B',operatorName:a.id===accounts[0].id?'演示客服甲':'演示客服乙',channel:i<f.msToday?'ms':'ws',customerLabel:'虚构线索客户 '+(i+1),customerRef:'DEMO-'+f.id+'-'+i,contactStatus:qual||i===1?'replied':i%2?'read_no_reply':'unread',repliedOn:qual||i===1?f.businessDate:null,qualifiedOn:qual,needSummary:qual?'虚构示例：白冰手镯，预算4000台币':'',invalidReason:i===f.addedCount-1?'虚构示例：垃圾推广':'',lossReason:i===2?'虚构示例：报价后因预算不接受流失':'',nextFollowup:!qual?today:null,note:'纯虚构线索，不含用户提供的真实客户姓名或报表',version:1,voidedAt:null,voidReason:null};
  }));
  function leadDemo(q){const from=q.get('from')||today,to=q.get('to')||today,allowed=visibleAccounts().map(a=>a.id);return {from,to,today,leads:leadFixtures.filter(l=>allowed.includes(l.accountId)&&l.receivedOn>=from&&l.receivedOn<=to),reports:fans.filter(f=>allowed.includes(f.userId)&&f.businessDate>=from&&f.businessDate<=to).map(f=>({accountId:f.userId,businessDate:f.businessDate,pageName:f.pageName,msToday:f.msToday,wsToday:f.wsToday,addedCount:f.addedCount}))};}
  const visibleTeams = () => role === "cs_supervisor" ? [teams[0]] : teams;
  const visibleOrders = () => orders.filter((o)=>visibleAccounts().some((a)=>a.id===o.userId));
  orders.forEach((o,index)=>{o.workflowEnabled=index<3||index>=4;o.cancelled=!!o.cancelled;Object.assign(o,{personaCode:index===2?'DEMO-P-B':'DEMO-P-A',personaName:index===2?'演示人设 B':'演示人设 A',liveRoomCode:index===2?'DEMO-LIVE-02':'DEMO-LIVE-01',hostName:index===2?'文强':'甜甜',customerCode:'DEMO-C-'+(index+1),operatorName:['演示客服甲','演示客服丙','演示客服乙','','演示客服甲','演示前任客服'][index]||''});});
  // Same acquisition persona may lead into different receiving groups/rooms; it is not a fixed room assignment.
  Object.assign(orders[2],{personaCode:'DEMO-P-A',personaName:'演示人设 A'});
  Object.assign(orders[3],{liveRoomCode:'',hostName:'',personaCode:'',personaName:'',customerCode:'',operatorName:''});
  orders.push({id:'demo-order-7',userId:accounts[0].id,businessDate:today,orderRef:'DEMO-P-001',customerLabel:'演示私推客户',amount:'600.00',status:'placed',customProductCost:'0.00',laborCost:'0.00',shippingCost:'0.00',wechatId:accounts[0].wechatId,displayName:accounts[0].wechatId,accountKind:'cs_service',isCustom:true,recordVersion:1,updatedAt:today+'T03:30:00Z',workflowEnabled:true,cancelled:false,dealChannel:'private',personaCode:'',personaName:'',liveRoomCode:'',hostName:'',customerCode:'DEMO-C-P1',operatorName:'演示客服甲'});
  const payments=[
    {id:"demo-payment-a",order_id:orders[0].id,order_ref:orders[0].orderRef,customer_label:orders[0].customerLabel,persona_name:"演示人设 A",wechat_id:accounts[0].wechatId,payment_date:today,amount:"1290.50",currency:"CNY",credit_amount:"1290.50",customer_currency:"CNY",purpose:"full",channel:"演示支付宝账户",third_party:false,reference:"DEMO-PAY-001",voided_at:null,settled_amount:"0.00",pendingAmount:"0.00"},
    {id:"demo-payment-b",order_id:orders[1].id,order_ref:orders[1].orderRef,customer_label:orders[1].customerLabel,persona_name:"演示人设 A",wechat_id:accounts[0].wechatId,payment_date:today,amount:"1200.00",currency:"TWD",credit_amount:"1200.00",customer_currency:"TWD",purpose:"deposit",channel:"演示台币代收账户",third_party:true,reference:"DEMO-PAY-002",voided_at:null,settled_amount:"0.00",pendingAmount:"1200.00"},
    {id:"demo-payment-c",order_id:orders[2].id,order_ref:orders[2].orderRef,customer_label:orders[2].customerLabel,persona_name:"演示人设 B",wechat_id:accounts[1].wechatId,payment_date:today,amount:"140.00",currency:"USD",credit_amount:"140.00",customer_currency:"USD",purpose:"full",channel:"演示美元代收账户",third_party:true,reference:"DEMO-PAY-003",voided_at:null,settled_amount:"50.00",pendingAmount:"90.00"}
  ];
  const settlements=[{id:"demo-settlement-a",reference:"DEMO-SET-001",channel:"演示美元代收账户",currency:"USD",settled_on:today,fee_amount:"1.00",fee_currency:"USD",fee_percent:"2.0000",fx_rate:"6.600000",net_cny:"323.40",note:"虚构部分结算；扣费已体现在净到账",voided_at:null,void_reason:null,allocations:[{paymentId:"demo-payment-c",foreignAmount:"50.00",netCny:"323.40"}]}];
  /* 虚构工资数据：工资标准、财务手工项目（提成/奖金/扣款）与锁定状态。经营估算与工资页共用同一组标准。 */
  const ownOps = () => window.CmsOpsWorkspace ? window.CmsOpsWorkspace.rowsFor(opsPerson(),ops) : ops.filter(row => row.userId === currentUser().id);
  const ownAdAccounts = () => window.CmsOpsWorkspace ? window.CmsOpsWorkspace.accountsOf(ownOps()) : [];
  const feedbackKey = "cms-demo-ops-feedback-v1";
  function allFeedback() { try { const data=JSON.parse(window.sessionStorage.getItem(feedbackKey)||"[]");return Array.isArray(data)?data:[]; } catch { return []; } }
  const opsAdAccountKey = "cms-demo-ops-ad-accounts-v1";
  function allOpsAdAccountState() {
    try {
      const data = JSON.parse(window.sessionStorage.getItem(opsAdAccountKey) || "{}");
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch { return {}; }
  }
  function opsAdLedger() {
    const base = opsPersonId === "demo-ops" ? adLedger : {
      ...adLedger,
      accounts: adLedger.accounts.map(row => ({ ...row, code: row.code.replace("DEMO-ADS", "DEMO-" + opsPerson().code + "-ADS") })),
      topups: adLedger.topups.map(row => ({ ...row, account_ref: row.account_ref.replace("DEMO-ADS", "DEMO-" + opsPerson().code + "-ADS") }))
    };
    const entry = allOpsAdAccountState()[opsPersonId] || {};
    const created = Array.isArray(entry.created) ? entry.created : [];
    const renamed = entry.renamed && typeof entry.renamed === "object" ? entry.renamed : {};
    const accounts = [...base.accounts, ...created].map(row => (
      typeof renamed[row.code] === "string" && renamed[row.code].trim() ? { ...row, name: renamed[row.code].trim() } : { ...row }
    ));
    return {
      ...base,
      accounts,
      summary: {
        ...base.summary,
        spentUsd: sumMoney(accounts, "spent_usd"),
        balanceUsd: sumMoney(accounts, "balance_usd")
      }
    };
  }
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
  function baseOrderRecord(order){
    const index=orders.indexOf(order),raw={id:order.id,order_ref:order.orderRef,customer_label:order.customerLabel,business_date:order.businessDate,amount:order.amount,status:order.status,cancelled:!!order.cancelled,wechat_id:order.wechatId,display_name:order.displayName,note:'虚构演示记录',custom_product_cost:order.customProductCost,labor_cost:order.laborCost,shipping_cost:order.shippingCost,material_cost_cny:order.materialCost??null,material_lot_no:order.materialLotNo??null};
    if(order.dealChannel==='private')return {order:raw,cancellations:[],legacy:false,details:{dealChannel:'private',personaName:order.personaName||'',personaCode:order.personaCode||'',liveRoomCode:'',hostName:'',customerCode:order.customerCode,operatorName:order.operatorName,source:'客服私推',customerCurrency:'CNY',customerDue:order.amount,baseCustomerDue:order.amount,shippedOn:null,version:1},items:[{id:'demo-item-private',label:'演示私推原石',material_ref:'DEMO-JADE-P1',kind:'material',price_cny:order.amount,buying_fee_cny:'0.00'}],charges:[],payments:[],expenses:[],attachments:[],paid:'0.00',balance:order.amount,expenseTotal:'0.00'};
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
  function reportHistory(query) {
    if (!['cs','cs_supervisor'].includes(role)) return json({error:'当前身份不能查看客服填报历史'},403);
    const kind=query.get('kind')||'fans',accountId=query.get('accountId')||'',from=query.get('from')||shift(today,-29),to=query.get('to')||today;
    const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
    if (!['fans','orders','after-sales','attendance'].includes(kind)||!validDate(from)||!validDate(to)||from>to||to>today||(Date.parse(to)-Date.parse(from))/86400000>366) return json({error:'请选择有效类别和日期，最多367天'},400);
    if (role==='cs'&&!accountId) return json({error:'请先选择本次填报的接待账号'},400);
    const registeredAccounts=currentDirectory()?.accounts||[];
    if(accountId&&registeredAccounts.some(account=>account.id===accountId))return json({demo:true,canPreviewCorrections:role==='cs_supervisor',accounts:[...registeredAccounts.map(account=>({id:account.id,label:account.holderName+' · '+account.wechatId,teamName:account.teamName})),...visibleAccounts().map(account=>({id:account.id,label:account.wechatId,teamName:account.teamName}))],records:[]});
    const allowed=visibleAccounts();
    if (accountId&&!allowed.some(account=>account.id===accountId)) return json({error:'账号不存在或不在本组范围'},404);
    const selected=allowed.filter(account=>!accountId||account.id===accountId),ids=new Set(selected.map(account=>account.id));
    const foundation=window.CmsAssessmentFoundation?.build(today),records=[];
    const field=(key,label,value,type='text',editable=true)=>({key,label,value:value==null?'未记录':String(value),type,editable});
    const person=(id,date)=>{
      const tenure=foundation?.tenures.find(row=>row.accountId===id&&row.startDate<=date&&(!row.endDate||row.endDate>=date));
      return foundation?.employees.find(row=>row.id===tenure?.employeeId);
    };
    const add=(id,type,account,date,title,fields,source,version=1)=>{
      if(type!==kind||date<from||date>to)return;
      const holder=person(account.id,date);
      records.push({id,kind:type,accountId:account.id,accountLabel:account.wechatId,teamName:account.teamName,businessDate:date,employeeName:holder?.name||'历史归属待核对',employeeCode:holder?.code||'',title,fields,source,version});
    };
    for(const row of fans.filter(row=>ids.has(row.userId))){
      const account=selected.find(account=>account.id===row.userId);
      const labels={msToday:'Messenger 今日进粉',wsToday:'WhatsApp 今日进粉',msMonth:'Messenger 本月累计',wsMonth:'WhatsApp 本月累计',validToday:'今日有效',commReplied:'正常沟通回复',commReadNoReply:'已读不回',commUnread:'未读',commInvalid:'无效粉'};
      add(row.id,'fans',account,row.businessDate,row.pageName,[field('pageName','人设／主页',row.pageName),...Object.entries(labels).filter(([key])=>account.platform==='whatsapp'?!key.startsWith('ms'):!key.startsWith('ws')).map(([key,label])=>field(key,label,row[key],'count')),field('note','备注',row.note)],'原始加粉日报；沟通汇总不用于推算开口转化率',row.recordVersion);
    }
    for(const order of orders.filter(row=>ids.has(row.userId))){
      const account=selected.find(account=>account.id===order.userId),record=orderRecord(order);
      const identity=[field('channel','成交渠道',order.dealChannel==='private'?'客服私推':'直播间开单','text',false),field('customer','客户名',order.customerLabel),field('persona','人设／主页',order.personaName||'未记录'),field('room','直播间／主播',order.dealChannel==='private'?'不归属直播间':([order.liveRoomCode,order.hostName].filter(Boolean).join(' · ')||'未记录'),'text',false)];
      add(order.id,'orders',account,order.businessDate,order.orderRef,[...identity,field('status','订单状态',order.cancelled?'已跑单':order.status==='refunded'?'已退款':'已开单','text',false),...(record.items||[]).flatMap(item=>[field(item.id+':ref','商品编号',item.material_ref||'未记录'),field(item.id+':price','开单价（¥）',item.price_cny,'money'),field(item.id+':fee',order.dealChannel==='private'?'代购费（不收取）':'代购费（¥）',order.dealChannel==='private'?'0.00':item.buying_fee_cny,'money')]),...(!record.items?.length?[field('legacyAmount','历史开单金额（¥）',order.amount,'money',false)]:[]),field('note','备注',record.order.note||'')],record.legacy?'历史订单；商品逐项金额未记录':'开单记录；收款与结算由财务核定',order.recordVersion);
      const charges=(record.charges||[]).filter(row=>!row.voided_at),expenses=(record.expenses||[]).filter(row=>!row.voided_at&&row.category!=='goods');
      const dates=[...new Set([...charges,...expenses].map(row=>row.business_date))];
      for(const date of dates){
        const dayCharges=charges.filter(row=>row.business_date===date),dayExpenses=expenses.filter(row=>row.business_date===date);
        add('after:'+order.id+':'+date,'after-sales',account,date,order.orderRef+' · '+order.customerLabel,[...identity,...dayCharges.flatMap(row=>[field(row.id+':label','客户收费名称',row.label),field(row.id+':amount','客户追加应收（¥）',row.amount_cny,'money')]),...dayExpenses.flatMap(row=>[field(row.id+':label','公司成本项目',row.label),field(row.id+':amount','公司成本（¥）',row.amount_cny,'money')]),field('shippedOn','发货日期',record.details?.shippedOn||'','date'),field('note','备注','')],'按订单与费用发生日整理；客户收费和公司成本分别登记，不含供货结算与财务实际付款');
      }
    }
    for(const row of foundation?.attendance||[]){
      if(!ids.has(row.accountId))continue;
      const account=selected.find(account=>account.id===row.accountId);
      add(row.id,'attendance',account,row.businessDate,row.roomName,[field('room','直播间',row.roomName,'text',false),field('enteredCount','实际入场人数',row.enteredCount,'count'),field('orderedCount','已关联开单人数',row.orderLink==='linked'?new Set(row.orderedCustomerIds).size:'未关联','text',false),field('source','核对来源',row.source),field('note','备注','')],'入场登记；业务日期、接待账号与考核归属保持原记录');
    }
    records.sort((left,right)=>right.businessDate.localeCompare(left.businessDate)||left.id.localeCompare(right.id));
    return json({demo:true,canPreviewCorrections:role==='cs_supervisor',accounts:[...registeredAccounts.map(account=>({id:account.id,label:account.holderName+' · '+account.wechatId,teamName:account.teamName})),...allowed.map(account=>({id:account.id,label:account.wechatId,teamName:account.teamName}))],records});
  }
  const warehouseKey='cms-demo-warehouse-v1';
  function warehouseState(){const raw=window.sessionStorage.getItem(warehouseKey);if(!raw)return window.CmsFinanceSeed?window.CmsFinanceSeed.warehouse(today,shift):{bills:[],payments:[]};const state=JSON.parse(raw);if(!Array.isArray(state.bills)||!Array.isArray(state.payments))throw Error('Warehouse state invalid');return state;}
  function orderRecord(order){const result=baseOrderRecord(order);const extra=warehouseState().bills.filter(b=>b.orderId===order.id&&!b.expenseId&&b.status==='approved').map(b=>({id:'warehouse-exp-'+b.id,business_date:b.date,category:b.category,label:b.label,amount_cny:b.amount,counterparty:b.counterparty,note:b.note,voided_at:null}));return{...result,expenses:[...(result.expenses||[]),...extra],expenseTotal:sumMoney([...(result.expenses||[]),...extra],'amount_cny')};}
  const reimbursementKey='cms-demo-reimbursements-v1';
  function reimbursementState(){const raw=window.sessionStorage.getItem(reimbursementKey);if(!raw)return window.CmsFinanceSeed?window.CmsFinanceSeed.reimbursements(today,shift):{claims:[],payments:[]};const state=JSON.parse(raw);if(!Array.isArray(state.claims)||!Array.isArray(state.payments))throw Error('Reimbursement state invalid');return state;}
  function allSupplierPayments(){const state=warehouseState(),reimbursements=reimbursementState();return [...supplierPayments,...state.payments.map(p=>{const b=state.bills.find(b=>b.id===p.billId);return{id:p.id,expense_id:b.expenseId||'warehouse-exp-'+b.id,paid_on:p.date,payee:p.payee,account:p.account,reference:p.reference,amount_cny:p.amount,note:'Warehouse bill '+b.id,voided_at:null};}),...reimbursements.payments.filter(p=>reimbursements.claims.find(c=>c.id===p.claimId)?.expenseId).map(p=>{const claim=reimbursements.claims.find(c=>c.id===p.claimId);return{id:p.id,expense_id:claim.expenseId,paid_on:p.date,payee:p.payee,account:p.account,reference:p.reference,amount_cny:p.amount,note:'Reimbursement '+claim.id,voided_at:null};})];}
  function allPaymentReferences(){return [...allSupplierPayments().map(p=>p.reference),...reimbursementState().payments.map(p=>p.reference)];}
  const supplierPayments=[{id:'demo-supplier-payment-1',expense_id:'demo-expense-0',paid_on:today,payee:'演示供货方',account:'演示公司付款户',reference:'DEMO-SUP-PAY-001',amount_cny:'600.00',note:'虚构部分付款',voided_at:null}];
  function payables(){
    const paid=allSupplierPayments();
    const expenses=orders.filter(o=>o.workflowEnabled).flatMap(o=>orderRecord(o).expenses.filter(e=>!e.voided_at).map(e=>{const total=paid.filter(p=>p.expense_id===e.id&&!p.voided_at).reduce((n,p)=>n+cents(p.amount_cny),0n),remaining=cents(e.amount_cny)-total;return {...e,order_id:o.id,order_ref:o.orderRef,customer_label:o.customerLabel,persona_name:o.personaName,persona_code:o.personaCode,live_room_code:o.liveRoomCode,host_name:o.hostName,customer_code:o.customerCode,operator_name:o.operatorName,wechat_id:o.wechatId,material_ref:o.materialLotNo||'DEMO-JADE-'+(orders.indexOf(o)+1),item_label:'Demo item',paid_cny:money(total),pending_cny:money(remaining),paymentState:remaining===0n?'paid':total>0n?'partial':'unpaid'};}));
    return {expenses,payments:paid,summary:{costCny:sumMoney(expenses,'amount_cny'),paidCny:sumMoney(paid.filter(p=>!p.voided_at),'amount_cny'),pendingCny:sumMoney(expenses,'pending_cny'),unknownCount:0}};
  }
  const adLedger={accounts:[{code:'DEMO-ADS-01',name:'演示 Facebook 共享广告户',opened_on:today,opening_usd:'73.00',topped_usd:'50.00',spent_usd:'22.20',balance_usd:'100.80'},{code:'DEMO-ADS-02',name:'演示 TikTok 共享广告户',opened_on:today,opening_usd:'27.00',topped_usd:'0.00',spent_usd:'7.00',balance_usd:'20.00'}],topups:[{id:'demo-topup-1',account_ref:'DEMO-ADS-01',paid_on:today,credited_usd:'50.00',paid_cny:'360.00',payment_account:'演示公司付款户',reference:'DEMO-AD-PAY-001',note:'虚构充值，实付和美元入账独立记录',voided_at:null}],summary:{paidCny:'360.00',creditedUsd:'50.00',spentUsd:'29.20',balanceUsd:'120.80'}};
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
  const paidPerformanceRecords=[{id:'demo-paid-1',business_date:today,live_room_code:'DEMO-LIVE-01',host_name:'甜甜',amount_cny:'1290.50',note:'虚构财务专项核定，系统不计算主播提成',created_by_name:'演示财务',voided_at:null,void_reason:null}];
  // 虚构财务按直播间、按日录入的金额（不是按成交额比例估算）。LIVE-01 提成已录入，LIVE-02 提成未录入，用于对照「待财务录入 / 待核算」。
  const liveRoomStaffCosts=[
    {id:'demo-staff-h1',live_room_code:'DEMO-LIVE-01',business_date:today,kind:'host_commission',amount_cny:'120.00',session_label:'',note:'虚构财务录入的主播提成（已录入金额，非按比例估算）'},
    {id:'demo-staff-a1',live_room_code:'DEMO-LIVE-01',business_date:today,kind:'assistant_commission',amount_cny:'40.00',session_label:'',note:'虚构财务录入的主播助理提成'},
    {id:'demo-staff-act1',live_room_code:'DEMO-LIVE-01',business_date:today,kind:'actor_session',amount_cny:'80.00',session_label:'演示场次 · 上午',note:'虚构货主演员按次费用'},
    {id:'demo-staff-act2',live_room_code:'DEMO-LIVE-02',business_date:today,kind:'actor_session',amount_cny:'60.00',session_label:'演示场次 · 晚场',note:'虚构货主演员按次费用'}
  ];
  // 与 BOSS 营业额同口径：开单卡料价＋代购费；历史简版单用原金额。
  function bookingAmount(o){const d=orderRecord(o);return d.legacy?o.amount:money(d.items.reduce((n,i)=>n+cents(i.price_cny)+cents(i.buying_fee_cny),0n));}
  const roomTitle=code=>({'DEMO-LIVE-01':'一号直播间','DEMO-LIVE-02':'二号直播间'}[code]||code||'未归属直播间');
  function cashOrderBalances(query){
    const date=query.get('asOf');
    if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>today){
      return json({error:'截止日期无效'},400);
    }
    const operations=window.CmsLiveRoomOperations.build(orders.map(order=>({
      ...orderRecord(order),identity:order,payments:payments.filter(payment=>payment.order_id===order.id)
    })),{from:date,to:date});
    const privateIds=new Set(orders.filter(order=>order.dealChannel==='private').map(order=>order.id));
    return json({asOf:date,orders:operations.orders.map(order=>({
      ...order,roomCode:privateIds.has(order.id)?'客服私推':roomTitle(order.roomKey==='__unassigned__'?'':order.roomKey)
    }))});
  }
  function liveBusiness(query) {
    const period=dashboard(query).period,selected=Object.fromEntries(['room','host','persona','operator'].map(k=>[k,query.get(k)||'']));
    if(![period.from,period.to].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d)))||period.from>period.to)return json({error:'日期范围无效'},400);
    const matchDate=d=>d>=period.from&&d<=period.to;
    const scoped=orders.filter(o=>o.dealChannel!=='private'&&(!selected.room||(selected.room==='__unassigned__'?!o.liveRoomCode:o.liveRoomCode===selected.room))&&(!selected.host||o.hostName===selected.host)&&(!selected.persona||o.personaCode===selected.persona)&&(!selected.operator||o.operatorName===selected.operator));
    const empty=()=>({performanceCny:'0.00',newSalesCny:'0.00',grossSalesCny:'0.00',cancelledSalesCny:'0.00',grossOrderCount:0,cancelledOrderCount:0,excludedAdditionalCny:'0.00',additionalCny:'0.00',expenseCny:'0.00',supplierPaidCny:'0.00',companyReceivedCny:'0.00',excludedSourceCny:'0.00',newOrderCount:0,expenseCount:0,customerReceipts:{CNY:'0.00',TWD:'0.00',USD:'0.00'}});
    const totals=empty(),rooms=new Map(),events=[];
    const plus=(t,k,v)=>{t[k]=money(cents(t[k])+cents(v));};
    function push(o,id,kind,date,amount,currency='CNY',label=kind,category='') {
      if(!matchDate(date))return;
      const order={...orderRecord(o).order,persona_code:o.personaCode,persona_name:o.personaName,live_room_code:o.liveRoomCode,host_name:o.hostName,customer_code:o.customerCode,operator_name:o.operatorName};
      events.push({id,order_id:o.id,kind,date,amount,currency,label,category,order});
      const key=o.liveRoomCode||'__unassigned__';if(!rooms.has(key))rooms.set(key,{key,roomCode:roomTitle(o.liveRoomCode),hosts:[],personas:[],totals:empty()});
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
      for(const p of allSupplierPayments().filter(p=>!p.voided_at)){const e=d.expenses.find(e=>e.id===p.expense_id&&!e.voided_at);if(e)push(o,p.id,'supplier',p.paid_on,p.amount_cny,'CNY',p.payee,e.category);}
    }
    for(const t of [totals,...[...rooms.values()].map(r=>r.totals)])t.performanceCny=t.newSalesCny;
    const MATERIAL=new Set(['goods','sourcing','material']);
    const roomKeyOf=code=>code||'__unassigned__';
    for(const row of liveRoomStaffCosts.filter(r=>matchDate(r.business_date)&&(!selected.room||(selected.room==='__unassigned__'?!r.live_room_code:r.live_room_code===selected.room)))){
      const key=roomKeyOf(row.live_room_code);
      if((selected.host||selected.persona||selected.operator)&&!scoped.some(o=>roomKeyOf(o.liveRoomCode)===key))continue;
      if(!rooms.has(key))rooms.set(key,{key,roomCode:roomTitle(row.live_room_code),hosts:[],personas:[],totals:empty()});
    }
    function materialCost(key){
      let orderCard=0n,fallback=0n,excluded=0n;
      for(const o of scoped){
        if(roomKeyOf(o.liveRoomCode)!==key)continue;
        const hasCard=o.materialCost!=null&&o.materialCost!=='';
        if(o.cancelled||o.status==='refunded'){
          if(hasCard&&matchDate(o.businessDate))excluded+=cents(o.materialCost);
          continue;
        }
        if(hasCard){if(matchDate(o.businessDate))orderCard+=cents(o.materialCost);continue;}
        const rec=orderRecord(o);
        for(const e of rec.expenses||[]){
          if(e.voided_at||!MATERIAL.has(e.category)||!matchDate(e.business_date))continue;
          fallback+=cents(e.amount_cny);
        }
      }
      return {materialCostCny:money(orderCard+fallback),materialCostSources:{orderCardCny:money(orderCard),expenseFallbackCny:money(fallback),excludedCancelledCny:money(excluded),label:'优先采用开单卡「料子本钱」；仅当该单没有此字段时，才回退已登记的供货款/配货款。跑单订单的料子本钱不计入成本。当日无货主演员场次按 0，不显示待录入。'}};
    }
    function staffFor(key){
      // Staff entries belong to a whole room/day. Never deduct that entire cost
      // from a subset of orders filtered by persona, operator, or host.
      if(selected.host||selected.persona||selected.operator){
        const line=()=>({value:null,status:'unsupported_scope',records:[]});
        return {hostCommission:line(),assistantCommission:line(),actorSessionFee:line(),totalCny:null,status:'unsupported_scope'};
      }
      const rows=liveRoomStaffCosts.filter(r=>matchDate(r.business_date)&&roomKeyOf(r.live_room_code)===key);
      const line=(kind,optionalZero)=>{
        const hit=rows.filter(r=>r.kind===kind);
        if(!hit.length)return optionalZero?{value:'0.00',status:'ok',records:[]}:{value:null,status:'pending_finance',records:[]};
        return {value:money(hit.reduce((n,r)=>n+cents(r.amount_cny),0n)),status:'ok',records:hit.map(r=>({id:r.id,date:r.business_date,amount_cny:r.amount_cny,session_label:r.session_label,note:r.note}))};
      };
      const hostCommission=line('host_commission',false),assistantCommission=line('assistant_commission',false),actorSessionFee=line('actor_session',true);
      const pending=hostCommission.status==='pending_finance'||assistantCommission.status==='pending_finance';
      const totalCny=pending?null:money(cents(hostCommission.value)+cents(assistantCommission.value)+cents(actorSessionFee.value));
      return {hostCommission,assistantCommission,actorSessionFee,totalCny,status:pending?'pending_finance':'ok'};
    }
    function attachProfit(key,performanceCny){
      const material=materialCost(key);
      const staff=staffFor(key);
      const liveRoomProfitCny=staff.status==='ok'?money(cents(performanceCny)-cents(material.materialCostCny)-cents(staff.totalCny)):null;
      return {...material,staff,liveRoomProfitCny,status:staff.status,source:'演示指标：料子本钱优先开单卡字段，缺省回退供货款/配货款；跑单料本不计入；提成与货主演员费用为虚构财务录入金额'};
    }
    const operations=window.CmsLiveRoomOperations.build(scoped.map(o=>({...orderRecord(o),identity:o})),period);
    operations.orders.forEach(o=>{o.roomCode=roomTitle(o.roomKey==='__unassigned__'?'':o.roomKey);});
    // Historical open orders still need attention even when no event occurred today.
    for(const o of operations.orders.filter(o=>o.bookedInPeriod||o.status==='unpaid'||o.status==='partial')){
      if(!rooms.has(o.roomKey))rooms.set(o.roomKey,{key:o.roomKey,roomCode:o.roomCode,hosts:o.hostName?[o.hostName]:[],personas:o.personaName?[o.personaName]:[],totals:empty()});
    }
    for(const room of rooms.values())room.profit=attachProfit(room.key,room.totals.performanceCny);
    const ads=ops.filter(r=>matchDate(r.businessDate)&&r.spendUsd!=null).map(r=>({id:r.id,date:r.businessDate,persona:r.personaName,account:r.adAccountRef||'历史未关联',amount:r.spendUsd}));
    const paidRecords=paidPerformanceRecords.filter(r=>!r.voided_at&&matchDate(r.business_date)&&(!selected.room||r.live_room_code===selected.room)&&(!selected.host||r.host_name===selected.host));
    const paidPerformance={amountCny:paidRecords.length?sumMoney(paidRecords,'amount_cny'):null,recordCount:paidRecords.length,scope:'room_host',records:paidRecords.map(r=>({...r,date:r.business_date}))};
    const afterSales={receipts:{CNY:'0.00',TWD:'0.00',USD:'0.00'},recordCount:0,unclassifiedReceiptCount:events.filter(e=>e.kind==='receipt').length,records:[]};
    const legacy=scoped.filter(o=>!o.workflowEnabled&&cents(o.customProductCost)+cents(o.laborCost)+cents(o.shippingCost)>0n);
    return json({period,selected,totals,paidPerformance,afterSales,operations,rooms:[...rooms.values()].sort((a,b)=>Number(cents(b.totals.performanceCny)-cents(a.totals.performanceCny))),events,options:orders.filter(o=>o.dealChannel!=='private').map(o=>({room:o.liveRoomCode,host:o.hostName,persona:o.personaCode,persona_name:o.personaName,operator:o.operatorName})),ads:{scope:'company',spendUsd:sumMoney(ads,'amount'),records:ads,unknownCount:0},legacyCost:{count:legacy.length,amountCny:money(legacy.reduce((n,o)=>n+cents(o.customProductCost)+cents(o.laborCost)+cents(o.shippingCost),0n))},refundMethod:'cancelled_and_legacy_refunded_orders_reverse_original_booking_day',turnoverMethod:'booking_price_plus_buying_fee_excludes_additional_charges',profitMethod:'turnover_minus_material_and_entered_staff_costs'});
  }
  function dashboard(query) {
    const preset=query.get("preset")||"day";
    const weekday=(new Date(today+"T00:00:00Z").getUTCDay()+6)%7;
    const from=query.get("from")||(preset==="month"?today.slice(0,7)+"-01":preset==="week"?shift(today,-weekday):today);
    const to=query.get("to")||today;
    const inRange=(row)=>row.businessDate>=from&&row.businessDate<=to;
    function bundle() {
      const match=(row)=>inRange(row);
      const os=orders.filter(o=>o.dealChannel!=='private'&&match(o)),fs=fans.filter(match),op=ops.filter(match),ed=editors.filter(match);
      const snapshots=Object.values(ed.reduce((result,row)=>{const key=row.userId+(row.editorName||"")+row.personaName;if(!result[key]||row.businessDate>result[key].businessDate)result[key]=row;return result;},{}));
      const accountSet=new Set(op.map(r=>r.adAccountRef));
      const endingOps=Object.values(ops.filter(r=>r.businessDate<=to&&accountSet.has(r.adAccountRef)).reduce((result,row)=>{const key=row.adAccountRef;if(!result[key]||row.businessDate>result[key].businessDate)result[key]=row;return result;},{}));
      return {revenue:sumMoney(os,"amount"),refunds:sumMoney(os.filter((o)=>o.status==="refunded"),"amount"),promoCost:sumMoney(op,"promoCost"),customProductCost:sumMoney(os,"customProductCost"),laborCost:sumMoney(os,"laborCost"),shippingCost:sumMoney(os,"shippingCost"),orderCount:os.filter((o)=>o.status!=="refunded").length,promoVideoCount:sum(op,"promoVideoCount"),shootCount:sum(ed,"shootCount"),finishedCount:sum(ed,"finishedCount"),publishedCount:sum(ed,"publishedCount"),endingInventory:sum(snapshots,"inventorySnapshot"),fanAddedTotal:sum(fs,"addedCount"),...fanTotals(fs),editCount:sum(ed,"editCount"),sentToOpsCount:sum(ed,"sentToOpsCount"),statsIncomplete:false,legacyUnclassifiedAdded:0,opsUsd:{spendUsd:sumMoney(op,"spendUsd"),consultCount:sum(op,"consultCount"),clickCount:sum(op,"clickCount"),endingBalanceUsd:sumMoney(endingOps,"balanceUsd")}};
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
        add({id:o.id,kind:'booking',date:o.businessDate,amount:bookingAmount(o),currency:'CNY',label:o.orderRef,orderId:o.id,excluded:o.dealChannel==='private'?'客服私推不计入直播间营业额':o.cancelled?'跑单回冲原开单日':o.status==='refunded'?'历史退款标记源单':''});
        for(const e of record.expenses||[])if(!e.voided_at)add({id:e.id,kind:'cost',date:e.business_date,amount:e.amount_cny,currency:'CNY',label:e.label,category:e.category,orderId:o.id});
        for(const p of record.payments||[])if(!p.voided_at)add({id:p.id,kind:'payment',date:p.payment_date,amount:p.amount,currency:p.currency,label:o.orderRef+' · '+({deposit:'定金',balance:'尾款',full:'全款'}[p.purpose]||'客户付款'),orderId:o.id,bookingDate:o.businessDate});
      }
      for(const o of ops)if(o.spendUsd!=null)add({id:o.id,kind:'ad',date:o.businessDate,amount:o.spendUsd,currency:'USD',label:o.adAccountRef+' · 广告消耗'});
      const lastUpdate=rows.length?stamp.toISOString():null;
      const dataset={rows,coverage:{from:shift(today,-800),to:today},
        rates:demoFxRates,
        // A fictional prior-day finance result demonstrates explicit values. Today
        // is deliberately absent, so the headline must say 待财务核算.
        finance:[{date:shift(today,-1),materialCost:'600.00',commission:'70.00',collectionFee:'8.00',source:'虚构财务专项核算'}],
        paidPerformance:paidPerformanceRecords.filter(r=>!r.voided_at).map(r=>({date:r.business_date,amount:r.amount_cny,label:r.live_room_code+' · '+r.host_name})),
        targets:[],sources:['开单卡','客户付款','费用明细','广告消耗','财务专项核算'].map(name=>({name,updatedAt:name==='财务专项核算'?shift(today,-1)+'T04:00:00Z':lastUpdate}))};
      const body=window.CmsBossOverview.build(dataset,Object.fromEntries(query),{today,localTime,asOf:stamp.toISOString()});
      const privateOrders=orders.filter(o=>o.dealChannel==='private'&&!o.cancelled&&o.status!=='refunded'&&o.businessDate>=body.period.from&&o.businessDate<=body.period.to);
      body.privatePush={amount:money(privateOrders.reduce((n,o)=>n+cents(bookingAmount(o)),0n)),count:privateOrders.length,definition:'客服私推按开单日只计料价，不收代购费，不计入直播间开单营业额，也不进入主播提成。业绩记在经办客服名下。主管提成规则尚未启用。'};
      return json(body);
    }catch{return json({error:'演示指标日期或数据格式无效'},400);}
  }
  const dailyExpenseKey='cms-demo-daily-expenses-v1';
  function dailyExpenseRows(){try{const rows=JSON.parse(window.sessionStorage.getItem(dailyExpenseKey)||'[]');return Array.isArray(rows)?rows:[];}catch{return [];}}
  function bossPriority(q){
    const period=window.CmsBossOverview.periodOf(Object.fromEntries(q),today);
    const foundation=window.CmsAssessmentFoundation.build(today),directory=currentDirectory();
    const people=[...(directory?.people||[]).map(person=>({id:person.id,name:person.name,room:'overseas-one',team:'\u79cb\u83ca\u7ec4',sample:false})),...foundation.employees.map(person=>({id:person.id,name:person.name,room:person.teamId==='demo-team-a'?'overseas-one':'unassigned',team:'\u6f14\u7ec3\u6210\u5458',sample:true}))];
    const owner=name=>people.find(person=>person.name===name);
    const sales=orders.map(order=>({id:order.id,date:order.businessDate,amount:bookingAmount(order),channel:order.dealChannel==='private'?'private':'live',room:order.dealChannel==='private'?(owner(order.operatorName)?.room||'unassigned'):order.liveRoomCode==='DEMO-LIVE-01'?'overseas-one':order.liveRoomCode==='DEMO-LIVE-02'?'overseas-two':'unassigned',employeeId:owner(order.operatorName)?.id||'',cancelled:order.cancelled,status:order.status}));
    const daily=fans.map(report=>{
      const tenure=foundation.tenures.find(item=>item.accountId===report.userId&&item.startDate<=report.businessDate&&(!item.endDate||item.endDate>=report.businessDate));
      return{date:report.businessDate,employeeId:tenure?.employeeId||'',total:report.addedCount,effective:report.validToday,invalid:report.commInvalid?null:0,pendingInvalid:report.commInvalid};
    });
    try{
      const crm=JSON.parse(window.sessionStorage.getItem('cms-demo-customer-crm-v1')||'null');
      if(crm&&Array.isArray(crm.customers)&&Array.isArray(crm.orders)&&Array.isArray(crm.reviews)){
        const customers=crm.customers.filter(customer=>!customer.sample&&people.some(person=>person.id===customer.employeeId));
        for(const order of crm.orders){
          const customer=customers.find(customer=>customer.id===order.customerId);
          if(!customer||sales.some(row=>row.id===order.id))continue;
          sales.push({id:order.id,date:order.businessDate,amount:money(BigInt(order.materialCents+(order.channel==='private'?0:order.feeCents))),channel:order.channel,room:people.find(person=>person.id===order.employeeId)?.room||'unassigned',employeeId:order.employeeId,cancelled:order.cancelled,status:'placed'});
        }
        for(const customer of customers){
          const latest=crm.reviews.filter(review=>review.customerId===customer.id).sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)).at(-1);
          const invalid=latest?.status==='approved';
          daily.push({date:customer.createdOn,employeeId:customer.employeeId,total:1,effective:invalid||latest?.status==='pending'?0:1,invalid:invalid?1:0,pendingInvalid:latest?.status==='pending'?1:0});
        }
      }
    }catch{/* Malformed browser trial data never replaces registered source records. */}
    return window.CmsBossPriority.build({from:period.from,to:period.to,orders:sales,people,fans:daily,expenses:dailyExpenseRows()});
  }
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==="string"?input:input.url,window.location.origin);
    if(url.origin==="https://api.exchangerate.dev"&&url.pathname.startsWith("/v1/")){
      const parts=url.pathname.split("/").filter(Boolean);
      const period=parts[1],base=parts[2];
      if((base==="USD"||base==="TWD")&&(period==="latest"||/^\d{4}-\d{2}-\d{2}$/.test(period))){
        const rate=base==="USD"?7.24:0.2235;
        const date=period==="latest"?today:period;
        const updated=new Date(Math.min(Date.now(),Date.parse(date+"T12:00:00Z"))).toISOString();
        return json({result:"success",base,date,rates:{CNY:rate},effective_at:{CNY:updated},data_updated_at:updated,source:"live",stale:{CNY:false}});
      }
    }
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
    if(path==='/api/demo/reimbursements'){
      if(role!=='finance')return json({error:'Finance access required'},403);
      if(!window.CmsReimbursements)return json({error:'Reimbursement module unavailable'},503);
      try{
        const snapshot=()=>({state:reimbursementState(),categories:window.CmsReimbursements.categories,expenses:payables().expenses.filter(e=>!e.voided_at&&e.pending_cny!==null&&cents(e.pending_cny)>0n)});
        if(method==='GET')return json(snapshot());
        if(method!=='POST')return json({error:'Unsupported method'},405);
        const next=window.CmsReimbursements.apply(reimbursementState(),JSON.parse(options.body||'{}'),{role,today,actor:currentUser().displayName,expenses:payables().expenses,references:allPaymentReferences(),id:'reim-'+Date.now()+'-'+Math.random().toString(36).slice(2,9),now:new Date().toISOString()});
        window.sessionStorage.setItem(reimbursementKey,JSON.stringify(next));return json(snapshot());
      }catch(error){return json({error:error.message||'Reimbursement request failed'},error.status||400);}
    }
    if(path==='/api/demo/warehouse'){
      if(!['warehouse','finance'].includes(role))return json({error:'Warehouse or finance access required'},403);
      if(!window.CmsWarehouse)return json({error:'Warehouse module unavailable'},503);
      try{
        const snapshot=()=>({state:warehouseState(),expenses:payables().expenses,orders:orders.filter(o=>o.workflowEnabled&&!o.cancelled&&o.status!=='refunded').map(o=>({id:o.id,orderRef:o.orderRef,customerLabel:o.customerLabel,liveRoomCode:o.liveRoomCode,hostName:o.hostName,operatorName:o.operatorName,personaName:o.personaName,customerCode:o.customerCode})),kinds:window.CmsWarehouse.kinds});
        if(method==='GET')return json(snapshot());
        if(method!=='POST')return json({error:'Unsupported method'},405);
        const body=JSON.parse(options.body||'{}');
        const next=window.CmsWarehouse.apply(warehouseState(),body,{role,today,actor:currentUser().displayName,orders,expenses:payables().expenses,references:allPaymentReferences(),id:'wh-'+Date.now()+'-'+Math.random().toString(36).slice(2,9),now:new Date().toISOString()});
        window.sessionStorage.setItem(warehouseKey,JSON.stringify(next));return json(snapshot());
      }catch(error){return json({error:error.message||'Warehouse request failed'},error.status||400);}
    }
    if(path==='/api/demo/order-followups'){
      if(role!=='cs_supervisor')return json({error:'仅客服主管可管理本组订单跟进'},403);
      const key='cms-demo-order-followups-v1',allowed=new Set(visibleOrders().map(o=>o.id));
      let records;try{records=JSON.parse(window.sessionStorage.getItem(key)||'[]');if(!Array.isArray(records))throw Error();}catch{return json({error:'跟进记录读取失败，请勿覆盖原记录'},400);}
      const visible=()=>records.filter(row=>allowed.has(row.orderId));
      if(method==='GET')return json({records:visible()});
      if(method!=='POST')return json({error:'不支持此操作'},405);
      let body;try{body=JSON.parse(options.body||'{}');}catch{return json({error:'输入格式无效'},400);}
      if(!allowed.has(body.orderId))return json({error:'订单不存在或不在本组范围'},404);
      if(typeof body.note!=='string'||!body.note.trim()||body.note.length>1000||typeof body.nextContactOn!=='string')return json({error:'请填写1000字以内的跟进备注'},400);
      const next=body.nextContactOn;
      if(next&&(!/^\d{4}-\d{2}-\d{2}$/.test(next)||!Number.isFinite(Date.parse(next+'T00:00:00Z'))||new Date(next+'T00:00:00Z').toISOString().slice(0,10)!==next||next<today))return json({error:'下次联系日期不能早于今天且必须有效'},400);
      const old=records.find(row=>row.orderId===body.orderId);
      if(body.version!==(old?.version||0))return json({error:'跟进记录已更新，请刷新后再登记'},409);
      const record={orderId:body.orderId,note:body.note.trim(),nextContactOn:next,version:(old?.version||0)+1,updatedBy:currentUser().displayName,updatedAt:new Date().toISOString(),history:[...(old?.history||[]),...(old?[{note:old.note,nextContactOn:old.nextContactOn,version:old.version,updatedBy:old.updatedBy,updatedAt:old.updatedAt}]:[])]};
      records=records.filter(row=>row.orderId!==body.orderId).concat(record);
      try{window.sessionStorage.setItem(key,JSON.stringify(records));}catch{return json({error:'跟进记录保存失败'},400);}
      return json({records:visible()});
    }
    if(path==='/api/demo/service-directory/manage'&&method==='POST'){
      if(role!=='cs_supervisor')return json({error:'接待账号由本组客服主管管理'},403);
      try{
        const input=JSON.parse(options.body||'{}');
        if(input.kind==='reset'){window.sessionStorage.setItem(directoryStorageKey,'');return json({directory:currentDirectory(),message:'已清除本次账号管理演练'});}
        if(!window.CmsServiceAccountManagement)return json({error:'账号管理组件未加载，请刷新页面'},503);
        const updated=window.CmsServiceAccountManagement.apply(currentDirectory(),input,{role,today,id:'trial-account-'+Date.now()+'-'+Math.random().toString(36).slice(2,9),actor:currentUser().displayName,createdAt:new Date().toISOString()});
        window.sessionStorage.setItem(directoryStorageKey,JSON.stringify(updated));
        return json({directory:updated,message:'已更新本次浏览器演练；没有写入正式后台'});
      }catch(error){return json({error:error.message||'账号管理操作失败'},400);}
    }
    if(path==='/api/demo/boss-priority'){
      if(role!=='boss'||!['GET','HEAD'].includes(method))return json({error:'Boss read only'},403);
      if(!window.CmsBossPriority)return json({error:'Overview unavailable'},503);
      try{return json(bossPriority(q));}catch(error){return json({error:error.message||'Overview failed'},400);}
    }
    if(path==='/api/demo/daily-expenses'){
      if(!['boss','finance'].includes(role))return json({error:'Finance or boss only'},403);
      if(['GET','HEAD'].includes(method))return json({records:dailyExpenseRows()});
      if(role!=='finance'||method!=='POST')return json({error:'Finance write only'},403);
      try{const record=window.CmsBossPriority.expense(JSON.parse(options.body||'{}'),today,currentUser().displayName,'expense-'+Date.now()+'-'+Math.random().toString(36).slice(2,8));const records=[...dailyExpenseRows(),record];window.sessionStorage.setItem(dailyExpenseKey,JSON.stringify(records));return json({records});}catch(error){return json({error:error.message||'Save failed'},400);}
    }
    if(path==='/api/demo/editor-identity'){
      if(role!=='editor')return json({error:'\u4ec5\u62cd\u526a\u7aef\u53ef\u5207\u6362\u62cd\u526a\u5e08'},403);
      if(!window.CmsEditorHistory)return json({error:'\u62cd\u526a\u7ec4\u4ef6\u672a\u52a0\u8f7d'},503);
      if(method==='POST'){
        let body;try{body=JSON.parse(options.body||'{}');}catch{return json({error:'Invalid input'},400);}
        if(!window.CmsEditorHistory.names.includes(body.editor))return json({error:'\u62cd\u526a\u5e08\u65e0\u6548'},400);
        window.sessionStorage.setItem('cms-demo-current-editor',body.editor);
      }else if(!['GET','HEAD'].includes(method))return json({error:'Method not allowed'},405);
      return json({editor:window.sessionStorage.getItem('cms-demo-current-editor')||'',names:window.CmsEditorHistory.names});
    }
    if(path==='/api/demo/editor-history'){
      if(role!=='editor')return json({error:'\u4ec5\u62cd\u526a\u672c\u4eba\u53ef\u7ba1\u7406\u65e5\u62a5'},403);
      if(!window.CmsEditorHistory)return json({error:'\u62cd\u526a\u7ec4\u4ef6\u672a\u52a0\u8f7d'},503);
      const editor=window.sessionStorage.getItem('cms-demo-current-editor')||'';
      if(!window.CmsEditorHistory.names.includes(editor))return json({error:'\u8bf7\u5148\u9009\u62e9\u62cd\u526a\u5e08'},403);
      const key='cms-demo-editor-history-v1';
      let records;try{records=JSON.parse(window.sessionStorage.getItem(key)||'null');}catch{}
      if(!Array.isArray(records))records=window.CmsEditorHistory.seed(editors,today);
      if(method==='POST'){
        try{const input=JSON.parse(options.body||'{}');records=window.CmsEditorHistory.apply(records,input,{editor,today,id:'trial-editor-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),now:new Date().toISOString()});window.sessionStorage.setItem(key,JSON.stringify(records));}
        catch(error){return json({error:error.message||'\u4fdd\u5b58\u5931\u8d25'},400);}
      }else if(!['GET','HEAD'].includes(method))return json({error:'\u4e0d\u652f\u6301\u5220\u9664\u5386\u53f2\u8bb0\u5f55'},405);
      return json({editor,records:records.filter(record=>record.editorName===editor).sort((a,b)=>b.businessDate.localeCompare(a.businessDate)),demo:true});
    }
    if(path==='/api/demo/supervisor-consultation-cost'){
      if(role!=='cs_supervisor')return json({error:'\u4ec5\u5ba2\u670d\u4e3b\u7ba1\u53ef\u67e5\u770b\u672c\u7ec4\u54a8\u8be2\u6210\u672c'},403);
      if(!['GET','HEAD'].includes(method))return json({error:'\u54a8\u8be2\u6210\u672c\u4ec5\u53ef\u67e5\u770b'},403);
      const allowed=[teams[0],...(currentDirectory()?[{id:currentDirectory().team.id,name:currentDirectory().team.name}]:[])];
      const team=q.get('teamId')?allowed.find(team=>team.id===q.get('teamId')):allowed[allowed.length-1];
      if(!team)return json({error:'\u4e0d\u80fd\u67e5\u770b\u5176\u4ed6\u5c0f\u7ec4'},403);
      const date=q.get('date')||today;
      if(date>today)return json({error:'\u4e0d\u80fd\u67e5\u770b\u672a\u6765\u65e5\u671f'},400);
      if(!window.CmsSupervisorConsultationCost)return json({error:'\u54a8\u8be2\u6210\u672c\u7ec4\u4ef6\u672a\u52a0\u8f7d'},503);
      try{
        const allRows=window.CmsOpsWorkspace?window.CmsOpsWorkspace.people.flatMap(person=>window.CmsOpsWorkspace.rowsFor(person,ops)):ops;
        const links=(window.CmsSupervisorAdLinks||[]).filter(link=>currentDirectory()||!link.teamId.startsWith("registered-"));
        if(q.has('from')||q.has('to')){
          const {from,to}=Object.fromEntries(q), span=(Date.parse(to)-Date.parse(from))/86400000;
          if(!Number.isInteger(span)||span<0||span>366||to>today||shift(from,0)!==from||shift(to,0)!==to)throw Error('日期范围无效');
          return json({days:Array.from({length:span+1},(_,i)=>
            window.CmsSupervisorConsultationCost.build({rows:allRows,links,team,date:shift(from,i)}).current)});
        }
        return json(window.CmsSupervisorConsultationCost.build({rows:allRows,links,team,date}));
      }catch(error){return json({error:error.message||'\u54a8\u8be2\u6210\u672c\u6682\u4e0d\u53ef\u7528'},400);}
    }
    if(path==='/api/demo/ops-workspace'&&method==='GET')return role==='ops'?json({people:opsPeople,current:opsPerson(),accounts:ownAdAccounts(),loginEnabled:false}):json({error:'仅运营可查看本人工作配置'},403);
    if(path==='/api/demo/ops-feedback'){
      if(role!=='ops')return json({error:'仅运营本人可填写和查看反馈'},403);
      if(method==='GET')return json({records:allFeedback().filter(row=>row.authorId===opsPersonId)});
      if(method!=='POST')return json({error:'不支持的反馈操作'},405);
      try{
        const input=JSON.parse(options.body||'{}'),records=allFeedback();
        if(input.kind==='followup'){
          const record=records.find(row=>row.id===input.id&&row.authorId===opsPersonId);
          if(!record)return json({error:'反馈不存在或不属于当前运营'},404);
          if(!['pending','progress','done'].includes(input.status)||typeof input.followup!=='string'||input.followup.length>1500)throw Error('跟进内容或状态无效');
          if(input.status!=='pending'&&!input.followup.trim())throw Error('请补充跟进措施或结果');
          record.status=input.status;record.followup=input.followup.trim();record.updatedAt=new Date().toISOString();
        }else{
          if(!window.CmsOpsWorkspace)throw Error('运营组件未加载，请刷新');
          if(records.filter(row=>row.authorId===opsPersonId).length>=50)throw Error('本次演练最多保存50条反馈');
          const fields=window.CmsOpsWorkspace.validateFeedback(input,ownAdAccounts(),today);
          records.push({...fields,id:'feedback-'+Date.now()+'-'+Math.random().toString(36).slice(2,9),authorId:opsPersonId,authorName:opsPerson().name,status:'pending',followup:'',createdAt:new Date().toISOString()});
        }
        const saved=JSON.stringify(records);if(saved.length>2400000)throw Error('本次截图容量已满，请减少附件');
        window.sessionStorage.setItem(feedbackKey,saved);
        return json({records:records.filter(row=>row.authorId===opsPersonId),message:'反馈已保存到本次浏览器演练，未写入服务器'});
      }catch(error){return json({error:error.message||'反馈保存失败'},400);}
    }
    if(path==='/api/demo/ops-ad-accounts'){
      if(role!=='ops')return json({error:'仅运营可管理广告户'},403);
      if(method!=='POST')return json({error:'不支持的广告户操作'},405);
      try{
        const input=JSON.parse(options.body||'{}');
        const action=input.action;
        if(action!=='create'&&action!=='rename')return json({error:'不支持的广告户操作'},400);
        const code=typeof input.code==='string'?input.code.trim():'';
        const name=typeof input.name==='string'?input.name.trim():'';
        if(!code||code.length>64)return json({error:'广告账户编号不能为空且不超过64字'},400);
        if(!name||name.length>128)return json({error:'广告账户名称不能为空且不超过128字'},400);
        const ledger=opsAdLedger();
        const state=allOpsAdAccountState();
        const bucket=state[opsPersonId]&&typeof state[opsPersonId]==='object'?state[opsPersonId]:{};
        const created=Array.isArray(bucket.created)?[...bucket.created]:[];
        const renamed=bucket.renamed&&typeof bucket.renamed==='object'?{...bucket.renamed}:{};
        if(action==='create'){
          if(ledger.accounts.some(row=>row.code===code))return json({error:'广告账户编号已存在'},409);
          const openedOn=typeof input.openedOn==='string'&&input.openedOn.trim()?input.openedOn.trim():today;
          if(!/^\d{4}-\d{2}-\d{2}$/.test(openedOn)||openedOn>today)return json({error:'期初日期无效或晚于今日'},400);
          const rawOpening=input.openingUsd===undefined||input.openingUsd===null||String(input.openingUsd).trim()===''?'0.00':String(input.openingUsd).trim();
          if(!/^\d+(\.\d{1,2})?$/.test(rawOpening))return json({error:'期初余额必须为非负数字（最多两位小数）'},400);
          const openingUsd=Number(rawOpening).toFixed(2);
          created.push({code,name,opened_on:openedOn,opening_usd:openingUsd,topped_usd:'0.00',spent_usd:'0.00',balance_usd:openingUsd});
        }else{
          if(!ledger.accounts.some(row=>row.code===code))return json({error:'广告账户不存在'},404);
          renamed[code]=name;
        }
        state[opsPersonId]={created,renamed};
        window.sessionStorage.setItem(opsAdAccountKey,JSON.stringify(state));
        return json({code});
      }catch(error){return json({error:error.message||'广告户保存失败'},400);}
    }
    if(role==="admin"&&path.startsWith("/api/admin/teams")&&!["GET","HEAD"].includes(method)){
      const body=(()=>{try{return JSON.parse(options.body||"{}");}catch{return null;}})();
      if(path==="/api/admin/teams"&&method==="POST"){
        const name=String(body?.name||"").trim();
        if(!name||name.length>64)return json({error:"小组名称无效"},400);
        if(teams.some((team)=>team.name===name))return json({error:"已有同名小组"},409);
        const team={id:"demo-team-"+Date.now().toString(36),name};
        teams.push(team);saveAdminTeams();return json({team},201);
      }
      const teamMatch=path.match(/^\/api\/admin\/teams\/([^/]+)$/);
      if(!teamMatch)return json({error:"不支持此操作"},405);
      const id=decodeURIComponent(teamMatch[1]);
      const team=teams.find((item)=>item.id===id);
      if(!team)return json({error:"小组不存在"},404);
      if(method==="PATCH"){
        const name=String(body?.name||"").trim();
        if(!name||name.length>64)return json({error:"小组名称无效"},400);
        if(teams.some((item)=>item.id!==id&&item.name===name))return json({error:"已有同名小组"},409);
        team.name=name;
        accounts.forEach((account)=>{if(account.teamId===id)account.teamName=name;});
        assetUsers.forEach((user)=>{if(user.currentTeam&&user.currentTeam.id===id)user.currentTeam.name=name;});
        saveAdminTeams();return json({team:{id,name}});
      }
      if(method==="DELETE"){
        const accountCount=accounts.filter((account)=>account.teamId===id).length;
        const supervisorCount=staff.filter((person)=>(person.managedTeamIds||[]).includes(id)).length;
        const parts=[];
        if(accountCount)parts.push(accountCount+" 个接待账号");
        if(supervisorCount)parts.push(supervisorCount+" 名主管");
        if(parts.length)return json({error:"这个小组还有"+parts.join("、")+"，不能删除。可以改名。"},409);
        teams.splice(teams.findIndex((item)=>item.id===id),1);saveAdminTeams();return json({ok:true});
      }
      return json({error:"不支持此操作"},405);
    }
    const bindingPath=path.match(/^\/api\/cs-device-bindings(?:\/([^/]+)\/(approve|unbind))?$/);
    if(bindingPath){
      if(role!=="cs_supervisor")return json({error:"仅客服主管可管理演示绑定"},403);
      const key="cms-demo-device-bindings-v1";
      const roster=(currentDirectory()?.accounts || visibleAccounts()).filter(a=>a.isActive!==false);
      const sample=roster[0];
      let bindings;
      try { bindings=JSON.parse(window.sessionStorage.getItem(key)||"null"); } catch {}
      bindings=bindings || (sample?[{id:"demo-phone-request",accountId:sample.id,label:"演示工作手机",employeeName:"演示客服",state:"pending"}]:[]);
      if(method==="GET")return json({bindings:bindings.filter(row=>roster.some(a=>a.id===row.accountId))});
      const [,accountId,action]=bindingPath;
      if(method==="POST"&&roster.some(a=>a.id===accountId)){
        if(action==="approve"){
          let body;
          try { body=JSON.parse(options.body||"{}"); } catch { return json({error:"演示输入无效"},400); }
          const row=bindings.find(row=>row.id===body?.bindingId&&row.accountId===accountId&&row.state==="pending");
          if(!row)return json({error:"申请已处理"},409);
          row.state="approved";
        }else if(action==="unbind")bindings=bindings.filter(row=>row.accountId!==accountId);
        window.sessionStorage.setItem(key,JSON.stringify(bindings));
        return json({ok:true});
      }
      return json({error:"接待号不在可操作范围"},403);
    }
    if(path==="/api/cs-logins"){
      if(role!=="cs_supervisor")return json({error:"仅客服主管可开通本组客服登录"},403);
      const key="cms-demo-cs-logins";
      let saved=[];
      try{saved=JSON.parse(window.sessionStorage.getItem(key)||"[]");}catch{saved=[];}
      if(!Array.isArray(saved))saved=[];
      const managed=visibleTeams();
      if(!window.sessionStorage.getItem(key)&&managed[0]) saved=Array.from({length:4},(_,i)=>({
        id:"demo-staff-"+i,username:"demo_cs_"+(i+1),displayName:"演示客服"+["甲","乙","丙","丁"][i],
        teamId:managed[0].id,teamName:managed[0].name,isActive:true,mustChangePassword:i===0
      }));
      const visible=saved.filter((user)=>managed.some((team)=>team.id===user.teamId));
      if(method==="GET"||method==="HEAD")return json({teams:managed,users:visible});
      if(method==="POST"){
        const username=String(body?.username||"").trim().toLowerCase();
        const displayName=String(body?.displayName||"").trim();
        const password=String(body?.password||"");
        const teamId=String(body?.teamIds?.[0]||body?.teamId||"");
        if(!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username))return json({error:"登录名须为 3-32 位小写字母、数字、下划线或短横线"},400);
        if(!displayName||displayName.length>64)return json({error:"姓名无效"},400);
        if(password.length<10||password.length>128||/\s/.test(password)||!/[A-Za-z]/.test(password)||!/\d/.test(password)||password.toLowerCase().includes(username))return json({error:"密码须为 10 到 128 位，同时包含字母和数字，且不能包含登录名"},400);
        const team=managed.find((item)=>item.id===teamId);
        if(!team)return json({error:"请选择你负责的小组"},400);
        if(saved.some((user)=>user.username===username))return json({error:"登录名已被使用，请更换"},409);
        const user={id:"demo-cs-login-"+Date.now(),username,displayName,teamId:team.id,teamName:team.name,isActive:true,mustChangePassword:true};
        saved.push(user);
        window.sessionStorage.setItem(key,JSON.stringify(saved));
        return json({user:{id:user.id,username,displayName,mustChangePassword:true}},201);
      }
    }
    if(!["GET","HEAD"].includes(method))return json({error:"这是公开只读演示，不保存任何修改。请在正式后台操作。"},403);
    if(path==='/api/demo/service-directory')return ['cs','cs_supervisor'].includes(role)?json(currentDirectory()||{enabled:false}):json({error:'当前身份不能查看接待账号名册'},403);
    if(path==='/api/demo/report-history')return reportHistory(q);
    if(path==="/api/assessment/foundation"){if(!window.CmsAssessmentFoundation)return json({error:"考核数据基础未加载"},503);const view=window.CmsAssessmentFoundation.present({role,today,accounts:visibleAccounts().map((a)=>({id:a.id,holderName:a.holderName,teamId:a.teamId,teamName:a.teamName})),orders:orders.filter((o)=>o.dealChannel!=='private').map((o)=>({id:o.id,accountId:o.userId,businessDate:o.businessDate,customerLabel:o.customerLabel,cancelled:!!o.cancelled,status:o.status}))});if(view&&role==='ops'){view.invalid=[];view.sourceAds=[];view.note="广告户与客资来源的负责关系待补，暂不计算个人范围的无效粉汇总。";}if(view)view.privateSales=orders.filter((o)=>o.dealChannel==='private').map((o)=>({id:o.id,businessDate:o.businessDate,operatorName:o.operatorName||'',customerLabel:o.customerLabel,amount:bookingAmount(o),cancelled:!!o.cancelled}));return view?json(view):json({error:"当前身份不能查看考核数据基础"},403);}
    if(path==="/api/modules")return json({version:1,modules:{fans:true,ops:true,editor:true,orders:true},labels:{fans:"客服加粉",ops:"运营投放",editor:"拍剪",orders:"订单"}});
    if(role==='warehouse')return json({error:'Warehouse access is limited to settlement bills'},403);
    if(role==='cs'&&path!=="/api/cs-accounts")return json({error:"客服填报演示仅提供虚构账号选择与本页试填，不开放管理数据"},403);
    if(role==='editor')return json({error:"拍剪填报演示仅提供预置姓名选择与本页试填，不开放管理数据"},403);
    if(path==='/api/demo/boss-overview')return role==='boss'?bossOverview(q):json({error:'仅BOSS可查看演示经营总览'},403);
    if(path==='/api/demo/ops-analysis'){
      if(!['boss','ops'].includes(role))return json({error:'仅BOSS与运营可查看演示投放分析'},403);
      if(!window.CmsOpsAnalysis)return json({error:'独立演示投放指标未加载'},503);
      try{
        const people=window.CmsOpsWorkspace?.people||[{id:'demo-ops',name:identityNames.ops}];
        const rows=role==='ops'?ownOps():ops.map(row=>({...row,operatorName:people[Math.max(0,['A','B','C','D'].indexOf(row.personaName.slice(-1)))%people.length].name}));
        return json(window.CmsOpsAnalysis.build({rows,rates:demoFxRates},Object.fromEntries(q),{today}));
      }catch{return json({error:'投放分析日期或维度无效'},400);}
    }
    if(role==='ops'){
      if(path==='/api/ops-reports')return json({reports:ownOps()});
      if(path==='/api/ad-accounts')return json(opsAdLedger());
      return json({error:'运营演示仅开放本人投放日报、投放分析和广告台账'},403);
    }
    if(role==="admin"&&!/^\/api\/admin(\/|$)/.test(path))return json({error:"演示管理员仅管理系统；接待账号由本组客服主管管理"},403);
    if(/^\/api\/salaries(\/|$)/.test(path))return ["finance","boss"].includes(role)?salaryApi(path,q):json({error:"仅财务与BOSS可查看工资"},403);
    if(/^\/api\/finance\/payables\/[^/]+\/attachments$/.test(path))return ['boss','finance'].includes(role)&&payables().expenses.some(e=>path.includes('/'+e.id+'/'))?json({attachments:[]}):json({error:'无公司成本权限'},403);
    if(path==='/api/finance/payables')return ['boss','finance'].includes(role)?json(payables()):json({error:'无公司付款权限'},403);
    if(path==='/api/ad-accounts')return ['boss','finance'].includes(role)?json(adLedger):json({error:'无广告账户权限'},403);
    if(path==="/api/finance/live-performance")return ['boss','finance'].includes(role)?json({records:paidPerformanceRecords}):json({error:'无财务核定权限'},403);
    if(role==='finance'&&path!=='/api/finance'&&path!=='/api/orders'&&!path.startsWith('/api/order-records/'))return json({error:"演示财务仅可查看收款、结算与工资"},403);
    if(path==="/api/finance"&&["finance","boss"].includes(role))return json({payments,settlements,summary:{pending:{CNY:"0.00",TWD:"1200.00",USD:"90.00",SGD:"0.00",HKD:"0.00"},directCny:"1290.50",settledCny:"323.40",totalCny:"1613.90"}});
    if(path.startsWith("/api/order-records/")&&["boss","cs_supervisor","finance"].includes(role)){const id=path.slice("/api/order-records/".length);const order=visibleOrders().find(o=>o.id===id);return order?json(orderRecord(order)):json({error:"订单不存在或不在演示可见范围"},404);}
    if(path==="/api/admin/users"&&role==="admin")return json({users:staff});
    if(path==="/api/admin/teams"&&role==="admin")return json({teams});
    if(path==="/api/admin/settings"&&role==="admin")return json({settings:{fan_report_backfill_days:"3"}});
    if(path==="/api/cs-accounts")return json({accounts:currentDirectory()&&['cs','cs_supervisor','admin'].includes(role)?currentDirectory().accounts:visibleAccounts()});
    if(path==="/api/cs-accounts/teams")return json({teams:window.CmsServiceDirectory&&['cs','cs_supervisor','admin'].includes(role)?[{id:window.CmsServiceDirectory.team.id,name:window.CmsServiceDirectory.team.name}]:visibleTeams()});
    if(path==='/api/fan-leads'&&['boss','cs_supervisor'].includes(role))return json(leadDemo(q));
    if(/^\/api\/fan-leads\/[^/]+\/history$/.test(path)&&['boss','cs_supervisor'].includes(role)){const id=path.split('/')[3],l=leadFixtures.find(l=>l.id===id&&visibleAccounts().some(a=>a.id===l.accountId));return l?json({history:[{created_at:l.receivedOn+'T02:00:00Z',actor_name:l.operatorName,action:'fan_lead_create',after_data:{qualified_on:l.qualifiedOn,need_summary:l.needSummary}}]}):json({error:'线索不在演示可见范围'},403);}
    if(path==="/api/fan-reports/period-summary"){
      if(role!=="cs_supervisor"||!["GET","HEAD"].includes(method))return json({error:"仅客服主管可查看本组加粉汇总"},403);
      const from=q.get("from"),to=q.get("to"),span=(Date.parse(to)-Date.parse(from))/86400000;
      if(!Number.isInteger(span)||span<0||span>366||to>today||shift(from,0)!==from||shift(to,0)!==to)return json({error:"日期范围无效"},400);
      const accountIds=new Set(visibleAccounts().map(account=>account.id));
      const rows=fans.filter(row=>accountIds.has(row.userId)&&row.businessDate>=from&&row.businessDate<=to);
      return json({from,to,totalAdded:rows.length?sum(rows,"addedCount"):null});
    }
    if(path==="/api/fan-reports/summary"&&role!=="admin")return json(fanSummary(q));
    if(path==="/api/fan-reports/export"&&role!=="admin")return new Response("\uFEFF"+[csv(["业务日","小组","客服接待账号","加粉数","状态"]),...fanSummary(q).teams.flatMap((team)=>team.details.map((d)=>csv([q.get("date")||today,team.teamName,d.wechatId,d.addedCount,d.status])))].join("\n"),{headers:{"Content-Type":"text/csv;charset=utf-8"}});
    if(q.has("reviewStatus"))return json({error:"审核筛选已停用"},400);
    if(path==="/api/orders"&&role!=="admin"){const rows=filteredOrders(q).map(o=>({...o,bookingAmount:bookingAmount(o)})),valid=rows.filter(r=>!r.cancelled&&r.status!=="refunded");return json({orders:rows,totals:{amount:sumMoney(rows,"amount"),refunds:sumMoney(rows.filter((r)=>r.status==="refunded"&&!r.cancelled),"amount"),cancelled:sumMoney(rows.filter(r=>r.cancelled),"amount"),turnover:sumMoney(valid,"bookingAmount"),turnoverCount:valid.length}});}
    if(role==="boss"){
      if(path==="/api/demo/cash-order-balances")return cashOrderBalances(q);
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
      document.querySelectorAll("form").forEach((form)=>{if(form.querySelector("#password")||form.matches(".account-editor form,.ops-feedback-form,.ops-ad-account-form,.editor-daily-form,.daily-operating-form,.so-note-form,.warehouse-form,.reimbursement-form,.admin-team-form,.admin-team-edit,.cs-login-form"))return;form.querySelectorAll('button[type="submit"],button:not([type])').forEach((button)=>{if(!button.textContent.includes("查询")){button.disabled=true;button.title="公开只读演示，不保存修改";}});});
      document.querySelectorAll('#root select[aria-label$="角色"]').forEach((select)=>{select.disabled=true;});
      document.querySelectorAll("button").forEach((button)=>{if(/^(确认重新发码|停用|启用|停用账号|启用账号)$/.test(button.textContent.trim())){button.disabled=true;button.title="公开只读演示，不保存修改";}});
    };
    new MutationObserver(disableWrites).observe(document.getElementById("root"),{childList:true,subtree:true});
    disableWrites();
  });
})();

(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CmsBossPriority=api;})(typeof window!=='undefined'?window:globalThis,function(){
  const categories={rent:'房租',utilities:'水电',salary:'员工工资',hospitality:'接待费用',other:'其他费用'};
  const MATERIAL_CATEGORIES=new Set(['goods','sourcing','material']);
  const DEFAULT_FX={CNY:1,USD:7.24,TWD:0.2235,SGD:5.38,HKD:0.93};
  const cents=value=>{if(!/^\d+(?:\.\d{1,2})?$/.test(String(value)))throw Error('人民币金额待核对');const[a,b='']=String(value).split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
  const signedMoney=value=>{const sign=value<0n?'-':'';const abs=value<0n?-value:value;return `${sign}${abs/100n}.${String(abs%100n).padStart(2,'0')}`;};
  const money=signedMoney;
  const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const daysBetween=(from,to)=>{
    const count=Math.max(1,Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000)+1);
    return Array.from({length:count},(_,index)=>shift(from,index));
  };
  const ratioPercent=(numerator,denominator)=>denominator<=0n?0:Number((numerator*1000n)/denominator)/10;
  function convertToCnyCents(amountText,currency='CNY',fxRate=null){
    const raw=cents(amountText||'0.00');
    if(currency==='CNY')return raw;
    const rate=fxRate!=null&&Number(fxRate)>0?Number(fxRate):(DEFAULT_FX[currency]??1);
    return BigInt(Math.round(Number(raw)*rate));
  }
  function allocateByWeight(totalCents,weights){
    if(!weights.length)return [];
    const totalWeight=weights.reduce((s,w)=>s+(w>0n?w:0n),0n);
    if(totalCents===0n||totalWeight<=0n)return weights.map(()=>0n);
    const out=weights.map(w=>w>0n?(totalCents*w)/totalWeight:0n);
    const rem=totalCents-out.reduce((s,v)=>s+v,0n);
    if(rem!==0n){
      let maxIdx=0;
      for(let i=1;i<weights.length;i++)if(weights[i]>weights[maxIdx])maxIdx=i;
      out[maxIdx]+=rem;
    }
    return out;
  }

  function build({from,to,orders=[],people=[],fans=[],expenses=[],charges=[],orderExpenses=[],settlementFees=[],adSpends=[],reimbursements=[],payroll=null,attention=null,fxUsdRate=7.24}){
    const inside=date=>date>=from&&date<=to;
    const trendFrom=from===to?shift(to,-6):from;
    const validWindow=orders.filter(row=>row.date>=trendFrom&&row.date<=to&&!row.cancelled&&row.status!=='refunded');
    const valid=validWindow.filter(row=>inside(row.date));
    const amount=rows=>rows.reduce((n,row)=>n+cents(row.amount),0n);
    const stats=rows=>{
      const live=amount(rows.filter(row=>row.channel!=='private'));
      const privateAmount=amount(rows.filter(row=>row.channel==='private'));
      const total=live+privateAmount;
      return{live:money(live),private:money(privateAmount),total:money(total),count:rows.length,privateShare:total>0n?Number(privateAmount*10000n/total)/100:null};
    };

    // Material expenses per order fallback
    const orderMatExpMap=new Map();
    for(const exp of orderExpenses){
      if(!exp||exp.voided||!MATERIAL_CATEGORIES.has(exp.category))continue;
      orderMatExpMap.set(exp.orderId,(orderMatExpMap.get(exp.orderId)||0n)+cents(exp.amount));
    }
    const materialCostForOrder=order=>{
      if(order.materialCost!=null&&order.materialCost!=='')return{cents:cents(order.materialCost),missing:false};
      const fb=orderMatExpMap.get(order.id);
      if(fb!=null&&fb>0n)return{cents:fb,missing:false};
      return{cents:0n,missing:true};
    };

    const validOrderIdSet=new Set(orders.filter(row=>!row.cancelled&&row.status!=='refunded').map(o=>o.id));
    const validAfterSaleExps=orderExpenses.filter(exp=>exp&&!exp.voided&&!MATERIAL_CATEGORIES.has(exp.category)&&(!exp.orderId||validOrderIdSet.has(exp.orderId)));

    const perfStats=stats(valid);
    const turnoverCents=cents(perfStats.total);
    const avgOrderCents=valid.length>0?turnoverCents/BigInt(valid.length):0n;
    const afterSalesCents=charges.filter(c=>c&&!c.voided&&inside(c.date)&&(!c.orderId||validOrderIdSet.has(c.orderId))).reduce((s,c)=>s+cents(c.amount),0n);

    let materialCostCents=0n,missingMaterialCostCount=0;
    for(const o of valid){
      const mc=materialCostForOrder(o);
      materialCostCents+=mc.cents;
      if(mc.missing)missingMaterialCostCount+=1;
    }

    const afterSaleCostCents=validAfterSaleExps.filter(e=>inside(e.date)).reduce((s,e)=>s+cents(e.amount),0n);
    const thirdPartyFeeCents=settlementFees.filter(f=>f&&!f.voided&&inside(f.date)).reduce((s,f)=>s+convertToCnyCents(f.amount,f.currency||'CNY',f.fxRate),0n);
    const adSpendUsdCents=adSpends.filter(a=>a&&inside(a.date)&&a.spendUsd!=null).reduce((s,a)=>s+cents(a.spendUsd),0n);
    const adSpendCnyCents=BigInt(Math.round(Number(adSpendUsdCents)*(Number(fxUsdRate)||7.24)));

    const grossProfitCents=turnoverCents-materialCostCents-afterSaleCostCents-thirdPartyFeeCents-adSpendCnyCents;
    const grossMargin=ratioPercent(grossProfitCents,turnoverCents);

    const members=people.map(person=>{
      const rows=valid.filter(row=>row.employeeId===person.id);
      const daily=fans.filter(row=>row.employeeId===person.id&&inside(row.date));
      return {...person,...stats(rows),fans:daily.length?daily.reduce((n,row)=>n+row.total,0):null,effective:daily.length&&daily.every(row=>row.effective!==null)?daily.reduce((n,row)=>n+row.effective,0):null,invalid:daily.length&&daily.every(row=>row.invalid!==null)?daily.reduce((n,row)=>n+row.invalid,0):null,pendingInvalid:daily.reduce((n,row)=>n+(row.pendingInvalid||0),0)};
    });
    const rooms=[{id:'overseas-one',name:'一号直播间',team:'秋菊组',status:'ready'},{id:'overseas-two',name:'二号直播间',team:null,status:'pending'},{id:'unassigned',name:'归属待核对',team:null,status:'unassigned'}].map(room=>({...room,...stats(valid.filter(row=>(row.room||'unassigned')===room.id)),members:members.filter(person=>(person.room||'unassigned')===room.id)}));

    const expenseRows=expenses.filter(row=>inside(row.date)&&!row.voided);
    const costs=Object.entries(categories).map(([key,label])=>{const rows=expenseRows.filter(row=>row.category===key);return{key,label,amount:rows.length?money(rows.reduce((n,row)=>n+cents(row.amount),0n)):null,count:rows.length,status:key==='salary'?'pending_payroll':rows.length?'registered':'unreported'};});
    const dailyTotalCents=expenseRows.reduce((n,row)=>n+cents(row.amount),0n);
    const periodReims=reimbursements.filter(r=>r&&r.status==='approved'&&!r.postedExpenseId&&inside(r.date));
    const reimTotalCents=periodReims.reduce((n,r)=>n+cents(r.amount),0n);
    const payrollLocked=Boolean(payroll&&payroll.status==='ready'&&payroll.amount!=null);
    const payrollTotalCents=payrollLocked?cents(payroll.amount):0n;
    const recordedSubtotalCents=dailyTotalCents+reimTotalCents+payrollTotalCents;

    const estimatedNetProfitCents=grossProfitCents-recordedSubtotalCents;
    const netMargin=ratioPercent(estimatedNetProfitCents,turnoverCents);

    const periodFans=fans.filter(f=>inside(f.date));
    const totalFansCount=periodFans.reduce((s,f)=>s+(f.total||0),0);
    const hasEffective=periodFans.some(f=>f.effective!=null);
    const effectiveFansCount=periodFans.reduce((s,f)=>s+(f.effective||0),0);
    const costPerEffectiveFanCny=hasEffective&&effectiveFansCount>0?money(adSpendCnyCents/BigInt(effectiveFansCount)):null;

    // Channel profits
    const orderById=new Map(valid.map(o=>[o.id,o]));
    const channelMap=new Map();
    const roomLabel=id=>id==='overseas-one'?'一号直播间':id==='overseas-two'?'二号直播间':'归属待核对';
    for(const o of valid){
      const isPrivate=o.channel==='private';
      const key=isPrivate?'__private__':(o.room||'unassigned');
      const name=isPrivate?'客服私推渠道':roomLabel(key);
      const b=channelMap.get(key)||{id:key,name,roomCode:isPrivate?'':key,isPrivate,count:0,turnoverCents:0n,materialCostCents:0n,afterSaleCostCents:0n};
      b.count+=1;
      b.turnoverCents+=cents(o.amount);
      b.materialCostCents+=materialCostForOrder(o).cents;
      channelMap.set(key,b);
    }
    for(const exp of validAfterSaleExps.filter(e=>inside(e.date))){
      const o=exp.orderId?orderById.get(exp.orderId):null;
      const isPrivate=(exp.channel||o?.channel)==='private';
      const key=isPrivate?'__private__':(exp.room||o?.room||'unassigned');
      const name=isPrivate?'客服私推渠道':roomLabel(key);
      const b=channelMap.get(key)||{id:key,name,roomCode:isPrivate?'':key,isPrivate,count:0,turnoverCents:0n,materialCostCents:0n,afterSaleCostCents:0n};
      b.afterSaleCostCents+=cents(exp.amount);
      channelMap.set(key,b);
    }
    const channelBuckets=[...channelMap.values()].sort((a,b)=>{
      if(a.isPrivate!==b.isPrivate)return a.isPrivate?1:-1;
      return Number(b.turnoverCents-a.turnoverCents);
    });
    const weights=channelBuckets.map(b=>b.turnoverCents);
    const allocAds=allocateByWeight(adSpendCnyCents,weights);
    const allocFees=allocateByWeight(thirdPartyFeeCents,weights);
    const channelProfits=channelBuckets.map((b,idx)=>{
      const matAfter=b.materialCostCents+b.afterSaleCostCents;
      const adCents=allocAds[idx]||0n;
      const feeCents=allocFees[idx]||0n;
      const gpCents=b.turnoverCents-matAfter-feeCents-adCents;
      return{
        id:b.id,
        name:b.name,
        roomCode:b.roomCode,
        isPrivate:b.isPrivate,
        count:b.count,
        turnover:money(b.turnoverCents),
        materialAndAfterSale:money(matAfter),
        thirdPartyFee:money(feeCents),
        adSpendCny:money(adCents),
        grossProfit:money(gpCents),
        grossMargin:ratioPercent(gpCents,b.turnoverCents)
      };
    });

    const days=daysBetween(from,to).map(date=>({
      date,
      total:orders.some(row=>row.date===date)?stats(valid.filter(row=>row.date===date)).total:null,
      operatingCost:null
    }));

    const trend=daysBetween(trendFrom,to).map(date=>{
      const hasAnyOrder=orders.some(row=>row.date===date);
      const dayValid=validWindow.filter(row=>row.date===date);
      const dTurnover=dayValid.reduce((s,r)=>s+cents(r.amount),0n);
      const dMat=dayValid.reduce((s,r)=>s+materialCostForOrder(r).cents,0n);
      const dAfter=validAfterSaleExps.filter(e=>e.date===date).reduce((s,e)=>s+cents(e.amount),0n);
      const dFee=settlementFees.filter(f=>f&&!f.voided&&f.date===date).reduce((s,f)=>s+convertToCnyCents(f.amount,f.currency||'CNY',f.fxRate),0n);
      const dAdUsd=adSpends.filter(a=>a&&a.date===date&&a.spendUsd!=null).reduce((s,a)=>s+cents(a.spendUsd),0n);
      const dAdCny=BigInt(Math.round(Number(dAdUsd)*(Number(fxUsdRate)||7.24)));
      const dDaily=expenses.filter(row=>!row.voided&&row.date===date).reduce((s,r)=>s+cents(r.amount),0n);
      const dReim=reimbursements.filter(r=>r&&r.status==='approved'&&!r.postedExpenseId&&r.date===date).reduce((s,r)=>s+cents(r.amount),0n);
      const dOp=dDaily+dReim;
      const hasActivity=hasAnyOrder||dAdUsd>0n||dAfter>0n||dFee>0n;
      return{
        date,
        total:hasAnyOrder?money(dTurnover):null,
        grossProfit:hasActivity?money(dTurnover-dMat-dAfter-dFee-dAdCny):null,
        adSpendCny:dAdUsd>0n?money(dAdCny):(hasActivity?'0.00':null),
        adSpendUsd:dAdUsd>0n?money(dAdUsd):null,
        operatingCost:(dDaily>0n||dReim>0n||hasActivity)?money(dOp):null
      };
    });

    return {
      version:'boss-priority/v1',
      period:{from,to},
      performance:{...perfStats,afterSales:money(afterSalesCents),avgOrder:money(avgOrderCents)},
      grossProfit:{
        amount:money(grossProfitCents),
        margin:grossMargin,
        materialCost:money(materialCostCents),
        afterSaleCost:money(afterSaleCostCents),
        thirdPartyFee:money(thirdPartyFeeCents),
        adSpendUsd:money(adSpendUsdCents),
        adSpendCny:money(adSpendCnyCents),
        missingMaterialCostCount
      },
      acquisition:{
        totalFans:totalFansCount,
        effectiveFans:hasEffective?effectiveFansCount:null,
        costPerEffectiveFanCny
      },
      structure:{
        estimatedNetProfit:money(estimatedNetProfitCents),
        netMargin,
        includesPayroll:payrollLocked,
        items:[
          {key:'material',label:'料子本钱',amount:money(materialCostCents),ratio:ratioPercent(materialCostCents,turnoverCents)},
          {key:'afterSaleAndFee',label:'售后与扣点',amount:money(afterSaleCostCents+thirdPartyFeeCents),ratio:ratioPercent(afterSaleCostCents+thirdPartyFeeCents,turnoverCents)},
          {key:'ads',label:'投流成本',amount:money(adSpendCnyCents),ratio:ratioPercent(adSpendCnyCents,turnoverCents)},
          {key:'operating',label:'已录运营成本',amount:money(recordedSubtotalCents),ratio:ratioPercent(recordedSubtotalCents,turnoverCents)},
          {key:'netProfit',label:'预估净利',amount:money(estimatedNetProfitCents),ratio:netMargin}
        ]
      },
      attention:{
        pendingPaymentVerifications:attention?.pendingPaymentVerifications??0,
        missingMaterialCostOrders:missingMaterialCostCount,
        pendingExpensesAndWarehouse:attention?.pendingExpensesAndWarehouse??0
      },
      days,
      trend,
      rooms:rooms.filter(room=>room.id!=='unassigned'||room.count||room.members.length),
      channelProfits,
      expenses:{
        registered:expenseRows.length?money(dailyTotalCents):null,
        recordedSubtotal:money(recordedSubtotalCents),
        dailyTotal:money(dailyTotalCents),
        approvedReimbursements:money(reimTotalCents),
        approvedReimbursementCount:periodReims.length,
        payrollTotal:payrollLocked?money(payrollTotalCents):null,
        payrollStatus:payrollLocked?'ready':'pending_payroll',
        status:payrollLocked?'ready':'incomplete',
        categories:costs,
        records:expenseRows
      },
      definitions:{
        performance:'直播间料价＋代购费，加客服私推料价；未付款开单计入，跑单和退款源单排除，售后追加另列。',
        grossProfit:'计算公式：有效业绩 - 料子本钱（白条价/库房结算价） - 售后公司成本 - 第三方扣点 - 投流成本（折合人民币）。',
        fans:'加粉及有效粉按业务日日报汇总；无效粉仅计主管已确认的客资，缺少复核明细显示待复核，不按零处理。',
        expenses:'公司运营成本包含日常运营（房租/水电/招待/其他）、已核报销（含直播间费用，不含已计入订单成本的业务垫付）与固定薪资；工资未核算时仍展示已登记运营开支并标注「工资待核」。'
      }
    };
  }

  function expense(input,today,actor,id){
    if(!['rent','utilities','hospitality','other'].includes(input.category))throw Error('工资由工资核算汇总，广告和业务费用不在此登记');
    const date=String(input.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>today)throw Error('费用日期无效');
    const amount=money(cents(input.amount));if(cents(amount)<=0n||cents(amount)>99999999999n)throw Error('请填写有效正数金额');
    const purpose=String(input.purpose||'').trim(),operator=String(input.operator||'').trim(),proof=String(input.proof||'').trim();if(!purpose||purpose.length>300||!operator||operator.length>64||proof.length>200)throw Error('请核对用途、经办人和凭证编号');
    return{id,category:input.category,date,amount,purpose,operator,proof,actor,createdAt:new Date().toISOString(),voided:false};
  }
  return{build,expense,categories};
});

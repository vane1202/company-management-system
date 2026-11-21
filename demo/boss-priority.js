(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CmsBossPriority=api;})(typeof window!=='undefined'?window:globalThis,function(){
  const categories={rent:'房租',utilities:'水电',salary:'员工工资',hospitality:'接待费用',other:'其他费用'};
  const cents=value=>{if(!/^\d+(?:\.\d{1,2})?$/.test(String(value)))throw Error('人民币金额待核对');const[a,b='']=String(value).split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
  const money=value=>`${value/100n}.${String(value%100n).padStart(2,'0')}`;
  function build({from,to,orders,people=[],fans=[],expenses=[]}){
    const inside=date=>date>=from&&date<=to;
    const valid=orders.filter(row=>inside(row.date)&&!row.cancelled&&row.status!=='refunded');
    const amount=rows=>rows.reduce((n,row)=>n+cents(row.amount),0n);
    const stats=rows=>{const live=amount(rows.filter(row=>row.channel!=='private')),privateAmount=amount(rows.filter(row=>row.channel==='private')),total=live+privateAmount;return{live:money(live),private:money(privateAmount),total:money(total),count:rows.length,privateShare:total>0n?Number(privateAmount*10000n/total)/100:null};};
    const members=people.map(person=>{
      const rows=valid.filter(row=>row.employeeId===person.id);
      const daily=fans.filter(row=>row.employeeId===person.id&&inside(row.date));
      return {...person,...stats(rows),fans:daily.length?daily.reduce((n,row)=>n+row.total,0):null,effective:daily.length&&daily.every(row=>row.effective!==null)?daily.reduce((n,row)=>n+row.effective,0):null,invalid:daily.length&&daily.every(row=>row.invalid!==null)?daily.reduce((n,row)=>n+row.invalid,0):null,pendingInvalid:daily.reduce((n,row)=>n+(row.pendingInvalid||0),0)};
    });
    const rooms=[{id:'overseas-one',name:'一号直播间',team:'秋菊组',status:'ready'},{id:'overseas-two',name:'二号直播间',team:null,status:'pending'},{id:'unassigned',name:'归属待核对',team:null,status:'unassigned'}].map(room=>({...room,...stats(valid.filter(row=>(row.room||'unassigned')===room.id)),members:members.filter(person=>(person.room||'unassigned')===room.id)}));
    const expenseRows=expenses.filter(row=>inside(row.date)&&!row.voided);
    const costs=Object.entries(categories).map(([key,label])=>{const rows=expenseRows.filter(row=>row.category===key);return{key,label,amount:rows.length?money(rows.reduce((n,row)=>n+cents(row.amount),0n)):null,count:rows.length,status:key==='salary'?'pending_payroll':rows.length?'registered':'unreported'};});
    const registered=expenseRows.reduce((n,row)=>n+cents(row.amount),0n);
    const days=Array.from({length:Math.round((Date.parse(to)-Date.parse(from))/86400000)+1},(_,index)=>{
      const date=new Date(Date.parse(from+'T00:00:00Z')+index*86400000).toISOString().slice(0,10);
      return {date,total:orders.some(row=>row.date===date)?stats(valid.filter(row=>row.date===date)).total:null,operatingCost:null};
    });
    return {version:'boss-priority/v1',period:{from,to},performance:stats(valid),days,rooms:rooms.filter(room=>room.id!=='unassigned'||room.count||room.members.length),expenses:{registered:expenseRows.length?money(registered):null,status:'incomplete',categories:costs,records:expenseRows},definitions:{performance:'直播间料价＋代购费，加客服私推料价；未付款开单计入，跑单和退款源单排除，追加收费另列。',fans:'加粉及有效粉按业务日日报汇总；无效粉仅计主管已确认的客资，缺少复核明细显示待复核，不按零处理。',expenses:'日常运营费用包括房租、水电、工资、接待和其他；广告消耗留在运营数据，商品、加工和发货留在业务费用。工资待财务核算，当前仅展示已登记费用，不声称完整总费用。'}};
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

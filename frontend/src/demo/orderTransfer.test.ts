import {describe,it,expect} from 'vitest';
import {createSeed,reduceCrm,orderFunds,effectiveOrderCents,personalPerformance,validOrderCount,type CrmActor,type CrmOrderDraft} from './customerCrm';

const today='2026-11-18';
const actor:CrmActor={role:'cs',employeeId:'demo-cs-a',employeeName:'演示客服甲',teamIds:['demo-team-a']};
const draft:CrmOrderDraft={businessDate:'2026-11-16',channel:'live',materialCny:'1800',feeCny:'180',materialRef:'NEW-16'};
const proofUrl='data:image/png;base64,iVBORw0KGgo=';
function original(currency:'CNY'|'TWD'|'USD'='CNY'){
  let state=createSeed(today); state={...state,orders:[]};
  state=reduceCrm(state,{type:'addOrder',actor,customerId:'sample-dealt',businessDate:'2026-11-15',channel:'live',materialCny:'980',feeCny:'98',customerCurrency:currency,customerDue:currency==='TWD'?'5000':'200',materialRef:'OLD-15'},today);
  return reduceCrm(state,{type:'recordReceipt',actor,orderId:state.orders[0].id,date:'2026-11-15',amount:currency==='TWD'?'1000':'100',purpose:'deposit',channel:'账户A',reference:'PAY-DEPOSIT',proofUrl},today);
}
function transfer(state=original(),patch:Partial<CrmOrderDraft>={}){return reduceCrm(state,{type:'transferOrder',actor,orderId:state.orders[0].id,draft:{...draft,...patch},reason:'客户改选另一块料子'},today);}
describe('跨日换料与定金转单',()=>{
  it('保留15日开单原价与定金，旧单业绩归零，新单承接定金，18日尾款结清且现金仅登记一次',()=>{
    const initial=original(),state=transfer(initial),[old,next]=state.orders;
    expect(initial.orders[0].cancelled).toBe(false);
    expect(old.materialCents).toBe(98000);expect(old.materialRef).toBe('OLD-15');
    expect(effectiveOrderCents(old)).toBe(0);expect(old.replacedById).toBe(next.id);expect(next.replacesId).toBe(old.id);
    expect(old.receipts).toEqual(initial.orders[0].receipts);
    expect(orderFunds(old).balance).toBe(0);expect(orderFunds(next)).toMatchObject({carried:10000,received:0,balance:188000});
    expect(next.receipts).toEqual([]);expect(personalPerformance(state,actor.employeeId).totalCents).toBe(198000);
    expect(validOrderCount(state,'sample-dealt')).toBe(1);
    const paid=reduceCrm(state,{type:'recordReceipt',actor,orderId:next.id,date:'2026-11-18',amount:'1880',purpose:'balance',channel:'账户A',reference:'PAY-BALANCE',proofUrl},today);
    expect(orderFunds(paid.orders[1]).balance).toBe(0);
    expect(paid.orders.flatMap(row=>row.receipts??[]).reduce((n,p)=>n+p.amountMinor,0)).toBe(198000);
    expect(paid.orders.map(o=>[o.businessDate,effectiveOrderCents(o)])).toEqual([['2026-11-15',0],['2026-11-16',198000]]);
  });
  it('外币按约定应收抵扣，不重新换汇',()=>{
    const state=transfer(original('TWD'),{customerCurrency:'TWD',customerDue:'9000'});
    expect(orderFunds(state.orders[1])).toMatchObject({currency:'TWD',due:900000,carried:100000,balance:800000});
    expect(()=>transfer(original('TWD'),{customerCurrency:'USD',customerDue:'1000'})).toThrow('币种须一致');
  });
  it('重复转单、跨客服和跨组操作不能发生，失败不改变原记录',()=>{
    const state=transfer();
    expect(()=>transfer(state)).toThrow('重复操作');
    for(const other of [{...actor,employeeId:'someone-else'},{...actor,teamIds:['other-team']}]){
      expect(()=>reduceCrm(original(),{type:'transferOrder',actor:other,orderId:original().orders[0].id,draft,reason:'换料'},today)).toThrow();
    }
    expect(state.orders).toHaveLength(2);
  });
  it('新单金额不够、日期倒置、不合法日期、无原因均拒绝',()=>{
    expect(()=>transfer(original(),{materialCny:'50',feeCny:'5'})).toThrow('小于原定金');
    expect(()=>transfer(original(),{businessDate:'2026-11-14'})).toThrow('早于');
    expect(()=>transfer(original(),{businessDate:'2026-02-30'})).toThrow('日期无效');
    expect(()=>transfer(original(),{businessDate:'2026-11-19'})).toThrow('日期无效');
    expect(()=>reduceCrm(original(),{type:'transferOrder',actor,orderId:original().orders[0].id,draft,reason:''},today)).toThrow('原因');
  });
  it('没有定金、已结清、报送过尾款的订单不能直接转单',()=>{
    const state=original();
    expect(()=>transfer({...state,orders:state.orders.map(o=>({...o,receipts:[]}))})).toThrow('先登记');
    const paid=reduceCrm(state,{type:'recordReceipt',actor,orderId:state.orders[0].id,date:'2026-11-16',amount:'978',purpose:'balance',channel:'账户A',reference:'TAIL',proofUrl},today);
    expect(()=>transfer(paid)).toThrow('交财务');
    const partial=reduceCrm(state,{type:'recordReceipt',actor,orderId:state.orders[0].id,date:'2026-11-16',amount:'1',purpose:'balance',channel:'账户A',reference:'TAIL',proofUrl},today);
    expect(()=>transfer(partial)).toThrow('交财务');
  });
  it('旧单禁止再收款，尾款超收、凭证重复、无凭证或早于开单日均拒绝',()=>{
    const state=transfer(),base={type:'recordReceipt' as const,actor,orderId:state.orders[1].id,date:'2026-11-18',amount:'100',purpose:'balance' as const,channel:'账户A',reference:'TAIL',proofUrl};
    expect(()=>reduceCrm(state,{...base,orderId:state.orders[0].id},today)).toThrow('重复操作');
    expect(()=>reduceCrm(state,{...base,amount:'1880.01'},today)).toThrow('剩余应收');
    expect(()=>reduceCrm(state,{...base,reference:'PAY-DEPOSIT'},today)).toThrow('重复登记');
    expect(()=>reduceCrm(state,{...base,date:'2026-11-15'},today)).toThrow('早于');
    expect(()=>reduceCrm(state,{...base,proofUrl:''},today)).toThrow('凭证');
  });
  it('连续换料保留链路且不复制收款记录',()=>{
    const state=transfer(),next=reduceCrm(state,{type:'transferOrder',actor,orderId:state.orders[1].id,draft:{...draft,businessDate:'2026-11-17',materialCny:'2000',feeCny:'200'},reason:'再次换料'},today);
    expect(next.orders).toHaveLength(3);expect(next.orders.filter(o=>!o.cancelled)).toHaveLength(1);
    expect(orderFunds(next.orders[2])).toMatchObject({carried:10000,balance:210000});
    expect(next.orders.flatMap(o=>o.receipts??[])).toHaveLength(1);
    expect(personalPerformance(next,actor.employeeId).totalCents).toBe(220000);
  });
  it('新单应收与定金相等时直接结清，私推仍无代购费',()=>{
    const state=transfer(original(),{materialCny:'100',feeCny:'0',channel:'private'});
    expect(orderFunds(state.orders[1]).balance).toBe(0);
    expect(personalPerformance(state,actor.employeeId)).toMatchObject({liveCents:0,privateCents:10000});
  });
});

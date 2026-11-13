import { describe, expect, it, vi } from 'vitest';
import { buildOpsReference, type OpsTotals } from './opsReferenceView';
import { convertAdSpend, type FxCurrency } from './adExchangeRates';
const today='2026-11-12';
const totals=(usd:string|null,count:number,records=1):OpsTotals=>({spendUsd:usd,spendCny:'9999.00',consultCount:count,clickCount:0,consultationCostUsd:null,costStatus:!records?'empty':count?'ready':'no_consultation',recordCount:records,reportedDays:records?1:0,missingSpendCount:usd===null?1:0,missingConsultCount:0,missingClickCount:0});
const row=(amount:string,date=today,persona='A')=>({businessDate:date,spendUsd:amount,personaName:persona,platform:'Facebook',adAccountRef:'shared'});
const quote=async(date:string,currency:FxCurrency)=>({date,currency,rate:date===today?'6.500000':'7.000000',sourceDate:date,updatedAt:date+'T04:00:00Z',checkedAt:0,source:'test',delayed:false,stale:false});
describe('投放使用与首页相同的人民币参考折算',()=>{
 it('替换固定汇率金额，共享日期报价；分类、趋势、上期和加权咨询成本对应同一批日报',async()=>{
  const records=[row('10.00'),row('20.00',today,'B')],lookup=vi.fn(quote);
  const data={summary:totals('30.00',6,2),records,groups:[{...totals('10.00',4),key:'A',name:'A'},{...totals('20.00',2),key:'B',name:'B'}],comparison:{totals:totals('5.00',1),records:[row('5.00','2026-11-11')]},trend:{days:[{...totals('30.00',6,2),date:today}]}};
  const view=await buildOpsReference(data,'persona',lookup);
  expect(view.summary.spendCny).toBe('195.00');expect(view.summary.consultationCostCny).toBe('32.50');
  expect(view.groups.map(g=>g.spendCny)).toEqual(['65.00','130.00']);expect(view.days[0].spendCny).toBe('195.00');expect(view.comparison.spendCny).toBe('35.00');
  expect(lookup.mock.calls).toHaveLength(2);
  expect((await convertAdSpend(records.map(r=>({date:r.businessDate,amount:r.spendUsd})),'30.00',d=>quote(d,'USD'))).cny).toBe(view.summary.spendCny);
 });
 it('缺行情不回退固定汇率；无咨询不产生费用比率；明确零与未报区分',async()=>{
  const data={summary:totals('10.00',0),records:[row('10.00')],groups:[],comparison:{totals:totals(null,0,0),records:[]},trend:{days:[{...totals('10.00',0),date:today}]}};
  const missing=await buildOpsReference(data,'persona',async()=>null);expect(missing.summary.spendCny).toBeNull();expect(missing.summary.consultationCostCny).toBeNull();expect(missing.missing).toEqual([today]);
  const zero=await buildOpsReference({...data,summary:{...totals('0.00',2),costStatus:'ready'},records:[row('0.00')]},'persona',quote);
  expect(zero.summary.spendCny).toBe('0.00');expect(zero.summary.consultationCostCny).toBe('0.00');expect(zero.comparison.spendCny).toBeNull();
 });
});

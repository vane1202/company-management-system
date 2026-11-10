import {describe,it,expect} from 'vitest';
import {leadMetrics,leadPayload,type Lead} from '../src/lib/fanLeads.js';
const base={receivedOn:'2026-11-01',pageName:'虚构主页',operatorName:'虚构客服',channel:'ms',customerLabel:'虚构客户',contactStatus:'replied',repliedOn:'2026-11-01',qualifiedOn:'2026-11-01',needSummary:'白冰手镯，预算4000台币'};
describe('同批客户初步转化',()=>{
 it('首次明确需求需有具体摘要与有效日期，不从回复人数推算',()=>{
  expect(()=>leadPayload({...base,needSummary:''},'2026-11-10')).toThrow();
  expect(()=>leadPayload({...base,qualifiedOn:'2026-10-31'},'2026-11-10')).toThrow();
  expect(()=>leadPayload({...base,qualifiedOn:'2026-11-11'},'2026-11-10')).toThrow();
  expect(()=>leadPayload({...base,invalidReason:'误触'},'2026-11-10')).toThrow();
  expect(leadPayload({...base,lossReason:'价格不接受'},'2026-11-10').qualifiedOn).toBe('2026-11-01');
 });
 it('次日转化回归原承接批次，第七天包含、第八天排除，流失不抹除转化',()=>{
  const make=(qualifiedOn:string|null,extra:object={})=>({...base,qualifiedOn,voidedAt:null,...extra}) as Lead;
  const stats=leadMetrics([make('2026-11-01',{lossReason:'价格'}),make('2026-11-02'),make('2026-11-07'),make('2026-11-08'),make(null,{invalidReason:'垃圾信息'}),make('2026-11-01',{voidedAt:'2026-11-02'})],'2026-11-10');
  expect(stats).toMatchObject({received:5,sameDay:1,withinSeven:3,sameDayRate:20,sevenDayRate:60,invalid:1,lost:1,observing:0});
  expect(leadMetrics([],'2026-11-10').sameDayRate).toBeNull();
 });
});

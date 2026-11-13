import {describe,it,expect} from 'vitest';
import {leadStats,leadCoverage,sevenDayResult,type Lead} from './leadApi';
describe('转化汇总展示口径',()=>{
 const make=(extra:object={})=>({accountId:'a',pageName:'p',receivedOn:'2026-11-01',channel:'ms',qualifiedOn:null,voidedAt:null,...extra}) as Lead;
 it('同批分母和7日边界；汇总按人数，不平均比率',()=>{expect(leadStats([make({qualifiedOn:'2026-11-01'}),make({qualifiedOn:'2026-11-07'}),make({qualifiedOn:'2026-11-08'}),make({qualifiedOn:'2026-11-01',voidedAt:'x'})],'2026-11-10')).toMatchObject({received:3,sameDayRate:33.3,sevenDayRate:66.7});expect(leadStats([],'2026-11-10').sameDayRate).toBeNull();});
 it('日报与明细按微信、日期、主页和渠道核对，缺失明细不展示偏高转化率',()=>{const reports=[{accountId:'a',pageName:'p',businessDate:'2026-11-01',msToday:1,wsToday:0,addedCount:1}];expect(leadCoverage([make()],reports).mismatches).toBe(0);expect(leadCoverage([],reports).mismatches).toBe(1);expect(leadCoverage([make({channel:'ws'})],reports).mismatches).toBe(1);expect(leadCoverage([make({pageName:'q'})],reports).mismatches).toBe(1);});
 it('第七天仍观察中；完整七天结束后才进入最终分母，观察期转化不抬高成熟率',()=>{
  const rows=[make({qualifiedOn:'2026-11-01'}),make({qualifiedOn:'2026-11-08'}),make({receivedOn:'2026-11-10',qualifiedOn:'2026-11-10'})];
  expect(sevenDayResult(rows,'2026-11-07')).toMatchObject({received:0,rate:null,observing:3});
  expect(sevenDayResult(rows,'2026-11-12')).toMatchObject({received:2,converted:1,rate:50,observing:1});
 });
 it('成熟批次明细缺失时不展示高估比率，作废不进入分母',()=>{
  const rows=[make({qualifiedOn:'2026-11-02'}),make({qualifiedOn:'2026-11-02',voidedAt:'x'})];
  const reports=[{accountId:'a',pageName:'p',businessDate:'2026-11-01',msToday:2,wsToday:0,addedCount:2}];
  expect(sevenDayResult(rows,'2026-11-12',reports)).toMatchObject({received:1,missing:1,rate:null});
 });
});

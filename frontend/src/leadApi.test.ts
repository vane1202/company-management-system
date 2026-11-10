import {describe,it,expect} from 'vitest';
import {leadStats,leadCoverage,type Lead} from './leadApi';
describe('转化汇总展示口径',()=>{
 const make=(extra:object={})=>({accountId:'a',pageName:'p',receivedOn:'2026-11-01',channel:'ms',qualifiedOn:null,voidedAt:null,...extra}) as Lead;
 it('同批分母和7日边界；汇总按人数，不平均比率',()=>{expect(leadStats([make({qualifiedOn:'2026-11-01'}),make({qualifiedOn:'2026-11-07'}),make({qualifiedOn:'2026-11-08'}),make({qualifiedOn:'2026-11-01',voidedAt:'x'})],'2026-11-10')).toMatchObject({received:3,sameDayRate:33.3,sevenDayRate:66.7});expect(leadStats([],'2026-11-10').sameDayRate).toBeNull();});
 it('日报与明细按微信、日期、主页和渠道核对，缺失明细不展示偏高转化率',()=>{const reports=[{accountId:'a',pageName:'p',businessDate:'2026-11-01',msToday:1,wsToday:0,addedCount:1}];expect(leadCoverage([make()],reports).mismatches).toBe(0);expect(leadCoverage([],reports).mismatches).toBe(1);expect(leadCoverage([make({channel:'ws'})],reports).mismatches).toBe(1);expect(leadCoverage([make({pageName:'q'})],reports).mismatches).toBe(1);});
});

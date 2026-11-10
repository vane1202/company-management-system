import {expect,it} from 'vitest';
import {dashboardPresetRange} from './dates';
it('快捷周期与可见日期同步，跨月周一和周日计算正确',()=>{
 expect(dashboardPresetRange('2027-01-03','week')).toEqual({from:'2026-12-28',to:'2027-01-03'});
 expect(dashboardPresetRange('2026-11-09','week')).toEqual({from:'2026-11-09',to:'2026-11-09'});
});
it('月度与今日快捷范围不保留此前自定义日期',()=>{
 expect(dashboardPresetRange('2028-02-29','month')).toEqual({from:'2028-02-01',to:'2028-02-29'});
 expect(dashboardPresetRange('2026-11-09','day')).toEqual({from:'2026-11-09',to:'2026-11-09'});
});

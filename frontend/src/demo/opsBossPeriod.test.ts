import {describe,expect,it} from "vitest";
import {opsBossPeriod} from "./opsBossPeriod";
describe("BOSS投流周期",()=>{
 it("日月季年均截至今天，不把未发生的未来日期纳入",()=>{
  expect(opsBossPeriod('2026-11-16','day')).toEqual({from:'2026-11-16',to:'2026-11-16'});
  expect(opsBossPeriod('2026-11-16','month').from).toBe('2026-11-01');
  expect(opsBossPeriod('2026-11-16','quarter').from).toBe('2026-10-01');
  expect(opsBossPeriod('2026-11-16','year').from).toBe('2026-01-01');
  expect(opsBossPeriod('2024-02-29','quarter').from).toBe('2024-01-01');
  expect(opsBossPeriod('2026-04-01','quarter').from).toBe('2026-04-01');
 });
});

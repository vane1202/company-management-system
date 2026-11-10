import type { LiveBusinessFilters } from './api';
import { isIsoDate } from './dates';

export type LiveView = {
  view: 'rooms' | 'income' | 'expenses' | 'ads' | 'paid' | 'afterSales';
  preset: 'day' | 'week' | 'month';
  range?: { from: string; to: string };
  filters: LiveBusinessFilters;
  roomKey?: string;
};
export const defaultLiveView = (): LiveView => ({view:'rooms',preset:'day',filters:{room:'',host:'',persona:'',operator:''}});
export function validLiveView(value: unknown): value is LiveView {
  const v = value as LiveView | undefined;
  return !!v && ['rooms','income','expenses','ads','paid','afterSales'].includes(v.view) && ['day','week','month'].includes(v.preset)
    && !!v.filters && ['room','host','persona','operator'].every(k=>typeof v.filters[k as keyof LiveBusinessFilters]==='string'&&v.filters[k as keyof LiveBusinessFilters].length<=256)
    && (v.roomKey===undefined||typeof v.roomKey==='string'&&v.roomKey.length>0&&v.roomKey.length<=256)
    && (!v.range||isIsoDate(v.range.from)&&isIsoDate(v.range.to)&&v.range.from<=v.range.to);
}
export function liveViewKey(v?: LiveView): string {
  return v ? JSON.stringify([v.view,v.preset,v.range?.from,v.range?.to,v.filters.room,v.filters.host,v.filters.persona,v.filters.operator,v.roomKey]) : '';
}
export function liveViewLabel(v?: LiveView): string {
  if(!v||v.view==='rooms')return '直播间经营';
  if(v.view==='ads')return '广告消耗明细';
  if(v.view==='paid')return '已付款业绩 · 财务核定';
  if(v.view==='afterSales')return '售后收款与业务毛利';
  return `${v.roomKey==='__unassigned__'?'未归属直播间':v.roomKey||'全部直播间'} · ${v.view==='income'?'收入明细':'费用明细'}`;
}

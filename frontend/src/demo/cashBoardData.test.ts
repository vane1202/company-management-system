import {describe,it,expect} from 'vitest';
import type {FinanceData,FinancePayment,SettlementRecord} from '../api';
import {buildCashBoard,buildOutstandingPayments,convertPendingCash,formatCashValue,formatPendingCash} from './cashBoardData';
import {convertCustomerPayments,type FxQuote} from './adExchangeRates';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const today='2026-11-11',period={from:today,to:today};
const p=(id:string,patch:Partial<FinancePayment>={}):FinancePayment=>({id,payment_date:today,amount:'140.00',currency:'USD',credit_amount:'140.00',purpose:'full',channel:'代收账户',third_party:true,reference:id,voided_at:null,settled_amount:'140.00',pendingAmount:'0.00',order_id:'o-'+id,order_ref:'O-'+id,customer_label:'虚构客户',persona_name:'虚构人设',wechat_id:'虚构接待号',customer_currency:'USD',...patch});
const s=(patch:Partial<SettlementRecord>={}):SettlementRecord=>({id:'s1',reference:'s1',channel:'代收账户',currency:'USD',settled_on:today,fee_amount:'1.00',fee_currency:'USD',fee_percent:null,fx_rate:'6.60',net_cny:'323.40',note:'虚构',voided_at:null,void_reason:null,allocations:[{paymentId:'usd',foreignAmount:'50.00',netCny:'323.40'}],...patch});
const data=(payments:FinancePayment[],settlements:SettlementRecord[]=[]):FinanceData=>({payments,settlements,summary:{pending:{CNY:'0.00',TWD:'0.00',USD:'0.00'},directCny:'0.00',settledCny:'0.00',totalCny:'0.00'}});
describe('BOSS 收款与到账口径',()=>{
 it('待收只合并客户未付余额与第三方尚未转回款，排除已转回款',async()=>{
  const board=buildCashBoard(data([p('usd')],[s()]),period);
  const unpaid=[{currency:'USD' as const,balance:'60.00'}];
  const quote=async (date:string,currency:FxQuote['currency']):Promise<FxQuote>=>({
   date,currency,rate:'7.00',updatedAt:`${date}T00:00:00Z`,checkedAt:0,source:'test',sourceDate:date,delayed:false,stale:false,
  });
  const pending=await convertPendingCash(today,unpaid,board.pending,quote);
  expect(board.totalCny).toBe('323.40');
  expect([pending.customer.cny,pending.held.cny,pending.total.cny]).toEqual(['420.00','630.00','1050.00']);
  expect(formatPendingCash(pending.total)).toBe('约 ¥1,050.00');
  const missing=await convertPendingCash(today,unpaid,board.pending,async()=>null);
  expect(formatPendingCash(missing.total)).toBe('待折算');
  const unknown=await convertPendingCash(today,[{currency:null,balance:null}],board.pending,quote);
  expect(formatPendingCash(unknown.total)).toBe('待核对');
 });
 it('首页待收按截止日参考汇率折算，并标记无法核对的订单余额',async()=>{
  const outstanding=buildOutstandingPayments(today,[
   {currency:'CNY',balance:'100.10'},
   {currency:'CNY',balance:'250.20'},
   {currency:'TWD',balance:'1200.00'},
   {currency:'USD',balance:'90.00'},
   {currency:null,balance:null},
  ]);
  expect(outstanding.incomplete).toBe(true);
  const getQuote=async (date:string,currency:FxQuote['currency']):Promise<FxQuote>=>{
   expect(date).toBe(today);
   return {date,currency,rate:currency==='TWD'?'0.20':'7.00',updatedAt:`${date}T00:00:00Z`,checkedAt:0,source:'test',sourceDate:date,delayed:false,stale:false};
  };
  expect(await convertCustomerPayments(outstanding.records,outstanding.totals,getQuote)).toMatchObject({cny:'1220.30',hasForeign:true});
  expect(await convertCustomerPayments(outstanding.records,outstanding.totals,async()=>null)).toMatchObject({cny:null});
  const empty=buildOutstandingPayments(today,[]);
  expect(await convertCustomerPayments(empty.records,empty.totals,getQuote)).toMatchObject({cny:'0.00',hasForeign:false});
 });
 it('实际到账只合并人民币直收和净到账，代收余额按原币重算且不重复扣费',()=>{
  const d=buildCashBoard(data([p('direct',{currency:'CNY',amount:'1290.50',third_party:false}),p('twd',{channel:'台币代收',currency:'TWD',amount:'1200.00'}),p('usd')],[s()]),period);
  expect(d.totalCny).toBe('1613.90');expect(d.thirdPartyCny).toBe('323.40');
  expect(d.pending).toEqual({CNY:'0.00',TWD:'1200.00',USD:'90.00'});expect(d.receipts).toEqual({CNY:'1290.50',TWD:'1200.00',USD:'140.00'});
  expect(d.heldCount).toBe(2);expect(d.groups).toHaveLength(2);
 });
 it('期末代收余额包含历史付款；公司到账按到账日，不随客户付款期筛掉',()=>{
  const d=buildCashBoard(data([p('usd',{payment_date:'2026-11-09'})],[s()]),period);
  expect(d.receipts.USD).toBe('0.00');expect(d.totalCny).toBe('323.40');expect(d.pending.USD).toBe('90.00');
  expect(d.groups[0].heldDays).toBe(2);expect(d.groups[0].oldestDate).toBe('2026-11-09');
 });
 it('历史截止日忽略未来到账，不沿用当前待结快照',()=>{
  const d=buildCashBoard(data([p('usd',{payment_date:'2026-11-09'})],[s()]),{from:'2026-11-09',to:'2026-11-10'});
  expect(d.pending.USD).toBe('140.00');expect(d.totalCny).toBe('0.00');expect(d.groups[0].lastTransferDate).toBe(null);
 });
 it('排除作废与截止日之后的付款和结算',()=>{
  const d=buildCashBoard(data([p('usd'),p('void',{voided_at:'x'}),p('future',{payment_date:'2026-11-12'})],[s({voided_at:'x'})]),period);
  expect(d.pending.USD).toBe('140.00');expect(d.receipts.USD).toBe('140.00');expect(d.totalCny).toBe('0.00');
 });
 it('按账户及币种分组，已转回款不继续列入待跟进',()=>{
  const d=buildCashBoard(data([p('usd'),p('another',{channel:'另一账户'}),p('twd',{currency:'TWD'})],[s({allocations:[{paymentId:'usd',foreignAmount:'140.00',netCny:'900.00'}],net_cny:'900.00'})]),period);
  expect(d.groups).toHaveLength(2);expect(d.groups.some(g=>g.payments.some(p=>p.id==='usd'))).toBe(false);expect(d.pending.USD).toBe('140.00');
 });
 it('错配或超额结算标为待核对，不产生负余额或伪造零余额',()=>{
  const over=buildCashBoard(data([p('usd')],[s({allocations:[{paymentId:'usd',foreignAmount:'150.00',netCny:'323.40'}]})]),period);
  expect(over.pending.USD).toBe(null);expect(over.groups[0].pending).toBe(null);expect(over.issueCount).toBeGreaterThan(0);
  const mismatch=buildCashBoard(data([p('usd')],[s({currency:'TWD'})]),period);expect(mismatch.pending.USD).toBe(null);
 });
 it('空记录与无效区间分开处理，外币直收没有人民币到账记录时不猜汇率',()=>{
  const empty=buildCashBoard(data([]),period);expect(empty.totalCny).toBe('0.00');expect(empty.groups).toEqual([]);
  expect(()=>buildCashBoard(data([]),{from:'2026-02-30',to:today})).toThrow();
  const direct=buildCashBoard(data([p('usd',{third_party:false})]),period);expect(direct.totalCny).toBe(null);expect(direct.issueCount).toBe(1);
 });
 it('汇总不受单笔输入位数限制，金额格式化不经浮点数丢失分位',()=>{
  const large=buildCashBoard(data([p('a',{currency:'CNY',amount:'999999999999.99',third_party:false}),p('b',{currency:'CNY',amount:'999999999999.99',third_party:false})]),period);
  expect(large.totalCny).toBe('1999999999999.98');expect(large.receipts.CNY).toBe('1999999999999.98');
  expect(formatCashValue('9007199254740993.01')).toBe('9,007,199,254,740,993.01');
 });
 it('日期或币种无法归类时，关联汇总显示待核对而非已确认零余额',()=>{
  const malformed=buildCashBoard(data([p('bad',{payment_date:'2026-02-30'})]),period);
  expect(malformed.pending.USD).toBe(null);expect(malformed.totalCny).toBe(null);expect(malformed.receiptsIncomplete).toBe(true);
  const badSettlement=buildCashBoard(data([p('usd')],[s({settled_on:'invalid'})]),period);
  expect(badSettlement.pendingIncomplete).toBe(true);expect(badSettlement.groups[0].pending).toBe(null);
  expect(badSettlement.groups[0].payments[0].pendingAsOf).toBe(null);expect(badSettlement.totalCny).toBe(null);
 });
 it('真实演示API载荷与新看板金额一致，整条调用不触达正式后台',async()=>{
  let network=0;const storage=new Map<string,string>();
  const win={location:{origin:'https://fictional.example',search:'?role=boss',assign(){}},sessionStorage:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)},fetch:(async()=>{network++;throw Error('Unexpected network');}) as typeof fetch};
  const script=readFileSync(new URL('../../../demo/readonly-api.js',import.meta.url),'utf8');
  runInNewContext(script,{window:win,document:{addEventListener(){}},URL,URLSearchParams,Response,Date});
  const source=await (await win.fetch('/api/finance')).json() as FinanceData;
  const meta=await (await win.fetch('/api/auth/me')).json();
  const result=buildCashBoard(source,{from:meta.today,to:meta.today});
  expect(result.totalCny).toBe(source.summary.totalCny);expect(result.pending).toEqual(source.summary.pending);
  expect(result.receipts).toEqual({CNY:'1290.50',TWD:'1200.00',USD:'140.00'});expect(result.issueCount).toBe(0);expect(network).toBe(0);
 });
});

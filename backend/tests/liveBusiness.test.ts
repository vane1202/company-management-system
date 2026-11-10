import {expect,it} from 'vitest';
import {summarizeLiveBusiness,type LiveOrder,type BusinessEvent} from '../src/lib/liveBusiness.js';
const order=(id:string,room:string,status='placed'):LiveOrder=>({id,status,order_ref:id,customer_label:'测试客户',persona_code:'P-'+id,persona_name:'人设',live_room_code:room,host_name:'主播',customer_code:'C-'+id,operator_name:'客服',wechat_id:'WX',legacy_cost:'0.00',legacy:false});
const event=(id:string,orderId:string,kind:BusinessEvent['kind'],amount:string,currency:BusinessEvent['currency']='CNY'):BusinessEvent=>({id,order_id:orderId,kind,date:'2026-11-09',amount,currency,category:'',label:kind});
it('新增成交和追加收费独立合计，直播间汇总等于总数，标记退款源单单列',()=>{
 const result=summarizeLiveBusiness([order('a','A'),order('b','B'),order('r','A','refunded')],[event('1','a','sale','110.01'),event('2','a','charge','20.02'),event('3','b','sale','200.00'),event('4','r','sale','50.00')]);
 expect(result.totals).toMatchObject({performanceCny:'310.01',newSalesCny:'310.01',additionalCny:'20.02',newOrderCount:2,excludedSourceCny:'50.00'});
 expect(result.rooms.map(r=>r.roomCode)).toEqual(['B','A']);expect(result.rooms.find(r=>r.key==='A')!.totals.performanceCny).toBe('110.01');
});
it('费用发生、公司付款、客户付款和净到账分别合计，币种不相加',()=>{
 const r=summarizeLiveBusiness([order('a','A')],[event('1','a','expense','80.00'),event('2','a','supplier','30.00'),event('3','a','receipt','100.00','TWD'),event('4','a','receipt','10.00','USD'),event('5','a','receipt','20.00'),event('6','a','company','22.10')]);
 expect(r.totals).toMatchObject({expenseCny:'80.00',supplierPaidCny:'30.00',companyReceivedCny:'22.10',customerReceipts:{CNY:'20.00',TWD:'100.00',USD:'10.00'},performanceCny:'0.00'});
});
it('未归属直播间保留在总表；旧成本日期未知不推测为今日费用',()=>{
 const r=summarizeLiveBusiness([{...order('old',''),legacy:true,legacy_cost:'99.00'}],[event('1','old','sale','100.00')]);
 expect(r.rooms[0]).toMatchObject({key:'__unassigned__',roomCode:'未归属直播间'});expect(r.totals.expenseCny).toBe('0.00');expect(r.legacyCost).toEqual({count:1,amountCny:'99.00'});
});
it('无数据为真实零汇总，不产生虚构直播间',()=>{const r=summarizeLiveBusiness([],[]);expect(r.rooms).toEqual([]);expect(r.events).toEqual([]);expect(r.totals.performanceCny).toBe('0.00');});
it('跑单仅回冲原开单营业额，追加收费、费用和真实资金分别保留口径',()=>{
 const r=summarizeLiveBusiness([{...order('a','A'),cancelled:true},order('b','B')],[event('1','a','sale','11000.00'),event('2','b','charge','200.00'),event('3','a','expense','50.00')]);
 expect(r.totals).toMatchObject({grossSalesCny:'11000.00',performanceCny:'0.00',cancelledSalesCny:'11000.00',excludedSourceCny:'11000.00',cancelledOrderCount:1,newOrderCount:0,additionalCny:'200.00',expenseCny:'50.00',companyReceivedCny:'0.00'});
 expect(r.events).toHaveLength(3);expect(r.rooms.find(r=>r.key==='B')?.totals).toMatchObject({performanceCny:'0.00',additionalCny:'200.00'});
});

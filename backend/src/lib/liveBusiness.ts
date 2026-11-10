import {addMoney,centsToMoney,moneyToCents} from './money.js';

export type LiveOrder={id:string;status:string;order_ref:string;customer_label:string|null;persona_code:string;persona_name:string;live_room_code:string;host_name:string;customer_code:string;operator_name:string;wechat_id:string;legacy_cost:string;legacy:boolean};
export type BusinessEvent={id:string;order_id:string;kind:'sale'|'charge'|'expense'|'receipt'|'company'|'supplier';date:string;amount:string;currency:'CNY'|'TWD'|'USD';category:string;label:string};
export function emptyBusinessTotals(){return{performanceCny:'0.00',newSalesCny:'0.00',additionalCny:'0.00',expenseCny:'0.00',supplierPaidCny:'0.00',companyReceivedCny:'0.00',excludedSourceCny:'0.00',newOrderCount:0,expenseCount:0,customerReceipts:{CNY:'0.00',TWD:'0.00',USD:'0.00'}};}
type Totals=ReturnType<typeof emptyBusinessTotals>;
function add(t:Totals,key:'newSalesCny'|'additionalCny'|'expenseCny'|'supplierPaidCny'|'companyReceivedCny'|'excludedSourceCny',amount:string){t[key]=addMoney([t[key],amount]);}
export function summarizeLiveBusiness(orders:LiveOrder[],events:BusinessEvent[]){
 const directory=new Map(orders.map(o=>[o.id,o]));
 const rooms=new Map<string,{key:string;roomCode:string;hosts:string[];personas:string[];totals:Totals}>();
 const totals=emptyBusinessTotals();
 const details=events.map(e=>({...e,order:directory.get(e.order_id)!})).filter(e=>!!e.order);
 for(const e of details){
  const o=e.order,key=o.live_room_code||'__unassigned__';
  if(!rooms.has(key))rooms.set(key,{key,roomCode:o.live_room_code||'未归属直播间',hosts:[],personas:[],totals:emptyBusinessTotals()});
  const room=rooms.get(key)!;
  if(o.host_name&&!room.hosts.includes(o.host_name))room.hosts.push(o.host_name);
  const persona=[o.persona_code,o.persona_name].filter(Boolean).join(' · ');if(persona&&!room.personas.includes(persona))room.personas.push(persona);
  for(const t of [totals,room.totals]){
   if(e.kind==='sale'||e.kind==='charge'){
    if(o.status==='refunded')add(t,'excludedSourceCny',e.amount);
    else if(e.kind==='sale'){add(t,'newSalesCny',e.amount);t.newOrderCount++;}else add(t,'additionalCny',e.amount);
   }else if(e.kind==='expense'){add(t,'expenseCny',e.amount);t.expenseCount++;}
   else if(e.kind==='receipt')t.customerReceipts[e.currency]=addMoney([t.customerReceipts[e.currency],e.amount]);
   else if(e.kind==='company')add(t,'companyReceivedCny',e.amount);
   else if(e.kind==='supplier')add(t,'supplierPaidCny',e.amount);
  }
 }
 totals.performanceCny=addMoney([totals.newSalesCny,totals.additionalCny]);
 for(const room of rooms.values())room.totals.performanceCny=addMoney([room.totals.newSalesCny,room.totals.additionalCny]);
 return{totals,rooms:[...rooms.values()].sort((a,b)=>{const d=moneyToCents(b.totals.performanceCny)-moneyToCents(a.totals.performanceCny);return d===0n?a.roomCode.localeCompare(b.roomCode):d>0n?1:-1;}),events:details,legacyCost:{count:orders.filter(o=>o.legacy&&moneyToCents(o.legacy_cost)>0n).length,amountCny:centsToMoney(orders.filter(o=>o.legacy).reduce((n,o)=>n+moneyToCents(o.legacy_cost),0n))}};
}

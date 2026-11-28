import type {FinanceData, PayablesData} from '../api';
import {cents, money} from '../commerceUi';

export type ReimbursementState = {claims:{id:string;expenseId:string;status:string;amount:string}[];payments:{id:string;claimId:string;date:string;amount:string;payee:string}[]};
export type CashRow = {id:string;date:string;label:string;amount:string;direction:'in'|'out';category:string};
export function financeCashRows(finance:FinanceData,payables:PayablesData,reimbursements:ReimbursementState,topups:{id:string;paid_on:string;paid_cny:string;voided_at:string|null}[]):CashRow[]{
  return [
    ...finance.payments.filter(item=>!item.voided_at&&!item.third_party&&item.currency==='CNY'&&(item.verify_status??'confirmed')==='confirmed').map(item=>({id:'receipt:'+item.id,date:item.verified_on||item.payment_date,label:item.customer_label+' · '+item.order_ref,amount:item.verified_cny||item.amount,direction:'in' as const,category:'客户直接到账'})),
    ...finance.settlements.filter(item=>!item.voided_at).map(item=>({id:'settlement:'+item.id,date:item.settled_on,label:item.channel,amount:item.net_cny,direction:'in' as const,category:'第三方结算到账'})),
    ...payables.payments.filter(item=>!item.voided_at).map(item=>({id:'supplier:'+item.id,date:item.paid_on,label:item.payee,amount:item.amount_cny,direction:'out' as const,category:'业务结账（含关联报销）'})),
    ...reimbursements.payments.filter(item=>reimbursements.claims.some(claim=>claim.id===item.claimId&&!claim.expenseId)).map(item=>({id:'reimbursement:'+item.id,date:item.date,label:item.payee,amount:item.amount,direction:'out' as const,category:'独立费用报销'})),
    ...topups.filter(item=>!item.voided_at).map(item=>({id:'topup:'+item.id,date:item.paid_on,label:'广告账户充值',amount:item.paid_cny,direction:'out' as const,category:'广告充值实付'}))
  ];
}
export function cashTotal(rows:CashRow[],direction:'in'|'out',from:string,to:string){
  return money(rows.filter(item=>item.direction===direction&&item.date>=from&&item.date<=to).reduce((total,item)=>{const amount=cents(item.amount);if(amount===null)throw Error('资金流水金额待核对');return total+amount;},0n));
}

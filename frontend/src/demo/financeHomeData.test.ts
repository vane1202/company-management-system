import {describe,it,expect} from 'vitest';
import type {FinanceData,PayablesData} from '../api';
import {financeCashRows,cashTotal} from './financeHomeData';

describe('财务资金流水口径',()=>{
  it('客户代收不提前算到账，结算只取净额，关联报销不重复，按付款日归属',()=>{
    const finance={payments:[{id:'a',payment_date:'2026-11-16',amount:'100.00',currency:'CNY',third_party:false},{id:'b',payment_date:'2026-11-16',amount:'500.00',currency:'USD',third_party:true},{id:'void',payment_date:'2026-11-16',amount:'999.00',currency:'CNY',third_party:false,voided_at:'void'}],settlements:[{id:'s',settled_on:'2026-11-16',net_cny:'50.00'}]} as FinanceData;
    const payables={payments:[{id:'p',paid_on:'2026-11-15',amount_cny:'40.00'}]} as PayablesData;
    const reimbursements={claims:[{id:'linked',expenseId:'expense',status:'approved',amount:'40.00'},{id:'own',expenseId:'',status:'approved',amount:'60.00'}],payments:[{id:'r1',claimId:'linked',date:'2026-11-15',amount:'40.00',payee:'A'},{id:'r2',claimId:'own',date:'2026-11-16',amount:'20.00',payee:'B'}]};
    const rows=financeCashRows(finance,payables,reimbursements,[{id:'ad',paid_on:'2026-11-16',paid_cny:'30.00',voided_at:null}]);
    expect(cashTotal(rows,'in','2026-11-16','2026-11-16')).toBe('150.00');
    expect(cashTotal(rows,'out','2026-11-16','2026-11-16')).toBe('50.00');
    expect(cashTotal(rows,'out','2026-11-15','2026-11-16')).toBe('90.00');
    expect(cashTotal(rows,'out','2026-10-01','2026-10-31')).toBe('0.00');
  });
  it('不把非法金额变成零',()=>{
    expect(()=>cashTotal([{id:'x',date:'2026-11-16',label:'X',direction:'out',category:'业务',amount:'unknown'}],'out','2026-11-16','2026-11-16')).toThrow('待核对');
  });
});

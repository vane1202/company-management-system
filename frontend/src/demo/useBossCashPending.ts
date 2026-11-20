import {useEffect,useState} from 'react';
import type {LiveRoomOperations} from '../api';
import {convertPendingCash,type CashAmounts} from './cashBoardData';
import {useReferenceQuotes} from './useReferenceQuotes';

export type CashOrderBalances = Pick<LiveRoomOperations, 'asOf' | 'orders'>;
const cashBalancesApi = import.meta.env.MODE === 'demo' ? '/api/demo/cash-order-balances' : '/api/dashboard/cash-order-balances';

export async function loadCashOrderBalances(date: string): Promise<CashOrderBalances> {
  const response = await fetch(cashBalancesApi + '?' + new URLSearchParams({asOf:date}), { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error('订单余额暂不可用');
  return response.json();
}

export function useBossCashPending(date: string, operations: CashOrderBalances | undefined, agency: CashAmounts | undefined) {
  const revision = useReferenceQuotes();
  const orders = operations?.asOf === date ? operations.orders : undefined;
  const key = orders && agency ? JSON.stringify({date,revision,orders:orders.map(({currency,balance})=>[currency,balance]),agency}) : null;
  const [result,setResult] = useState<{key:string; value:Awaited<ReturnType<typeof convertPendingCash>>} | null>(null);
  useEffect(()=>{
    if (!key || !orders || !agency) return;
    let active = true;
    void convertPendingCash(date,orders,agency).then(value=>{if(active)setResult({key,value});});
    return ()=>{active=false;};
  },[key]);
  const value = result?.key === key ? result.value : undefined;
  return {value, loading:!!key && !value};
}

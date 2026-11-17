import {useEffect,useState,type ReactNode} from 'react';
import type {Page} from '../access';
import type {FinancePayment} from '../api';
import {loadAdminHome,loaded} from '../roleHomeData';
import {isServiceAccount} from '../serviceAccounts';
import {toErrorMessage} from '../errors';
import {InfoTip} from '../InfoTip';
import {cents} from '../commerceUi';
import './role-workbenches.css';
export { SupervisorWorkbench } from './SupervisorHome';

type Navigate=(page:Page)=>void;
function Heading({title,caption,loading,refresh}:{title:string;caption:string;loading?:boolean;refresh?:()=>void}){return <header className="desk-heading"><div><p className="eyebrow">翠管家 · 岗位工作台</p><h1>{title}</h1><span className="desk-caption">{caption}</span></div>{refresh&&<button className="secondary" disabled={loading} onClick={refresh}>{loading?'读取中':'刷新'}</button>}</header>;}
function Task({title,note,value,onClick,attention=false}:{title:string;note:string;value?:ReactNode;onClick:()=>void;attention?:boolean}){return <button className={'desk-task '+(attention?'desk-task-attention':'')} type="button" onClick={onClick}><span><strong>{title}</strong><small>{note}</small></span><span className="desk-task-end">{value!==undefined&&<b>{value}</b>}<span aria-hidden="true">›</span></span></button>;}
function Metric({label,value,onClick}:{label:string;value:ReactNode;onClick:()=>void}){return <button type="button" className="desk-metric" onClick={onClick}><span>{label}</span><strong>{value??'—'}</strong></button>;}
function Errors({errors,retry}:{errors:string[];retry:()=>void}){return errors.length?<div className="overview-error" role="alert"><strong>部分数据未能读取</strong>{errors.map(e=><p key={e}>{e}</p>)}<button onClick={retry}>重新读取</button></div>:null;}
function errorsOf(sources:[string,PromiseSettledResult<unknown>|undefined][]){return sources.flatMap(([label,result])=>result?.status==='rejected'?[label+'：'+toErrorMessage(result.reason)]:[]);}

export function AdminWorkbench({onNavigate}:{onNavigate:Navigate}){
 const [data,setData]=useState<Awaited<ReturnType<typeof loadAdminHome>>|null>(null),[loading,setLoading]=useState(true),[tick,setTick]=useState(0);const refresh=()=>setTick(t=>t+1);
 useEffect(()=>{let live=true;setData(null);setLoading(true);loadAdminHome().then(r=>{if(live){setData(r);setLoading(false);}});return()=>{live=false;};},[tick]);
 const users=loaded(data?.users)?.users.filter(u=>!isServiceAccount(u.accountKind)),teams=loaded(data?.teams)?.teams,modules=loaded(data?.modules);
 const noTeam=users?.filter(u=>u.isActive&&u.role==='cs_supervisor'&&!u.managedTeamIds?.length);const entries=modules?Object.entries(modules.modules):null;
 return <div className="role-desk" aria-busy={loading}><Heading title="后台管理员工作台" caption="登录账号 · 小组权限 · 系统配置" loading={loading} refresh={refresh}/><div className="desk-metrics"><Metric label="员工登录账号" value={users?.length} onClick={()=>onNavigate('people')}/><Metric label="客服小组" value={teams?.length} onClick={()=>onNavigate('people')}/><Metric label="待分配主管" value={noTeam?.length} onClick={()=>onNavigate('people')}/><Metric label="已启用模块" value={entries?entries.filter(([,v])=>v).length+' / '+entries.length:'—'} onClick={()=>onNavigate('modules')}/></div><Errors errors={errorsOf([['员工登录账号',data?.users],['客服小组',data?.teams],['模块',data?.modules]])} retry={refresh}/>
 <div className="desk-columns"><section className="desk-panel"><h2>配置待完善</h2><div className="desk-task-list"><Task title="主管管理范围" note="为主管分配负责的小组" value={noTeam?noTeam.length+' 个未分配':'—'} attention={!!noTeam?.length} onClick={()=>onNavigate('people')}/></div><p className="notice">接待账号新增、账号更换和持有人维护由本组客服主管负责。</p></section>
 <section className="desk-panel"><h2>常用设置</h2><div className="desk-task-list"><Task title="账号与小组" note="员工登录 · 角色权限 · 主管范围" onClick={()=>onNavigate('people')}/><Task title="模块与系统设置" note="功能开关 · 填报补报窗口" onClick={()=>onNavigate('modules')}/></div></section></div>
 <details className="desk-panel"><summary>模块启用状态</summary>{entries?.map(([key,enabled])=><div className="desk-status-row" key={key}><span>{modules?.labels[key]??key}</span><b>{enabled?'已启用':'已关闭'}</b></div>)}{!entries&&<p>模块状态暂不可用</p>}</details></div>;
}

type FinanceWork='reimbursement'|'warehouse'|'receipts'|'settlement'|'later'|'material'|'other'|'commission'|'dailyExpenses';
export function FinanceWorkbenchHome({today,payments,error,onOpen,onSalary,onRetry}:{today:string;payments:FinancePayment[]|null;error:string;onOpen:(work:FinanceWork)=>void;onSalary:()=>void;onRetry:()=>void}){
 const active=payments?.filter(p=>!p.voided_at),unknown=active?.some(p=>p.third_party&&cents(p.pendingAmount)===null);
 const pending=active?.filter(p=>{const amount=cents(p.pendingAmount);return p.third_party&&amount!==null&&amount>0n;});
 const receipts=active?.filter(p=>!p.after_sale_charge_id),after=active?.filter(p=>!!p.after_sale_charge_id),todayReceipts=receipts?.filter(p=>p.payment_date===today);
 return <div className="role-desk finance-desk" aria-busy={!payments&&!error}><Heading title="财务工作台" caption={today+' · 录入与核对'}/><Errors errors={error?[error]:[]} retry={onRetry}/><div className="desk-metrics"><Metric label="今日订单收款记录" value={todayReceipts?todayReceipts.length+' 笔':'—'} onClick={()=>onOpen('receipts')}/><Metric label="第三方待结算记录" value={unknown?'待核对':pending?pending.length+' 笔':'—'} onClick={()=>onOpen('settlement')}/><Metric label="全部订单收款记录" value={receipts?receipts.length+' 笔':'—'} onClick={()=>onOpen('receipts')}/><Metric label="全部售后收款记录" value={after?after.length+' 笔':'—'} onClick={()=>onOpen('later')}/></div>
 <div className="desk-columns"><section className="desk-panel"><div className="desk-section-heading"><h2>收款与结算</h2><InfoTip label="财务记录统计口径" text="收款卡片统计已登记且未作废的流水笔数，不代表待审核订单或客户欠款。第三方待结算为仍有待结算余额的代收记录；缺失余额须到明细核对。"/></div><div className="desk-task-list"><Task title="订单收款" note="当日收款与尾款 · 录入与核对" onClick={()=>onOpen('receipts')}/><Task title="第三方结算" note="扣点 · 结汇 · 实际人民币到账" value={unknown?'余额待核对':pending?pending.length+' 笔待结算':'—'} attention={!!pending?.length||!!unknown} onClick={()=>onOpen('settlement')}/><Task title="售后费用收款" note="设计 · 雕刻 · 配货等追加收费" onClick={()=>onOpen('later')}/></div></section>
 <section className="desk-panel"><h2>付款与工资</h2><div className="desk-task-list"><Task title="费用报销" note="临时支出 · 业务垫付 · 报销付款" onClick={()=>onOpen('reimbursement')}/><Task title="库房结账" note="核对库房账单并登记实际付款" onClick={()=>onOpen('warehouse')}/><Task title="料子货款台账" note="查看原有供货成本与付款" onClick={()=>onOpen('material')}/><Task title="加工与发货台账" note="查看原有业务成本与付款" onClick={()=>onOpen('other')}/><Task title="业绩提成" note="按订单净利润核算主播、客服与主管提成" onClick={()=>onOpen('commission')}/><Task title="日常运营费用" note="房租 · 水电 · 接待 · 其他" onClick={()=>onOpen('dailyExpenses')}/><Task title="员工工资核算" note="按工种维护基本工资与月度明细" onClick={onSalary}/></div></section></div><details className="desk-panel"><summary>其他财务工具</summary><div className="desk-task-list"><Task title="广告充值与其他付款" note="广告户预存与公司付款记录" onClick={()=>onOpen('other')}/></div></details></div>;
}

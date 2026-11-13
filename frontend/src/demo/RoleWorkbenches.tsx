import {useEffect,useState,type ReactNode} from 'react';
import type {Page} from '../access';
import type {FinancePayment} from '../api';
import {loadAdminHome,loadSupervisorHome,loaded} from '../roleHomeData';
import {reportingOverview} from '../dashboardOverview';
import {missingReporters,yuan} from '../dashboardDisplay';
import {isServiceAccount} from '../serviceAccounts';
import {toErrorMessage} from '../errors';
import {InfoTip} from '../InfoTip';
import {cents} from '../commerceUi';
import './role-workbenches.css';

type Navigate=(page:Page)=>void;
function Heading({title,caption,loading,refresh}:{title:string;caption:string;loading?:boolean;refresh?:()=>void}){return <header className="desk-heading"><div><p className="eyebrow">翠管家 · 岗位工作台</p><h1>{title}</h1><span className="desk-caption">{caption}</span></div>{refresh&&<button className="secondary" disabled={loading} onClick={refresh}>{loading?'读取中':'刷新'}</button>}</header>;}
function Task({title,note,value,onClick,attention=false}:{title:string;note:string;value?:ReactNode;onClick:()=>void;attention?:boolean}){return <button className={'desk-task '+(attention?'desk-task-attention':'')} type="button" onClick={onClick}><span><strong>{title}</strong><small>{note}</small></span><span className="desk-task-end">{value!==undefined&&<b>{value}</b>}<span aria-hidden="true">›</span></span></button>;}
function Metric({label,value,onClick}:{label:string;value:ReactNode;onClick:()=>void}){return <button type="button" className="desk-metric" onClick={onClick}><span>{label}</span><strong>{value??'—'}</strong></button>;}
function Errors({errors,retry}:{errors:string[];retry:()=>void}){return errors.length?<div className="overview-error" role="alert"><strong>部分数据未能读取</strong>{errors.map(e=><p key={e}>{e}</p>)}<button onClick={retry}>重新读取</button></div>:null;}
function errorsOf(sources:[string,PromiseSettledResult<unknown>|undefined][]){return sources.flatMap(([label,result])=>result?.status==='rejected'?[label+'：'+toErrorMessage(result.reason)]:[]);}

export function SupervisorWorkbench({today,onNavigate}:{today:string;onNavigate:Navigate}){
 const [data,setData]=useState<Awaited<ReturnType<typeof loadSupervisorHome>>|null>(null),[loading,setLoading]=useState(true),[tick,setTick]=useState(0);const refresh=()=>setTick(t=>t+1);
 useEffect(()=>{let live=true;setData(null);setLoading(true);loadSupervisorHome(today).then(r=>{if(live){setData(r);setLoading(false);}});return()=>{live=false;};},[today,tick]);
 const teams=loaded(data?.fans)?.teams,orders=loaded(data?.orders),accounts=loaded(data?.accounts)?.accounts;
 const report=teams?reportingOverview(teams):null,missing=missingReporters(teams),noScope=teams?.length===0;
 const active=accounts?.filter(a=>a.isActive),noHolder=active?.filter(a=>!a.holderName?.trim());
 return <div className="role-desk supervisor-desk" aria-busy={loading}><Heading title="客服主管工作台" caption={today+' · 本组当日'} loading={loading} refresh={refresh}/><Errors errors={errorsOf([['加粉日报',data?.fans],['开单记录',data?.orders],['接待账号',data?.accounts]])} retry={refresh}/>
 {noScope?<section className="desk-panel"><h2>暂未分配管理小组</h2><p>请联系管理员设置负责的小组。</p></section>:<>
 <div className="desk-metrics"><Metric label="今日报粉 / 应报" value={report?report.reported+' / '+report.expected:'—'} onClick={()=>onNavigate('summary')}/><Metric label="未报粉账号" value={report?.missing} onClick={()=>onNavigate('summary')}/><Metric label="今日开单营业额" value={yuan(orders?.totals.turnover??null)} onClick={()=>onNavigate('orders')}/><Metric label="在用接待账号" value={active?.length} onClick={()=>onNavigate('csAccounts')}/></div>
 <div className="desk-columns"><section className="desk-panel"><div className="desk-section-heading"><h2>今日跟进</h2><InfoTip label="跟进事项说明" text="报粉进度按接待账号统计；订单与尾款需进入明细核对。账号使用历史在本组客服账号管理中核对，换人不改写旧记录。"/></div><div className="desk-task-list"><Task title="跟进未报粉账号" note={report?report.missing?'查看缺报账号并提醒补填':'当日应报账号均已报粉':'等待日报数据'} value={report?report.missing+' 个未报':'—'} attention={!!report?.missing} onClick={()=>onNavigate('summary')}/><Task title="核对开单与尾款" note="本组消费业绩 · 订单档案与收款" onClick={()=>onNavigate('orders')}/><Task title="补充账号持有人" note="核对当前负责该账号的客服" value={noHolder?noHolder.length+' 个待补':'—'} attention={!!noHolder?.length} onClick={()=>onNavigate('csAccounts')}/><Task title="核对账号使用历史" note="换人后旧记录封存在原员工名下" onClick={()=>onNavigate('csAccounts')}/></div>{missing.length>0&&<div className="desk-chips" aria-label="未报账号">{missing.slice(0,5).map(m=><span key={m.userId}>{m.displayName}</span>)}{missing.length>5&&<span>另 {missing.length-5} 个</span>}</div>}</section>
 <section className="desk-panel"><h2>本组管理</h2><div className="desk-task-list"><Task title="查看本组加粉" note="每日线索 · 沟通情况 · 接待账号" onClick={()=>onNavigate('summary')}/><Task title="查看客服考核" note="开口转化率 · 开单率 · 按使用人" onClick={()=>onNavigate('assessment')}/><Task title="查看消费业绩" note="客服贡献 · 开单记录 · 客户付款" onClick={()=>onNavigate('orders')}/><Task title="客服账号管理" note="接待账号与当前持有人" onClick={()=>onNavigate('csAccounts')}/></div></section></div>
 <section className="desk-panel"><div className="desk-section-heading"><h2>本组报粉进度</h2><button className="text-action" onClick={()=>onNavigate('summary')}>查看明细 ›</button></div>{teams?teams.map(t=><div className="desk-progress-row" key={t.teamId}><span><strong>{t.teamName}</strong><small>已报 {t.reportedCount} / 应报 {t.expectedCount}</small></span><progress aria-label={t.teamName+'报粉完成进度'} max={t.expectedCount||1} value={t.reportedCount}/><b>{t.missingCount} 个未报</b></div>):<p className="notice">{loading?'正在读取小组进度':'小组进度暂不可用'}</p>}</section></>}
 </div>;
}

export function AdminWorkbench({onNavigate}:{onNavigate:Navigate}){
 const [data,setData]=useState<Awaited<ReturnType<typeof loadAdminHome>>|null>(null),[loading,setLoading]=useState(true),[tick,setTick]=useState(0);const refresh=()=>setTick(t=>t+1);
 useEffect(()=>{let live=true;setData(null);setLoading(true);loadAdminHome().then(r=>{if(live){setData(r);setLoading(false);}});return()=>{live=false;};},[tick]);
 const users=loaded(data?.users)?.users.filter(u=>!isServiceAccount(u.accountKind)),teams=loaded(data?.teams)?.teams,accounts=loaded(data?.accounts)?.accounts,modules=loaded(data?.modules);
 const noTeam=users?.filter(u=>u.isActive&&u.role==='cs_supervisor'&&!u.managedTeamIds?.length),noAccountTeam=accounts?.filter(a=>a.isActive&&!a.teamId),noHolder=accounts?.filter(a=>a.isActive&&!a.holderName?.trim());const entries=modules?Object.entries(modules.modules):null;
 return <div className="role-desk" aria-busy={loading}><Heading title="后台管理员工作台" caption="账号 · 小组 · 模块配置" loading={loading} refresh={refresh}/><div className="desk-metrics"><Metric label="后台账号" value={users?.length} onClick={()=>onNavigate('people')}/><Metric label="客服小组" value={teams?.length} onClick={()=>onNavigate('people')}/><Metric label="接待账号" value={accounts?.length} onClick={()=>onNavigate('csAccounts')}/><Metric label="已启用模块" value={entries?entries.filter(([,v])=>v).length+' / '+entries.length:'—'} onClick={()=>onNavigate('modules')}/></div><Errors errors={errorsOf([['后台账号',data?.users],['客服小组',data?.teams],['接待账号',data?.accounts],['模块',data?.modules]])} retry={refresh}/>
 <div className="desk-columns"><section className="desk-panel"><h2>配置待完善</h2><div className="desk-task-list"><Task title="主管管理范围" note="为主管分配负责的小组" value={noTeam?noTeam.length+' 个未分配':'—'} attention={!!noTeam?.length} onClick={()=>onNavigate('people')}/><Task title="接待账号归属" note="为在用账号分配客服小组" value={noAccountTeam?noAccountTeam.length+' 个未分组':'—'} attention={!!noAccountTeam?.length} onClick={()=>onNavigate('csAccounts')}/><Task title="账号持有人" note="设置当前负责账号的客服" value={noHolder?noHolder.length+' 个待补':'—'} attention={!!noHolder?.length} onClick={()=>onNavigate('csAccounts')}/></div></section>
 <section className="desk-panel"><h2>常用设置</h2><div className="desk-task-list"><Task title="账号与小组" note="后台账号 · 角色权限 · 主管范围" onClick={()=>onNavigate('people')}/><Task title="客服账号管理" note="平台账号 · 所属小组 · 账号持有人" onClick={()=>onNavigate('csAccounts')}/><Task title="功能模块开关" note="模块状态 · 各岗位可见功能" onClick={()=>onNavigate('modules')}/></div></section></div>
 <details className="desk-panel"><summary>模块启用状态</summary>{entries?.map(([key,enabled])=><div className="desk-status-row" key={key}><span>{modules?.labels[key]??key}</span><b>{enabled?'已启用':'已关闭'}</b></div>)}{!entries&&<p>模块状态暂不可用</p>}</details></div>;
}

type FinanceWork='receipts'|'settlement'|'later'|'material'|'other';
export function FinanceWorkbenchHome({today,payments,error,onOpen,onSalary,onRetry}:{today:string;payments:FinancePayment[]|null;error:string;onOpen:(work:FinanceWork)=>void;onSalary:()=>void;onRetry:()=>void}){
 const active=payments?.filter(p=>!p.voided_at),unknown=active?.some(p=>p.third_party&&cents(p.pendingAmount)===null);
 const pending=active?.filter(p=>{const amount=cents(p.pendingAmount);return p.third_party&&amount!==null&&amount>0n;});
 const receipts=active?.filter(p=>!p.after_sale_charge_id),after=active?.filter(p=>!!p.after_sale_charge_id),todayReceipts=receipts?.filter(p=>p.payment_date===today);
 return <div className="role-desk finance-desk" aria-busy={!payments&&!error}><Heading title="财务工作台" caption={today+' · 录入与核对'}/><Errors errors={error?[error]:[]} retry={onRetry}/><div className="desk-metrics"><Metric label="今日订单收款记录" value={todayReceipts?todayReceipts.length+' 笔':'—'} onClick={()=>onOpen('receipts')}/><Metric label="第三方待结算记录" value={unknown?'待核对':pending?pending.length+' 笔':'—'} onClick={()=>onOpen('settlement')}/><Metric label="全部订单收款记录" value={receipts?receipts.length+' 笔':'—'} onClick={()=>onOpen('receipts')}/><Metric label="全部售后收款记录" value={after?after.length+' 笔':'—'} onClick={()=>onOpen('later')}/></div>
 <div className="desk-columns"><section className="desk-panel"><div className="desk-section-heading"><h2>收款与结算</h2><InfoTip label="财务记录统计口径" text="收款卡片统计已登记且未作废的流水笔数，不代表待审核订单或客户欠款。第三方待结算为仍有待结算余额的代收记录；缺失余额须到明细核对。"/></div><div className="desk-task-list"><Task title="订单收款" note="当日收款与尾款 · 录入与核对" onClick={()=>onOpen('receipts')}/><Task title="第三方结算" note="扣点 · 结汇 · 实际人民币到账" value={unknown?'余额待核对':pending?pending.length+' 笔待结算':'—'} attention={!!pending?.length||!!unknown} onClick={()=>onOpen('settlement')}/><Task title="售后费用收款" note="设计 · 雕刻 · 配货等追加收费" onClick={()=>onOpen('later')}/></div></section>
 <section className="desk-panel"><h2>付款与工资</h2><div className="desk-task-list"><Task title="料子货款结算" note="核对供货成本并登记实际付款" onClick={()=>onOpen('material')}/><Task title="加工与发货支出" note="加工 · 配货 · 证书 · 运费 · 包装" onClick={()=>onOpen('other')}/><Task title="员工工资核算" note="按工种维护基本工资与月度明细" onClick={onSalary}/></div></section></div><details className="desk-panel"><summary>其他财务工具</summary><div className="desk-task-list"><Task title="广告充值与其他付款" note="广告户预存与公司付款记录" onClick={()=>onOpen('other')}/></div></details></div>;
}

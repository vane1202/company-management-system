import {useEffect,useState} from 'react';
import {requestInner} from '../api';
import {newRequestKey} from '../commerceUi';
import type {CompanyExpense} from '../api';
import {InfoTip} from '../InfoTip';
import {toErrorMessage} from '../errors';
import './warehouse-workspace.css';
import './reimbursement-workspace.css';
import '../finance-menu.css';

type Mode = "finance" | "staff" | "supervisor";
type ClaimType = "live_room" | "business" | "welfare" | "office";
type SupervisorSegment = "team" | "mine";

type TeamOption={id:string;name:string};
type LiveRoomOption={id:string;name:string};
type OrderOption={id:string;orderRef:string;customerLabel:string;businessDate:string;amount:string;teamId?:string;teamName?:string};
type Claim={stage?:"supervisor"|"supervisor_returned"|"finance"|"historical";claimType?:ClaimType;welfareCustomer?:string;postedExpenseId?:string;paidAmount?:string;proofIds?:string[];proofs?:string[];supervisorNote?:string;forwardedBy?:string;forwardedAt?:string;liveRoomId?:string;liveRoomName?:string;createdById?:string;createdByRole?:string;ownerRole?:string;id:string;claimant:string;department:string;teamId?:string;orderId?:string;orderRef?:string;customerLabel?:string;orderDate?:string;category:string;purpose:string;amount:string;expenseDate:string;claimDate:string;expenseId:string;receiptRef:string;note:string;status:'pending'|'approved'|'rejected'|'historical';version:number;createdBy:string;reviewNote?:string;reviewedBy?:string};
type Payment={id:string;claimId:string;amount:string;date:string;payee:string;account:string;reference:string};
type Data={state:{claims:Claim[];payments:Payment[]};categories:Record<string,string>;expenses:CompanyExpense[];teams?:TeamOption[];orders?:OrderOption[];liveRooms?:LiveRoomOption[];currentUserId?:string;currentUserName?:string};
type FilePreview={file:File;url:string};

const CLAIM_TYPE_OPTIONS: { value: ClaimType; label: string; short: string; desc: string }[] = [
 { value: "live_room", label: "直播间费用", short: "直播间费用", desc: "直播间日常消耗、道具或临时运营费用，不计入单笔订单成本。" },
 { value: "business", label: "业务类 · 关联订单", short: "业务类", desc: "财务确认后自动计入所选订单成本，不重复进入供应商付款台账。" },
 { value: "welfare", label: "业务类 · 未开单福利品", short: "未开单福利品", desc: "客户暂未开单先发福利品，财务确认后记在客服名下并从当月订单总净利润扣除；客户开单后可转绑至新订单。" },
 { value: "office", label: "办公类", short: "办公类", desc: "办公及日常杂项报销，不计入订单成本，也不影响客服业绩与提成。" }
];

const SUPERVISOR_TEAM_STATUSES = ['', '待主管提交', '主管已退回', '待财务核对', '待报销', '部分报销', '已报销', '财务已退回'];
const SUPERVISOR_MINE_STATUSES = ['', '待财务核对', '财务已退回', '待报销', '已报销'];
const FINANCE_STATUSES = ['', '待财务核对', '待报销', '部分报销', '已报销', '财务已退回', '历史待核实'];
const STAFF_STATUSES = ['', '待主管提交', '主管已退回', '待财务核对', '待报销', '部分报销', '已报销', '财务已退回'];

function resolveClaimType(claim: Claim): ClaimType {
 if (claim.claimType === "live_room" || claim.claimType === "business" || claim.claimType === "welfare" || claim.claimType === "office") return claim.claimType;
 if (claim.liveRoomName || claim.liveRoomId) return "live_room";
 return claim.orderId || claim.expenseId ? "business" : "office";
}
function claimTypeText(type: ClaimType) {
 return type === "live_room" ? "直播间费用" : type === "business" ? "业务类" : type === "welfare" ? "未开单福利品" : "办公类";
}
function claimTypeBadgeClass(type: ClaimType) {
 return type === "live_room" || type === "business" ? "is-jade" : type === "welfare" ? "is-gold" : "is-muted";
}
function claimProofUrls(claim: Claim): string[] {
 return demo ? (claim.proofs ?? []) : (claim.proofIds ?? []).map(id => `/api/finance/reimbursements/proofs/${id}`);
}
const cents=(value:string)=>{const [a,b='']=value.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
const amount=(v:bigint)=>`${v/100n}.${String(v%100n).padStart(2,'0')}`;
const yuan=(v:bigint)=>'¥'+Number(amount(v)).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const demo = import.meta.env.MODE==='demo';
async function request(body?:object):Promise<Data>{if(!demo)return requestInner<Data>('/api/finance/reimbursements',body?{method:'POST',body:JSON.stringify(body)}:{});const r=await fetch('/api/demo/reimbursements',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'报销数据读取失败');return data;}

function readImage(file: File): Promise<string> {
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error("无法读取凭证图片"));
  reader.onload=()=>resolve(String(reader.result));
  reader.readAsDataURL(file);
 });
}

function isSupportedImageFile(file: File): boolean {
 if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) return true;
 return /\.(jpe?g|png|webp)$/i.test(file.name);
}

function Proofs({claim}:{claim:Claim}){
 const urls=claimProofUrls(claim);
 return <section><h3>付款或账单截图</h3>{urls.length
  ? <div className="reim-proofs">{urls.map((url,i)=><a key={i} href={url} target="_blank" rel="noreferrer"><img loading="lazy" src={url} alt={`凭证 ${i+1}`}/></a>)}</div>
  : <p>{claim.receiptRef&&!claim.receiptRef.startsWith('xlsx:')&&!claim.receiptRef.startsWith('image:')?`历史凭证编号 ${claim.receiptRef}`:'未附截图'}</p>}</section>;
}

export default function ReimbursementWorkspace({today,onBack,mode="finance",currentUserId,currentUserName}:{today:string;onBack?:()=>void;mode?:Mode;currentUserId?:string;currentUserName?:string}){
 const finance=mode==="finance", staff=mode==="staff", supervisor=mode==="supervisor";
 const title=finance?"费用报销":staff?"垫付报销":"本组报销";
 const [supervisorTab,setSupervisorTab]=useState<SupervisorSegment>("team");
 const [previews,setPreviews]=useState<FilePreview[]>([]);
 const [fileError,setFileError]=useState("");
 const [orderSearch,setOrderSearch]=useState("");
 const [detailTeamId,setDetailTeamId]=useState("");
 const [bindOrderId,setBindOrderId]=useState("");
 const [bindOrderSearch,setBindOrderSearch]=useState("");
 const [resubmitTarget,setResubmitTarget]=useState<Claim|null>(null);
 const blank=(defaultTeamId='')=>({
  claimant:'',
  department:'',
  teamId:defaultTeamId,
  claimType:(staff?'business':supervisor?'live_room':'office') as ClaimType,
  welfareCustomer:'',
  orderId:'',
  liveRoomId:'',
  liveRoomName:'',
  category:staff?'advance':'temporary',
  purpose:'',
  amount:'',
  expenseDate:today,
  claimDate:today,
  expenseId:'',
  note:'',
  requestKey:newRequestKey()
 });
 const [data,setData]=useState<Data|null>(null),[form,setForm]=useState(blank),[creating,setCreating]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<Claim|null>(null),[detail,setDetail]=useState<Claim|null>(null),[reason,setReason]=useState('');
 const [payment,setPayment]=useState({amount:'',date:today,payee:'',account:'',reference:''});
 const [filters,setFilters]=useState({search:'',claimType:'',category:'',status:'',from:'',to:''});
 const [staffFiltersOpen,setStaffFiltersOpen]=useState(false);

 function clearPreviews(items: FilePreview[]){
  items.forEach(item=>{try{URL.revokeObjectURL(item.url);}catch{/* ignore */}});
 }

 useEffect(()=>{
  return ()=>{clearPreviews(previews);};
 },[previews]);

 function resetFileSelections(){
  setPreviews(prev=>{clearPreviews(prev);return [];});
  setFileError("");
 }

 useEffect(()=>{
  const close=(event:KeyboardEvent)=>{
   if(event.key==="Escape"&&!busy){
    setCreating(false);
    setResubmitTarget(null);
    setSelected(null);
    setDetail(null);
   }
  };
  document.addEventListener("keydown",close);
  return()=>document.removeEventListener("keydown",close);
 },[busy]);

 async function refresh(){setError('');try{setData(await request());}catch(e){setError(toErrorMessage(e));}}
 useEffect(()=>{void refresh();},[]);

 async function act(body:object,success:string){
  if(busy)return false;
  setBusy(true);setError('');setMessage('');
  try{
   const nextData=await request(body);
   setData(nextData);
   setSelected(null);
   if(detail){
    const updated=nextData.state.claims.find(c=>c.id===detail.id);
    if(updated){
     setDetail(updated);
     setDetailTeamId(updated.teamId||'');
     setBindOrderId('');
     setBindOrderSearch('');
    }else{
     setDetail(null);
    }
   }
   setMessage(success);
   return true;
  }catch(e){
   setError(toErrorMessage(e));
   return false;
  }finally{
   setBusy(false);
  }
 }

 const teamOptions=data?.teams??[];
 const orderOptions=data?.orders??[];
 const liveRoomOptions=data?.liveRooms??[];
 const filteredOrders=orderOptions.filter(o=>!orderSearch.trim()||`${o.orderRef} ${o.customerLabel} ${o.businessDate}`.toLowerCase().includes(orderSearch.trim().toLowerCase()));
 const filteredBindOrders=orderOptions.filter(o=>!bindOrderSearch.trim()||`${o.orderRef} ${o.customerLabel} ${o.businessDate}`.toLowerCase().includes(bindOrderSearch.trim().toLowerCase()));
 const paid=(claim:Claim)=>claim.paidAmount!==undefined?cents(claim.paidAmount):(data?.state.payments||[]).filter(p=>p.claimId===claim.id).reduce((n,p)=>n+cents(p.amount),0n);
 const state=(claim:Claim)=>claim.stage==='historical'?'历史待核实':claim.stage==='supervisor'?'待主管提交':claim.stage==='supervisor_returned'?'主管已退回':claim.status==='pending'?'待财务核对':claim.status==='rejected'?'财务已退回':paid(claim)===cents(claim.amount)?'已报销':paid(claim)>0n?'部分报销':'待报销';

 const resolvedUserId=currentUserId||data?.currentUserId||'';
 const resolvedUserName=currentUserName||data?.currentUserName||'';
 const isOwnSupervisorClaim=(claim:Claim)=>{
  if(claim.createdByRole==='cs_supervisor'||claim.ownerRole==='cs_supervisor')return true;
  if(resolvedUserId&&claim.createdById&&claim.createdById===resolvedUserId)return true;
  if(!claim.createdByRole&&!claim.ownerRole&&resolvedUserName&&claim.createdBy===resolvedUserName&&claim.stage!=='supervisor'&&claim.stage!=='supervisor_returned')return true;
  return false;
 };

 const visibleBaseClaims=(data?.state.claims||[]).filter(c=>{
  if(!supervisor)return true;
  const own=isOwnSupervisorClaim(c);
  return supervisorTab==='mine'?own:!own;
 });

 const validRange=!filters.from||!filters.to||filters.from<=filters.to;
 const rows=visibleBaseClaims.filter(c=>validRange&&(!filters.claimType||resolveClaimType(c)===filters.claimType)&&(!filters.category||c.category===filters.category)&&(!filters.status||state(c)===filters.status)&&(!filters.from||c.expenseDate>=filters.from)&&(!filters.to||c.expenseDate<=filters.to)&&`${c.claimant} ${c.department} ${c.purpose} ${c.liveRoomName??''} ${c.orderRef??''} ${c.customerLabel??''} ${c.welfareCustomer??''} ${c.receiptRef}`.toLowerCase().includes(filters.search.trim().toLowerCase()));
 const badgeClass=(s:string)=>s==='已报销'?'is-jade':s==='待财务核对'||s==='待主管提交'||s==='历史待核实'||s==='待报销'||s==='部分报销'?'is-gold':'is-muted';
 const canEditTeam=(claim:Claim)=>teamOptions.length>0&&(finance||(supervisor&&!isOwnSupervisorClaim(claim))||(staff&&(claim.stage==='supervisor'||claim.stage==='supervisor_returned')));
 const canBindOrder=(claim:Claim)=>resolveClaimType(claim)==='welfare'&&!claim.orderId&&claim.status!=='rejected'&&claim.stage!=='historical'&&orderOptions.length>0;
 const activeTypeMeta=CLAIM_TYPE_OPTIONS.find(o=>o.value===form.claimType)??CLAIM_TYPE_OPTIONS[0];
 const staffFilterCount=[filters.claimType,filters.category,filters.from,filters.to].filter(Boolean).length;
 const statusPills=finance?FINANCE_STATUSES:supervisor?(supervisorTab==='mine'?SUPERVISOR_MINE_STATUSES:SUPERVISOR_TEAM_STATUSES):STAFF_STATUSES;
 const supervisorMineCount=supervisor?(data?.state.claims||[]).filter(isOwnSupervisorClaim).length:0;
 const supervisorPendingTeamCount=supervisor?(data?.state.claims||[]).filter(c=>!isOwnSupervisorClaim(c)&&c.stage==='supervisor').length:0;

 function openSupervisorCreate(){
  const defaultTeam=teamOptions.length?teamOptions[0].id:'';
  setResubmitTarget(null);
  setForm(blank(defaultTeam));
  setOrderSearch('');
  resetFileSelections();
  setSelected(null);
  setDetail(null);
  setError('');
  setMessage('');
  setCreating(true);
 }

 function openSupervisorResubmit(claim:Claim){
  const ct=resolveClaimType(claim);
  setResubmitTarget(claim);
  setForm({
   claimant:claim.claimant,
   department:claim.department,
   teamId:claim.teamId||(teamOptions[0]?.id||''),
   claimType:ct,
   welfareCustomer:claim.welfareCustomer||'',
   orderId:claim.orderId||'',
   liveRoomId:claim.liveRoomId||claim.liveRoomName||'',
   liveRoomName:claim.liveRoomName||claim.liveRoomId||'',
   category:claim.category||'temporary',
   purpose:claim.purpose||'',
   amount:claim.amount||'',
   expenseDate:claim.expenseDate||today,
   claimDate:today,
   expenseId:'',
   note:claim.note||'',
   requestKey:newRequestKey()
  });
  setOrderSearch('');
  resetFileSelections();
  setSelected(null);
  setDetail(null);
  setError('');
  setMessage('');
  setCreating(true);
 }

 function handleSelectProofFiles(incomingList: FileList | null){
  const incoming=Array.from(incomingList??[]);
  if(!incoming.length)return;
  const limit=demo?1024*1024:5*1024*1024;
  if(previews.length+incoming.length>3||incoming.some(file=>!isSupportedImageFile(file)||file.size>limit)){
   setFileError(demo?"演示最多上传 3 张 JPG、PNG 或 WebP，每张不超过 1 MB":"最多上传 3 张 JPG、PNG 或 WebP，每张不超过 5 MB");
   return;
  }
  const added=incoming.map(file=>({file,url:URL.createObjectURL(file)}));
  setFileError("");
  setPreviews(prev=>[...prev,...added]);
 }

 function switchSupervisorTab(nextTab:SupervisorSegment){
  setSupervisorTab(nextTab);
  const allowed=nextTab==='mine'?SUPERVISOR_MINE_STATUSES:SUPERVISOR_TEAM_STATUSES;
  setFilters(f=>allowed.includes(f.status)?f:{...f,status:''});
 }

 const existingResubmitProofs=resubmitTarget?claimProofUrls(resubmitTarget):[];
 const hasSubmitProofs=previews.length>0||(!!resubmitTarget&&existingResubmitProofs.length>0);

 return <div className={"warehouse-workspace reimbursement-workspace"+(staff?" is-staff":"")+(supervisor?" is-supervisor":"")} aria-busy={busy}>
  <header className="commerce-heading">
   <div>
    <h1>{title} {finance&&<InfoTip label="报销统计口径" text="记录公司日常运营成本之外的费用报销。新增报销费用独立汇总，不自动计入运营成本；关联已有成本的报销仅跟踪待付和实际付款，不新增一笔成本。申请金额、核定待报销和实际报销分别统计，以下汇总跟随费用发生日期与筛选。"/>}</h1>
    {!staff&&<small>{finance?"费用登记 · 核对确认 · 报销付款":supervisorTab==="mine"?"查看本人发起的费用报销，直达财务核对。":"核对本组申请与凭证，确认后提交财务。"}</small>}
   </div>
   <div className="actions">
    {data&&supervisor&&<button type="button" disabled={busy} onClick={openSupervisorCreate}>+ 填报费用</button>}
    {data&&!supervisor&&<button type="button" disabled={busy} onClick={()=>{const defaultTeam=staff&&teamOptions.length===1?teamOptions[0].id:'';setResubmitTarget(null);setCreating(true);setForm(blank(defaultTeam));setOrderSearch('');resetFileSelections();setSelected(null);setDetail(null);setMessage('');}}>{staff?"＋ 申请报销":"＋ 登记报销"}</button>}
    {onBack&&<button type="button" className="secondary" onClick={onBack}>返回</button>}
    <button type="button" className="secondary" disabled={busy} onClick={refresh}>刷新</button>
   </div>
  </header>

  {supervisor&&<div className="reim-seg-tabs" role="tablist" aria-label="本组报销视图切换">
   <button type="button" role="tab" aria-selected={supervisorTab==="team"} className={supervisorTab==="team"?"is-active":""} onClick={()=>switchSupervisorTab("team")}>
    本组审核{supervisorPendingTeamCount>0&&<em className="reim-seg-count">{supervisorPendingTeamCount}</em>}
   </button>
   <button type="button" role="tab" aria-selected={supervisorTab==="mine"} className={supervisorTab==="mine"?"is-active":""} onClick={()=>switchSupervisorTab("mine")}>
    我的填报{supervisorMineCount>0&&<em className="reim-seg-count">{supervisorMineCount}</em>}
   </button>
  </div>}

  {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="ok" role="status">{message}</p>}
  {!data?<p role="status">正在读取报销台账…</p>:<>
  {finance&&<div className="wh-kpis"><article><span>报销申请额</span><b>{yuan(rows.filter(c=>c.stage!=='historical'&&c.status!=='rejected').reduce((n,c)=>n+cents(c.amount),0n))}</b></article><article><span>已核对待报销</span><b>{yuan(rows.filter(c=>c.status==='approved').reduce((n,c)=>n+cents(c.amount)-paid(c),0n))}</b></article><article><span>实际已报销</span><b>{yuan(rows.reduce((n,c)=>n+paid(c),0n))}</b></article></div>}
  <section className="card">
   <div className="fin-toolbar">
    <div className={(staff||supervisor)?"fin-pills cs-status-scroll":"fin-pills"} role="group" aria-label="报销状态筛选">
     {statusPills.map(v=><button key={v||'all'} type="button" className="fin-pill" aria-pressed={filters.status===v} onClick={()=>setFilters(f=>({...f,status:v}))}>{v||'全部'}</button>)}
    </div>
    {(staff||supervisor)?<div className="cs-search-line"><input aria-label="查找报销" type="search" placeholder={supervisor&&supervisorTab==='mine'?"直播间、事由或类别":"报销人、部门、事由或凭证"} value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/><button type="button" className="secondary cs-icon-btn" aria-expanded={staffFiltersOpen} onClick={()=>setStaffFiltersOpen(open=>!open)}>{staffFilterCount?`筛选 · ${staffFilterCount}`:"筛选 ▾"}</button></div>:<input aria-label="查找报销" type="search" placeholder="报销人、部门、直播间、事由或凭证" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})} style={{maxWidth:260}}/>}
   </div>
   {(!(staff||supervisor)||staffFiltersOpen)&&<div className="reim-filters"><label>报销分类<select value={filters.claimType} onChange={e=>setFilters({...filters,claimType:e.target.value})}><option value="">全部分类</option>{CLAIM_TYPE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label><label>费用类别<select value={filters.category} onChange={e=>setFilters({...filters,category:e.target.value})}><option value="">全部类别</option>{Object.entries(data.categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>费用开始日期<input type="date" max={filters.to||today} value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></label><label>费用结束日期<input type="date" min={filters.from} max={today} value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></label></div>}
   {!validRange&&<p className="error" role="alert">开始日期不能晚于结束日期。</p>}
   {!rows.length&&<p className="empty-state">{supervisor&&supervisorTab==='mine'?"暂无本人填报记录，点击右上角「+ 填报费用」可直达财务核对":"当前没有符合条件的报销记录"}</p>}

   {supervisor&&supervisorTab==='mine'&&rows.length>0&&<div className="reim-my-cards">
    {rows.slice().reverse().map(c=>{
     const st=state(c),ct=resolveClaimType(c),proofCount=c.proofIds?.length||c.proofs?.length||0;
     return <article key={c.id} className="reim-my-card">
      <div className="reim-my-head">
       <div className="reim-my-badges">
        <span className={`fin-badge ${claimTypeBadgeClass(ct)}`}>{claimTypeText(ct)}</span>
        <span className="reim-cat-tag">{data.categories[c.category]||c.category}</span>
        {c.liveRoomName&&<span className="fin-badge is-room">直播间 · {c.liveRoomName}</span>}
       </div>
       <span className={`fin-badge ${badgeClass(st)}`}>{st}</span>
      </div>
      <div className="reim-my-main">
       <p className="reim-my-purpose">{c.purpose}</p>
       <strong className="reim-my-amount fin-num">{yuan(cents(c.amount))}</strong>
      </div>
      <div className="reim-my-meta fin-num">
       <span>费用日期：{c.expenseDate}</span>
       <span>{proofCount?`凭证 ${proofCount} 张`:'无凭证'}</span>
       {c.orderRef&&<span>订单：{c.orderRef}</span>}
      </div>
      {st==='财务已退回'&&c.reviewNote&&<p className="reim-reject-reason">退回原因：{c.reviewNote}</p>}
      <div className="reim-my-actions">
       <button type="button" className="secondary" onClick={()=>{setDetail(c);setDetailTeamId(c.teamId||teamOptions.find(t=>t.name===c.department)?.id||'');setBindOrderId('');setBindOrderSearch('');}}>详情</button>
       {st==='待财务核对'&&<button type="button" className="secondary reim-danger-btn" disabled={busy} onClick={()=>void act({action:'withdraw',id:c.id,version:c.version},'已撤回该笔报销申请')}>撤回</button>}
       {st==='财务已退回'&&<button type="button" disabled={busy} onClick={()=>openSupervisorResubmit(c)}>修改重提</button>}
      </div>
     </article>;
    })}
   </div>}

   {!(supervisor&&supervisorTab==='mine')&&rows.length>0&&<div className="fin-table-wrap"><table className="fin-table"><thead><tr><th>报销人 / 部门</th><th>类别与事由</th><th>费用日期</th><th>{finance?"申请 / 已报销":"申请金额"}</th><th>状态</th><th>操作</th></tr></thead><tbody>
    {rows.slice().reverse().map(c=>{const st=state(c),ct=resolveClaimType(c);return <tr key={c.id}><td><strong>{c.claimant}</strong><span className="fin-cell-sub">{c.department||'未填写'}</span></td><td><span className="reim-type-line"><span className={`fin-badge ${claimTypeBadgeClass(ct)}`}>{claimTypeText(ct)}</span><strong>{data.categories[c.category]}</strong>{c.liveRoomName&&<span className="fin-badge is-room">直播间 · {c.liveRoomName}</span>}</span><span className="fin-cell-sub">{c.purpose}</span>{c.orderRef&&<span className="fin-cell-sub">关联订单：{c.orderRef}{c.customerLabel?` · ${c.customerLabel}`:''}</span>}{ct==='welfare'&&!c.orderRef&&<span className="fin-cell-sub">未开单福利品{c.welfareCustomer?` · 客户 ${c.welfareCustomer}`:''}</span>}</td><td className="fin-num">{c.expenseDate}<span className="fin-cell-sub">{(c.proofIds?.length||c.proofs?.length)?`凭证 ${c.proofIds?.length||c.proofs?.length} 张`:c.stage==='historical'?'无截图':'—'}</span></td><td className="fin-num"><strong>{yuan(cents(c.amount))}</strong>{finance&&c.stage!=='historical'&&<span className="fin-cell-sub">已付 {yuan(paid(c))}</span>}</td><td><span className={`fin-badge ${badgeClass(st)}`}>{st}</span></td><td><div className="fin-row-actions"><button type="button" className="secondary" onClick={()=>{setDetail(c);setDetailTeamId(c.teamId||teamOptions.find(t=>t.name===c.department)?.id||'');setBindOrderId('');setBindOrderSearch('');}}>详情</button>{supervisor&&c.stage==='supervisor'&&<button type="button" onClick={()=>{setSelected(c);setReason('');}}>处理</button>}{finance&&c.stage!=='historical'&&c.status==='pending'&&<button type="button" onClick={()=>{setSelected(c);setReason('');}}>核对</button>}{finance&&c.stage!=='historical'&&c.status==='approved'&&paid(c)<cents(c.amount)&&<button type="button" onClick={()=>{setSelected(c);setPayment({amount:amount(cents(c.amount)-paid(c)),date:today,payee:c.claimant,account:'',reference:''});}}>付款</button>}</div></td></tr>;})}
   </tbody></table></div>}
  </section>

  {creating&&supervisor&&<div className="reim-sheet-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy){setCreating(false);setResubmitTarget(null);}}}><div className="reim-sheet-panel" role="dialog" aria-modal="true" aria-label={resubmitTarget?"修改重提费用报销":"填报费用"}><header className="fin-drawer-head"><h2>{resubmitTarget?"修改重提费用报销":"填报费用"}</h2><button type="button" className="secondary" disabled={busy} onClick={()=>{setCreating(false);setResubmitTarget(null);}}>关闭</button></header><form className="fin-drawer-body reimbursement-form" id="reim-supervisor-form" onSubmit={async e=>{
   e.preventDefault();
   if(!hasSubmitProofs||fileError||busy)return;
   try{
    const proofs=previews.length?await Promise.all(previews.map(p=>readImage(p.file))):undefined;
    const payload=resubmitTarget
     ? {action:'resubmit',id:resubmitTarget.id,version:resubmitTarget.version,claimType:form.claimType,welfareCustomer:form.welfareCustomer,orderId:form.orderId,liveRoomId:form.liveRoomId,liveRoomName:form.liveRoomName,category:form.category,purpose:form.purpose,amount:form.amount,expenseDate:form.expenseDate,note:form.note,requestKey:form.requestKey,...(proofs?{proofs}:{})}
     : {action:'create',teamId:form.teamId,claimType:form.claimType,welfareCustomer:form.welfareCustomer,orderId:form.orderId,liveRoomId:form.liveRoomId,liveRoomName:form.liveRoomName,category:form.category,purpose:form.purpose,amount:form.amount,expenseDate:form.expenseDate,note:form.note,requestKey:form.requestKey,proofs:proofs||[]};
    const ok=await act(payload,resubmitTarget?'已重新提交至待财务核对':'已提交至待财务核对');
    if(ok){
     setCreating(false);
     setResubmitTarget(null);
     setForm(blank(teamOptions[0]?.id||''));
     resetFileSelections();
     setSupervisorTab('mine');
    }
   }catch(err){
    setFileError(toErrorMessage(err));
   }
  }}>
   <p className="reim-supervisor-tip">主管填报将直接提交至『待财务核对』，无需二次初审。</p>
   {resubmitTarget&&resubmitTarget.reviewNote&&<p className="reim-reject-reason">财务退回原因：{resubmitTarget.reviewNote}</p>}
   {error&&<p className="error" role="alert">{error}</p>}
   <div className="reim-grid-2">
    <label>报销分类<select aria-label="主管报销分类" value={form.claimType} disabled={busy} onChange={e=>{const nextType=e.target.value as ClaimType;setForm(f=>({...f,claimType:nextType,orderId:nextType==='business'?f.orderId:'',welfareCustomer:nextType==='welfare'?f.welfareCustomer:''}));}}>{CLAIM_TYPE_OPTIONS.map(opt=><option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></label>
    <label>关联直播间（选填）<select aria-label="关联直播间" value={form.liveRoomId} disabled={busy} onChange={e=>{const val=e.target.value;const matched=liveRoomOptions.find(r=>r.id===val||r.name===val);setForm(f=>({...f,liveRoomId:val,liveRoomName:matched?.name||val}));}}><option value="">不关联直播间</option>{liveRoomOptions.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
   </div>
   {form.claimType==='business'&&<label className="wh-full">关联订单（必选）{orderOptions.length>8&&<input type="search" aria-label="筛选订单" placeholder="按订单号或客户称呼筛选…" value={orderSearch} onChange={e=>setOrderSearch(e.target.value)} style={{marginBottom:6}}/>}<select aria-label="报销关联订单" required value={form.orderId} disabled={busy} onChange={e=>setForm(f=>({...f,orderId:e.target.value}))}><option value="">请选择关联订单</option>{filteredOrders.map(o=><option key={o.id} value={o.id}>{o.orderRef} · {o.customerLabel||'未登记称呼'} · {o.businessDate} · ¥{o.amount}</option>)}</select></label>}
   {form.claimType==='welfare'&&<label className="wh-full">福利品对应客户（可选）<input aria-label="福利品对应客户" maxLength={128} placeholder="例如：客户称呼或微信备注" value={form.welfareCustomer} onChange={e=>setForm(f=>({...f,welfareCustomer:e.target.value}))}/></label>}
   <div className="reim-grid-2">
    <label>费用类别<select aria-label="费用类别" value={form.category} disabled={busy} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{Object.entries(data.categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label>费用发生日期<input aria-label="费用发生日期" className="fin-num" type="date" required max={today} disabled={busy} value={form.expenseDate} onChange={e=>setForm(f=>({...f,expenseDate:e.target.value}))}/></label>
   </div>
   <label>报销金额 (¥)<input aria-label="报销金额" className="fin-num" type="text" required inputMode="decimal" placeholder="0.00" disabled={busy} value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/></label>
   <label>事由说明<textarea aria-label="事由说明" required maxLength={500} placeholder="请填写费用用途、明细或说明" disabled={busy} value={form.purpose} onChange={e=>setForm(f=>({...f,purpose:e.target.value}))}/></label>
   <div className="reim-proof-upload">
    <label>报销凭证截图<input type="file" accept="image/*" multiple disabled={busy} onChange={e=>{handleSelectProofFiles(e.currentTarget.files);e.currentTarget.value="";}}/></label>
    <small>{resubmitTarget?"可保留原凭证，或重新选择最多 3 张 JPG/PNG/WebP 图片替换。":"支持微信选图或拍照，最多 3 张 JPG/PNG/WebP。"}</small>
    {previews.length>0&&<div className="reim-thumb-grid">{previews.map((item,i)=><div key={item.url} className="reim-thumb-item"><img src={item.url} alt={`待上传凭证 ${i+1}`}/><button type="button" className="secondary" disabled={busy} onClick={()=>{setPreviews(prev=>{const target=prev[i];if(target)try{URL.revokeObjectURL(target.url);}catch{/* ignore */}return prev.filter((_,j)=>j!==i);});setFileError("");}}>移除</button></div>)}</div>}
    {resubmitTarget&&!previews.length&&existingResubmitProofs.length>0&&<div className="reim-thumb-grid">{existingResubmitProofs.map((url,i)=><div key={i} className="reim-thumb-item"><img src={url} alt={`原凭证 ${i+1}`}/><span>已保留原凭证</span></div>)}</div>}
    {fileError&&<p role="alert" className="error">{fileError}</p>}
   </div>
   <label>补充备注（选填）<textarea maxLength={1000} disabled={busy} value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/></label>
  </form><footer className="fin-drawer-foot"><button type="button" className="secondary" disabled={busy} onClick={()=>{setCreating(false);setResubmitTarget(null);}}>取消</button><button type="submit" form="reim-supervisor-form" disabled={busy||!hasSubmitProofs}>提交财务审核</button></footer></div></div>}

  {creating&&!supervisor&&<div className="fin-drawer-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)setCreating(false);}}><div className="fin-drawer-panel" role="dialog" aria-modal="true" aria-label="登记报销"><header className="fin-drawer-head"><h2>{staff?"申请售后垫付报销":"登记报销"}</h2><button type="button" className="secondary" disabled={busy} onClick={()=>setCreating(false)}>关闭</button></header><form className="fin-drawer-body reimbursement-form" id="reim-create-form" onSubmit={async e=>{e.preventDefault();if(!previews.length||fileError||busy)return;try{const proofs=await Promise.all(previews.map(p=>readImage(p.file)));if(await act({action:'create',...form,proofs},staff?'已提交本组主管':'报销已登记，等待核对确认')){setCreating(false);setForm(blank());resetFileSelections();}}catch(e){setFileError(toErrorMessage(e));}}}>
   {error&&<p className="error" role="alert">{error}</p>}<div className="wh-fields">
   <div className="wh-full"><span className="reim-section-label">报销分类</span><div className="reim-type-picker" role="group" aria-label="报销分类">{CLAIM_TYPE_OPTIONS.map(opt=><button key={opt.value} type="button" className={`reim-type-btn${form.claimType===opt.value?' is-active':''}`} aria-pressed={form.claimType===opt.value} disabled={busy} onClick={()=>setForm(f=>({...f,claimType:opt.value,orderId:opt.value==='business'?f.orderId:'',expenseId:opt.value==='business'?f.expenseId:'',welfareCustomer:opt.value==='welfare'?f.welfareCustomer:'',category:staff?(opt.value==='office'?'other':'advance'):(opt.value==='business'?'advance':f.category)}))}>{opt.label}</button>)}</div><small>{activeTypeMeta.desc}</small></div>
   {finance&&<>{([['claimant','报销人'],['department','部门／小组']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={'报销'+label} required={key==='claimant'} maxLength={key==='department'?64:128} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   <label>费用类别<select aria-label="报销费用类别" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{Object.entries(data.categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>关联直播间（可选）<select aria-label="报销关联直播间" value={form.liveRoomId} onChange={e=>{const val=e.target.value;const matched=liveRoomOptions.find(r=>r.id===val||r.name===val);setForm(f=>({...f,liveRoomId:val,liveRoomName:matched?.name||val}));}}><option value="">不关联直播间</option>{liveRoomOptions.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
   {form.claimType==='business'&&<label>关联已登记费用（可选）<select aria-label="报销关联费用" value={form.expenseId} onChange={e=>{const expense=data.expenses.find(x=>x.id===e.target.value);setForm({...form,expenseId:e.target.value,orderId:expense?'':form.orderId,...(expense?{amount:expense.pending_cny!,purpose:expense.label,category:'advance'}:{})});}}><option value="">不关联已有费用（按下方所选订单自动入账）</option>{data.expenses.map(e=><option key={e.id} value={e.id}>{e.order_ref} · {e.label} · 待付 {e.pending_cny}</option>)}</select><small>原费用已经入账时关联原记录，避免重复计入成本。</small></label>}</>}
   {staff&&<>
    <label>所属客服组别<select aria-label="报销所属客服组别" required value={form.teamId} disabled={teamOptions.length<2||busy} onChange={e=>setForm({...form,teamId:e.target.value})}>{teamOptions.length!==1&&<option value="">{teamOptions.length?"请选择客服组别":"当前账号未分配小组，请联系管理员"}</option>}{teamOptions.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><small>提交后将流转至所选小组主管核对。</small></label>
   </>}
   {form.claimType==='business'&&!form.expenseId&&<label className="wh-full">关联订单（必选）{orderOptions.length>8&&<input type="search" aria-label="筛选订单" placeholder="按订单号或客户称呼筛选…" value={orderSearch} onChange={e=>setOrderSearch(e.target.value)} style={{marginBottom:6}}/>}<select aria-label="报销关联订单" required value={form.orderId} onChange={e=>{const nextOrderId=e.target.value;const matched=orderOptions.find(o=>o.id===nextOrderId);const matchedTeam=staff&&matched?.teamId&&teamOptions.some(t=>t.id===matched.teamId)?matched.teamId:form.teamId;setForm({...form,orderId:nextOrderId,teamId:matchedTeam});}}><option value="">请选择关联订单</option>{filteredOrders.map(o=><option key={o.id} value={o.id}>{o.orderRef} · {o.customerLabel||'未登记称呼'} · {o.businessDate} · ¥{o.amount}</option>)}</select><small>财务确认后自动计入该订单成本；若客户尚未开单请切换为「业务类 · 未开单福利品」。</small></label>}
   {form.claimType==='welfare'&&<label className="wh-full">福利品对应客户（可选）<input aria-label="福利品对应客户" maxLength={128} placeholder="例如：客户称呼或微信备注，便于后续开单转绑" value={form.welfareCustomer} onChange={e=>setForm({...form,welfareCustomer:e.target.value})}/><small>暂未开单先发福利品，财务确认后从当月订单总净利润扣除；客户开单后可在详情中转绑订单。</small></label>}
   {([['amount','申请报销金额 · ¥'],['expenseDate','费用发生日期'],['claimDate','报销登记日期']] as const).filter(([key])=>finance||key!=='claimDate').map(([key,label])=><label key={key}>{label}<input required className="fin-num" aria-label={'报销'+label} maxLength={128} type={key.endsWith('Date')?'date':'text'} max={key.endsWith('Date')?today:undefined} inputMode={key==='amount'?'decimal':undefined} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   <div className="wh-full"><label>上传凭证<input type="file" accept="image/*" multiple disabled={busy} onChange={e=>{handleSelectProofFiles(e.currentTarget.files);e.currentTarget.value="";}}/></label><small>上传付款截图或账单截图。</small>{previews.map((item,i)=><div key={item.url} className="reim-proof-file"><span>{item.file.name}</span><button className="secondary" type="button" disabled={busy} onClick={()=>{setPreviews(prev=>{const target=prev[i];if(target)try{URL.revokeObjectURL(target.url);}catch{/* ignore */}return prev.filter((_,j)=>j!==i);});setFileError("");}}>移除</button></div>)}{fileError&&<p role="alert" className="error">{fileError}</p>}</div>
   <label className="wh-full">报销事由<textarea aria-label="报销事由" required maxLength={500} value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})}/></label><label className="wh-full">备注<textarea maxLength={1000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label></div>
  </form><footer className="fin-drawer-foot"><button type="button" className="secondary" disabled={busy} onClick={()=>setCreating(false)}>取消</button><button type="submit" form="reim-create-form" disabled={busy||!previews.length}>{staff?"提交主管":"保存报销登记"}</button></footer></div></div>}

  {detail&&<div className="fin-drawer-backdrop" onClick={e=>{if(e.target===e.currentTarget)setDetail(null);}}><div className="fin-drawer-panel" role="dialog" aria-modal="true" aria-label="报销详情"><header className="fin-drawer-head"><h2>报销详情 · {detail.claimant}</h2><button type="button" className="secondary" onClick={()=>setDetail(null)}>关闭</button></header><div className="fin-drawer-body"><dl className="fin-detail-dl"><div><dt>状态</dt><dd><span className={`fin-badge ${badgeClass(state(detail))}`}>{state(detail)}</span></dd></div><div><dt>报销分类</dt><dd><span className={`fin-badge ${claimTypeBadgeClass(resolveClaimType(detail))}`}>{claimTypeText(resolveClaimType(detail))}</span></dd></div><div><dt>费用类别</dt><dd>{data.categories[detail.category]}</dd></div><div><dt>申请金额</dt><dd className="fin-num">{yuan(cents(detail.amount))}</dd></div>{detail.stage!=='historical'&&<div><dt>已报销 / 待报销</dt><dd className="fin-num">{yuan(paid(detail))}{detail.status==='approved'?` / ${yuan(cents(detail.amount)-paid(detail))}`:''}</dd></div>}<div><dt>客服组别</dt><dd>{detail.department||'未填写'}</dd></div>{detail.liveRoomName&&<div><dt>关联直播间</dt><dd><span className="fin-badge is-room">{detail.liveRoomName}</span></dd></div>}<div><dt>关联订单</dt><dd>{detail.orderRef?`${detail.orderRef}${detail.customerLabel?` · ${detail.customerLabel}`:''}${detail.orderDate?`（${detail.orderDate}）`:''}`:resolveClaimType(detail)==='welfare'?`未开单福利品${detail.welfareCustomer?` · ${detail.welfareCustomer}`:''}`:'未关联订单'}</dd></div><div><dt>费用 / 登记日期</dt><dd className="fin-num">{detail.expenseDate} / {detail.claimDate}</dd></div><div><dt>经办人</dt><dd>{detail.createdBy}</dd></div></dl>{canBindOrder(detail)&&<section className="reim-bind-box"><h3>客户已开单 · 转绑至新订单</h3><p className="notice">转绑后分类自动转为「业务类」，{detail.status==='approved'?'并立即计入该订单成本，不再从月度总净利润单独扣减。':'财务确认后将计入该订单成本。'}</p>{orderOptions.length>8&&<input type="search" aria-label="筛选转绑订单" placeholder="按订单号或客户称呼筛选…" value={bindOrderSearch} onChange={e=>setBindOrderSearch(e.target.value)}/>}<div className="reim-bind-row"><select aria-label="选择转绑订单" value={bindOrderId} disabled={busy} onChange={e=>setBindOrderId(e.target.value)}><option value="">请选择新订单</option>{filteredBindOrders.map(o=><option key={o.id} value={o.id}>{o.orderRef} · {o.customerLabel||'未登记称呼'} · {o.businessDate} · ¥{o.amount}</option>)}</select><button type="button" disabled={busy||!bindOrderId} onClick={()=>void act({action:'bindOrder',id:detail.id,version:detail.version,orderId:bindOrderId},'已转绑至所选订单')}>确认转绑</button></div></section>}{canEditTeam(detail)&&<div className="reim-filters" style={{marginTop:10}}><label style={{flex:1}}>修改 / 补选客服组别<select aria-label="修改客服组别" value={detailTeamId} disabled={busy} onChange={e=>setDetailTeamId(e.target.value)}><option value="">请选择客服组别</option>{teamOptions.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button type="button" className="secondary" disabled={busy||!detailTeamId||detailTeamId===detail.teamId} onClick={()=>void act({action:'updateTeam',id:detail.id,version:detail.version,teamId:detailTeamId},'客服组别已更新')}>保存组别</button></div>}<Proofs claim={detail}/>{detail.forwardedBy&&<p>提交财务：{detail.forwardedBy}</p>}{detail.supervisorNote&&<p>主管退回说明：{detail.supervisorNote}</p>}<p className="notice">{detail.stage==='historical'?'Excel 历史明细，报销人或付款状态以原始记录和财务核对为准。':detail.expenseId?'关联原费用，不重复计入成本。':resolveClaimType(detail)==='live_room'?'直播间日常/运营费用报销，不计入单笔订单成本。':resolveClaimType(detail)==='business'?(detail.postedExpenseId?'已计入关联订单成本（不重复进入供应商付款台账）。':'业务类报销，财务确认后将自动计入关联订单成本。'):resolveClaimType(detail)==='welfare'?(detail.status==='approved'?'未开单福利品已记在客服名下，从当月订单总净利润扣除；客户开单后可在上方转绑至新订单。':'未开单福利品费用，财务确认后从该客服当月订单总净利润扣除；客户开单后可转绑至新订单。'):'办公类报销，不计入订单成本，也不影响客服业绩与提成。'}</p><p><strong>事由：</strong>{detail.purpose}</p>{detail.note&&<p><strong>备注：</strong>{detail.note}</p>}{detail.reviewNote&&<p><strong>核对说明：</strong>{detail.reviewNote}（{detail.reviewedBy}）</p>}{finance&&<><h3>付款记录</h3>{!data.state.payments.filter(p=>p.claimId===detail.id).length?<p className="notice">暂无付款记录。</p>:data.state.payments.filter(p=>p.claimId===detail.id).map(p=><p key={p.id} className="fin-num">{p.date} · {p.payee} · {yuan(cents(p.amount))} · {p.account} · 流水 {p.reference}</p>)}</>}</div></div></div>}

  {selected&&<div className="fin-drawer-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)setSelected(null);}}><div className="fin-drawer-panel" role="dialog" aria-modal="true" aria-label={supervisor?'处理本组报销':selected.status==='pending'?'核对报销':'登记报销付款'}><header className="fin-drawer-head"><h2>{supervisor?'处理本组报销':selected.status==='pending'?'核对报销':'登记报销付款'} · {selected.claimant}</h2><button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(null)}>关闭</button></header><form className="fin-drawer-body reimbursement-form" id="reim-action-form" onSubmit={e=>{e.preventDefault();void act({action:'pay',id:selected.id,version:selected.version,...payment},'报销付款已登记');}}>{error&&<p className="error" role="alert">{error}</p>}<Proofs claim={selected}/><p className="reim-type-line"><span className={`fin-badge ${claimTypeBadgeClass(resolveClaimType(selected))}`}>{claimTypeText(resolveClaimType(selected))}</span>{selected.liveRoomName&&<span className="fin-badge is-room">直播间 · {selected.liveRoomName}</span>}<span>{selected.purpose} · <span className="fin-num">{yuan(cents(selected.amount))}</span></span></p>{selected.orderRef&&<p className="notice">关联订单：{selected.orderRef}{selected.customerLabel?` · ${selected.customerLabel}`:''}</p>}{resolveClaimType(selected)==='welfare'&&!selected.orderRef&&<p className="notice">未开单福利品{selected.welfareCustomer?` · 客户 ${selected.welfareCustomer}`:''}，确认后从该客服当月订单总净利润扣除。</p>}{selected.status==='pending'?<label>{supervisor?'退回说明（提交财务时可留空）':'核对说明'}<textarea required maxLength={500} aria-label="报销核对说明" value={reason} onChange={e=>setReason(e.target.value)}/></label>:<div className="wh-fields">{([['amount','实际报销金额 · ¥'],['date','报销付款日期'],['payee','实际收款人'],['account','公司付款账户'],['reference','付款流水号']] as const).map(([key,label])=><label key={key}>{label}<input required className="fin-num" aria-label={'报销'+label} type={key==='date'?'date':'text'} max={key==='date'?today:undefined} value={payment[key]} onChange={e=>setPayment({...payment,[key]:e.target.value})}/></label>)}</div>}</form><footer className="fin-drawer-foot"><button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(null)}>取消</button>{supervisor?<><button type="button" className="secondary" disabled={busy||!reason.trim()} onClick={()=>void act({action:'supervisorReturn',id:selected.id,version:selected.version,reason},'已退回客服')}>退回客服</button><button type="button" disabled={busy} onClick={()=>void act({action:'forward',id:selected.id,version:selected.version},'已提交财务')}>提交财务</button></>:selected.status==='pending'?<><button type="button" className="secondary" disabled={busy||!reason.trim()} onClick={()=>void act({action:'review',id:selected.id,version:selected.version,decision:'rejected',reason},'报销已退回')}>退回</button><button type="button" disabled={busy||!reason.trim()} onClick={()=>void act({action:'review',id:selected.id,version:selected.version,decision:'approved',reason},'报销已确认，进入待报销')}>确认报销</button></>:<button type="submit" form="reim-action-form" disabled={busy}>保存报销付款</button>}</footer></div></div>}
  <p className="wh-caption">报销独立于日常运营成本汇总。{demo&&'演示试填仅保留在当前浏览器会话。'}</p>
  </>}
 </div>;
}

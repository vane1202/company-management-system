import { yuan } from "./dashboardDisplay";
import { isServiceAccount } from './serviceAccounts';
import { OrderCharges } from "./OrderCharges";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, type Order, type OrderRecord, type User, type CsAccount, type Currency, type Team } from "./api";
import { toErrorMessage } from "./errors";
import { resolveImageMime } from "./imageMime";
import { createRequestGate } from "./requestGate";
import { toast } from "./Toast";
import { labelOrderStatus } from "./labels";
import { currencies, itemKindLabels, expenseLabels, purposeLabels, itemPreview, money, cents, submissionKey, defaultBuyingFee, buyingFeeAfterPriceChange, buyingFeeRestored } from "./commerceUi";

export function Field({label,children}:{label:string;children:ReactNode}){return <label className="row">{label}{children}</label>;}
export function CurrencySelect({value,onChange}:{value:string;onChange:(v:Currency)=>void}){return <select value={value} onChange={e=>onChange(e.target.value as Currency)}>{Object.entries(currencies).map(([v,l])=><option key={v} value={v}>{l}（{v}）</option>)}</select>;}
const REFRESH_AFTER_SAVE_FAILED="已保存，但列表刷新失败，请点刷新";
const isDemo=import.meta.env.MODE==="demo";
const STANDARD_LIVE_ROOMS=[
  { value: "一号直播间", label: "一号直播间（甜甜）", host: "甜甜" },
  { value: "二号直播间", label: "二号直播间（文强）", host: "文强" }
] as const;
const DemoOrderBasicFields=isDemo?lazy(()=>import("./demo/OrderBasicFields")):null;
const freshItem=()=>({kind:"material",label:"",materialRef:"",priceCny:"",buyingFeeCny:"",feeManual:false,sourcingNoSettle:false});

export function OrderWorkspace({today,user,selectedId,onSelectOrder,createOnMount=false,customerName,onOrdersChanged}:{today:string;user:User;selectedId:string;onSelectOrder:(id:string)=>void;createOnMount?:boolean;customerName?:string;onOrdersChanged?:()=>void}) {
  const canFill=user.role==="cs";
  const [orders,setOrders]=useState<Order[]>([]),[accounts,setAccounts]=useState<CsAccount[]>([]),[account,setAccount]=useState("");
  const [filters,setFilters]=useState({from:"",to:"",status:""}),[search,setSearch]=useState("");
  const [error,setError]=useState(""),[loading,setLoading]=useState(true),[createVersion,setCreateVersion]=useState(0);
  const [onlyOutstanding,setOnlyOutstanding]=useState(false);
  const createDrawer=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(canFill&&createOnMount&&!selectedId&&!createDrawer.current?.open)createDrawer.current?.showModal();},[canFill,createOnMount,selectedId]);
  const [newOrderId,setNewOrderId]=useState("");
  const selected=selectedId,previousSelected=useRef(selectedId);
  const gate=useRef(createRequestGate());
  async function load(){const ticket=gate.current.next();setLoading(true);try{const data=await api.orders(account,filters);if(ticket.isCurrent()){setOrders(data.orders);setError("");}}catch(e){if(ticket.isCurrent())setError(toErrorMessage(e));}finally{if(ticket.isCurrent())setLoading(false);}}
  useEffect(()=>{void load();return()=>{gate.current.next();};},[account,filters]);
  useEffect(()=>{if(previousSelected.current&&!selected)void load();previousSelected.current=selected;},[selected]);
  useEffect(()=>{if(!canFill)void api.csAccounts().then(d=>setAccounts(d.accounts)).catch(e=>setError(toErrorMessage(e)));},[canFill]);
  const matching=orders.filter(o=>`${o.orderRef} ${o.customerLabel??""} ${o.wechatId??""} ${o.personaCode??""} ${o.personaName??""} ${o.liveRoomCode??""} ${o.hostName??""} ${o.customerCode??""} ${o.operatorName??""} ${o.projectLine??""} ${o.materialLotNo??""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const outstanding = matching.filter(o => o.hasOpenBalance && !o.cancelled && o.status !== "refunded");
  const visible = onlyOutstanding ? outstanding : matching;
  return <><div className="commerce-workspace workspace-order-list" hidden={!!selected}><header className="commerce-heading"><div><p className="eyebrow">成交 · 收款 · 发货</p><h1>{canFill?"订单填报":"订单档案"}</h1></div><div className="actions"><button className="secondary" onClick={()=>void load()} disabled={loading}>刷新</button>{canFill&&<button type="button" onClick={()=>createDrawer.current?.showModal()}>＋ 登记一笔成交</button>}</div></header>
    {error&&<p role="alert" className="error">{error}</p>}
    {isDemo&&!canFill&&user.role!=="cs_supervisor"&&<details className="card commerce-create"><summary>试填开单卡（不保存）</summary><p className="notice">仅试填虚构内容，不提交数据，不改变订单档案。</p><CreateOrder today={today} operator="演示经办员" onSaved={()=>{}} previewOnly /></details>}
    {canFill&&<dialog ref={createDrawer} className="fill-drawer fill-order-drawer" aria-label="登记一笔成交"><div className="fill-drawer-body"><header className="commerce-line"><h2>登记一笔成交</h2><button type="button" className="secondary" onClick={()=>createDrawer.current?.close()}>关闭</button></header><CreateOrder key={createVersion} customerName={customerName} today={today} operator={isServiceAccount(user.accountKind)?"":user.displayName} onSaved={id=>{setCreateVersion(v=>v+1);createDrawer.current?.close();setNewOrderId(id);onSelectOrder(id);}} /></div></dialog>}
    <section className="card">{canFill&&<div className="fill-pills" role="group" aria-label="订单状态">{['','placed','in_production','shipped','refunded'].map(status=><button type="button" className="secondary" key={status} aria-pressed={filters.status===status} onClick={()=>setFilters({...filters,status})}>{status?labelOrderStatus(status):'全部'}</button>)}<button type="button" className="secondary" aria-pressed={onlyOutstanding} onClick={()=>setOnlyOutstanding(value=>!value)}>待收尾款 {loading||error?"—":outstanding.length} 单</button></div>}<details className="commerce-filters"><summary>筛选订单{filters.from||filters.to||filters.status||account?" · 已设置":""}</summary><div className="grid two"><Field label="成交开始日期"><input type="date" max={today} value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></Field><Field label="成交结束日期"><input type="date" min={filters.from} max={today} value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></Field><Field label="订单状态"><select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">全部</option>{["placed","in_production","shipped","refunded"].map(s=><option key={s} value={s}>{labelOrderStatus(s)}</option>)}</select></Field>{!canFill&&<Field label="归属客服接待账号"><select value={account} onChange={e=>setAccount(e.target.value)}><option value="">全部可见接待账号及原账号</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.wechatId} {a.phoneLabel}</option>)}</select></Field>}</div></details><Field label="查找订单 / 客户称呼 / 接待账号"><input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></Field>
    <p className="notice">{loading?"正在读取…":`${visible.length} 笔订单`} · 成交额为人民币报价，客户付款与公司到账分别记录。</p><div className="commerce-list">{!loading&&!visible.length&&<div className="empty-state"><strong>当前范围暂无订单</strong><p>{onlyOutstanding?"当前筛选范围内没有待收尾款订单。":canFill?"点上方“＋ 登记一笔成交”开始登记。":"可调整筛选日期或状态查看。"}</p></div>}{visible.map(o=>{const cost=o.materialCostCny??o.materialCost;const persona=o.personaName||"人设待补";const roomHost=o.dealChannel==="private"?"客服私推":o.liveRoomCode?(o.hostName?`${o.liveRoomCode}（${o.hostName}）`:o.liveRoomCode):(o.hostName||"直播间待补");const operator=o.operatorName||"客服待补";return <button type="button" className="commerce-record secondary" key={o.id} onClick={()=>onSelectOrder(o.id)}><span><span className="order-card-head"><strong>{o.customerLabel||"未登记称呼"}</strong><span className={`order-status-pill ${o.cancelled?"is-cancelled":""}`}>{o.cancelled?"已跑单":labelOrderStatus(o.status)}</span></span><small>{o.orderRef} · {o.businessDate}{o.hasSourcingNoSettle?" · 含接待（PH）":""}{!o.workflowEnabled?" · 历史简版":""}</small><small>{persona} · {roomHost} · {operator}</small>{(cost||o.materialLotNo)&&<small>本价（白条价） {cost?`¥ ${cost}`:"未登记"}{o.materialLotNo?` · 料号 ${o.materialLotNo}`:""}</small>}</span><span className="commerce-amount">{yuan(o.amount)}<small>查看档案 ›</small></span></button>;})}</div></section>
  </div>{selected&&<OrderDetail initialPayment={selected===newOrderId} onBack={()=>{setNewOrderId("");onSelectOrder("");}} onDeleted={()=>{setNewOrderId("");onOrdersChanged?.();onSelectOrder("");}} onRoomCorrected={onOrdersChanged} key={selected} id={selected} today={today} canFill={canFill} canCancel={canFill||user.role==="cs_supervisor"} canCorrectRoom={user.role==="cs_supervisor"} canDelete={user.role==="boss"||user.role==="cs_supervisor"}/>}</>;

}

export type OrderPracticeDraft = {channel:"live"|"private";businessDate:string;performanceTeamId?:string;performanceTeamName?:string;materialCny:string;feeCny:string;customerCurrency:Currency;customerDue:string;materialRef:string;items:{kind:string;materialRef:string;priceCny:string;buyingFeeCny:string}[]};
export function CreateOrder({today,operator,onSaved,initial,previewOnly=false,registeredRoom,channel,onPractice,customerName,practiceTeams,practiceLabel="记入本次演练业绩",customerLeadId}:{today:string;operator:string;onSaved:(id:string)=>void;initial?:OrderRecord;previewOnly?:boolean;registeredRoom?:{name:string;host:string};channel?:"live"|"private";onPractice?:(draft:OrderPracticeDraft)=>void;practiceLabel?:string;customerName?:string;practiceTeams?:readonly Team[];customerLeadId?:string}) {
  const [dealChannel,setDealChannel]=useState<"live"|"private">(initial?.details?.dealChannel??channel??"live");
  const activeChannel=channel??dealChannel;
  const [form,setForm]=useState({businessDate:today,orderRef:"",customerLabel:"",personaName:"",personaCode:"",liveRoomCode:"",hostName:"",customerCode:"",operatorName:operator,projectLine:"",source:"",note:"",customerCurrency:"CNY" as Currency,customerDue:"",materialCostCny:"",materialLotNo:"",...(initial ? {businessDate:initial.order.business_date,orderRef:initial.order.order_ref,customerLabel:initial.order.customer_label,personaName:initial.details!.personaName,personaCode:initial.details!.personaCode??"",liveRoomCode:initial.details!.liveRoomCode??"",hostName:initial.details!.hostName??"",customerCode:initial.details!.customerCode??"",operatorName:initial.details!.operatorName,projectLine:initial.details!.projectLine??"",source:initial.details!.source,note:initial.order.note??"",customerCurrency:initial.details!.customerCurrency,customerDue:initial.details!.customerDue,materialCostCny:initial.order.material_cost_cny??"",materialLotNo:initial.order.material_lot_no??""} : {})});
  const [teamsByDate,setTeamsByDate] = useState<{date:string;teams:Team[];error?:string}|null>(null);
  const [selectedTeam,setSelectedTeam] = useState("");
  const [personaOptions,setPersonaOptions] = useState<string[]>([]);
  const [personaLoading,setPersonaLoading] = useState(true);
  useEffect(()=>{
    let active=true;
    setPersonaLoading(true);
    void api.orderPersonaOptions().then(list=>{
      if(active)setPersonaOptions(list);
    }).catch(()=>{
      if(active)setPersonaOptions([]);
    }).finally(()=>{
      if(active)setPersonaLoading(false);
    });
    return ()=>{active=false;};
  },[]);
  const chooseTeam = !initial && (!previewOnly || Boolean(practiceTeams));
  useEffect(()=>{
    if (!chooseTeam || practiceTeams || !form.businessDate || form.businessDate>today) return;
    let active=true;
    const date=form.businessDate;
    setTeamsByDate(null);
    setSelectedTeam("");
    void api.orderPerformanceTeams(date).then(teams=>{
      if(active)setTeamsByDate({date,teams});
    }).catch(cause=>{
      if(active)setTeamsByDate({date,teams:[],error:toErrorMessage(cause)});
    });
    return ()=>{active=false;};
  },[chooseTeam,form.businessDate,practiceTeams,today]);
  const dateTeams = teamsByDate?.date===form.businessDate ? teamsByDate : null;
  const availableTeams = practiceTeams ?? dateTeams?.teams ?? [];
  const performanceTeamId = availableTeams.length===1 ? availableTeams[0].id : availableTeams.find(team=>team.id===selectedTeam)?.id;
  const teamNotice = dateTeams?.error || (!practiceTeams&&!dateTeams
    ? "请选择开单日期，或等待读取小组"
    : "开单日没有可用的所属小组，请联系管理员分配");
  const [reason,setReason]=useState(""); const [items,setItems]=useState(initial?.items?.map(i=>{const ch=initial?.details?.dealChannel??activeChannel;const auto=defaultBuyingFee(i.price_cny,i.kind,ch);return {kind:i.kind,label:i.label,materialRef:i.material_ref,priceCny:i.price_cny,buyingFeeCny:i.buying_fee_cny,feeManual:!!auto&&i.buying_fee_cny!==auto,sourcingNoSettle:Boolean(i.sourcing_no_settle)};})??[freshItem()]),[busy,setBusy]=useState(false),[error,setError]=useState("");const key=useRef(submissionKey());
  const privateDeal=activeChannel==="private";const previews=items.map(i=>itemPreview(i.priceCny,i.kind,privateDeal?"0.00":i.feeManual?i.buyingFeeCny:undefined,activeChannel)),total=previews.every(p=>p!==null)?money(previews.reduce((n,p)=>n+(p?.total??0n),0n)):"—";
  function practiceDraft(){if(chooseTeam&&!performanceTeamId)return null;let material=0n,fee=0n;if(!items.length)return null;for(const item of items){const price=cents(item.priceCny);const preview=itemPreview(item.priceCny,item.kind,privateDeal?"0.00":item.feeManual?item.buyingFeeCny:undefined,activeChannel);const feeCents=preview?cents(preview.fee):null;if(price===null||feeCents===null)return null;material+=price;fee+=feeCents;}return {channel:activeChannel,businessDate:form.businessDate,performanceTeamId,performanceTeamName:availableTeams.find(team=>team.id===performanceTeamId)?.name,materialCny:money(material),feeCny:money(fee),customerCurrency:form.customerCurrency,customerDue:form.customerDue,materialRef:form.materialLotNo||items.map(i=>i.materialRef).filter(Boolean).join('、'),items:items.map(i=>({kind:i.kind,materialRef:i.materialRef,priceCny:i.priceCny,buyingFeeCny:privateDeal?'0.00':itemPreview(i.priceCny,i.kind,i.feeManual?i.buyingFeeCny:undefined,activeChannel)?.fee??'0.00'}))};}
  const [photos, setPhotos] = useState<({ file: File; preview: string } | null)[]>([]);
  const photoChecks = useRef<symbol[]>([]);
  useEffect(() => () => { photoChecks.current = []; }, []);

  async function setItemPhoto(index: number, file: File | null) {
    const token = Symbol();
    photoChecks.current[index] = token;
    if (!file) {
      setPhotos(current => {
        const next = current.slice();
        next[index] = null;
        return next;
      });
      return;
    }
    const formatError = "开单卡截图请使用 JPEG、PNG 或 WebP，每张不超过 8MB。";
    if (file.size > 8 * 1024 * 1024) {
      setError(formatError);
      return;
    }

    try {
      const mime = await resolveImageMime(file);
      if (!mime) {
        if (photoChecks.current.includes(token)) setError(formatError);
        return;
      }
      const preview = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file.slice(0, file.size, mime));
      });
      const image = new Image();
      image.src = preview;
      await image.decode();

      const currentIndex = photoChecks.current.indexOf(token);
      if (currentIndex === -1) return;
      setPhotos(current => {
        const next = current.slice();
        next[currentIndex] = { file, preview };
        return next;
      });
      setError("");
    } catch {
      if (photoChecks.current.includes(token)) setError("无法读取开单卡截图，请重新选择可打开的图片。");
    }
  }

  function removeItem(index: number) {
    photoChecks.current.splice(index, 1);
    setPhotos(current => {
      const next = current.slice();
      next.splice(index, 1);
      return next;
    });
    setItems(current => current.filter((_, n) => n !== index));
  }
  function switchChannel(nextChannel:"live"|"private"){setDealChannel(nextChannel);setItems(current=>current.map(item=>{const fee=buyingFeeAfterPriceChange(item.kind,item.priceCny,{feeCny:item.buyingFeeCny,manual:nextChannel==="live"?false:item.feeManual},nextChannel);return {...item,buyingFeeCny:fee.feeCny,feeManual:nextChannel==="private"?false:fee.manual};}));}
  function patchItem(index:number,patch:Partial<(typeof items)[number]>){if(activeChannel==="private"){setItems(items.map((x,n)=>n===index?{...x,...patch,buyingFeeCny:"0.00",feeManual:false}:x));return;}setItems(items.map((x,n)=>{if(n!==index)return x;const next={...x,...patch};if(patch.kind&&patch.kind!=="material"){const fee=buyingFeeRestored(next.priceCny,patch.kind,activeChannel);return {...next,buyingFeeCny:fee.feeCny,feeManual:fee.manual};}if(patch.priceCny!=null||patch.kind!=null){const fee=buyingFeeAfterPriceChange(next.kind,next.priceCny,{feeCny:next.buyingFeeCny,manual:next.feeManual},activeChannel);return {...next,buyingFeeCny:fee.feeCny,feeManual:fee.manual};}return next;}));}
  async function submit(e:FormEvent){e.preventDefault();if(previewOnly||busy||(chooseTeam&&!performanceTeamId))return;if(!initial){const missingIdx=items.findIndex((_,idx)=>!photos[idx]);if(missingIdx!==-1){const msg=`第 ${missingIdx+1} 件商品请先上传开单卡截图（含金额信息与翡翠料子照片）`;setError(msg);toast.error(msg);return;}}setBusy(true);setError("");try{const preparedItems=items.map(i=>({kind:i.kind,label:i.label,materialRef:i.materialRef,priceCny:i.priceCny,buyingFeeCny:activeChannel==="private"?"0.00":i.feeManual?i.buyingFeeCny:(defaultBuyingFee(i.priceCny,i.kind,activeChannel)??"0.00"),sourcingNoSettle:initial?i.kind!=="service"&&Boolean(i.sourcingNoSettle):false}));const body={...form,orderRef:initial?form.orderRef:"",dealChannel:activeChannel,items:preparedItems,...(!initial?{performanceTeamId,customerLeadId}:{})};const result=initial?await api.correctOrderRecord(initial.order.id,{...body,version:initial.details!.version,reason}):await api.createOrderRecord({...body,requestKey:key.current(body)});const uploadErrors:string[]=[];for(let idx=0;idx<items.length;idx++){const file=photos[idx]?.file;if(!file)continue;try{await api.uploadOrderPhoto(result.id,file,result.itemIds?.[idx]??"");}catch(upErr){uploadErrors.push(`第 ${idx+1} 件开单卡截图上传失败：${toErrorMessage(upErr,"请稍后在订单详情补传")}`);}}if(uploadErrors.length){toast.error(`订单已保存，但有图片未上传成功：${uploadErrors.join("；")}`);}else if(!initial){toast.success(`已登记成交 （自动单号）（${form.customerLabel.trim()}），开单卡截图已留底，可继续登记收款`);}onSaved(result.id);}catch(e){const text=toErrorMessage(e,"保存失败");setError(text);toast.error(`${initial?"成交更正":"登记成交"}未保存：${text}`);}finally{setBusy(false);}}
  return <form onSubmit={submit}>
    {!initial&&!channel&&<div className="order-channel" role="group" aria-label="成交渠道">
      <button type="button" disabled={busy} aria-pressed={activeChannel==="live"} onClick={()=>{if(activeChannel!=="live")switchChannel("live");}}>直播间开单</button>
      <button type="button" disabled={busy} aria-pressed={activeChannel==="private"} onClick={()=>{if(activeChannel!=="private")switchChannel("private");}}>私推成交</button>
    </div>}
    {DemoOrderBasicFields?<Suspense fallback={<p role="status">正在打开开单信息…</p>}><DemoOrderBasicFields lockedCustomer={customerName} channel={activeChannel} fields={form} registeredRoom={activeChannel==="live"?registeredRoom:undefined} personaOptions={personaOptions} personaLoading={personaLoading} today={today} editing={!!initial} onChange={patch=>setForm(current=>({...current,...patch}))}/></Suspense>:<div className="grid two">
    {initial&&<Field label="销售方式"><select value={dealChannel} onChange={e=>switchChannel(e.target.value as "live"|"private")}><option value="live">直播间开单（原石默认 10% 代购费）</option><option value="private">客服私推（默认不收代购费）</option></select></Field>}
    {([["businessDate","开单卡日期","date"],["orderRef","订单编号","text"],["personaName","人设 / 主页","select"],["liveRoomCode","直播间编号","select"],["operatorName","经办客服姓名","text"],["customerLabel","客户称呼","text"]] as const).map(([k,label,type])=>{if(k==="orderRef"&&!initial)return null;const optional=k==="orderRef"||(activeChannel==="private"&&k==="liveRoomCode");if(k==="personaName"){const current=form.personaName.trim();const hasLegacy=Boolean(current&&!personaOptions.includes(current));return <Field key={k} label={label}><select aria-label="人设 / 主页" required value={form.personaName} onChange={e=>setForm({...form,personaName:e.target.value})}><option value="">{personaLoading?"正在加载拍剪人设…":personaOptions.length?"请选择人设 / 主页":"暂无拍剪人设记录"}</option>{personaOptions.map(p=><option key={p} value={p}>{p}</option>)}{hasLegacy&&<option value={current}>{current}（历史记录）</option>}</select></Field>;}if(k==="liveRoomCode"){const current=form.liveRoomCode.trim();const hasLegacy=Boolean(current&&!STANDARD_LIVE_ROOMS.some(r=>r.value===current));return <Field key={k} label={label}><select required={!optional} value={form.liveRoomCode} onChange={e=>{const nextRoom=e.target.value;const matched=STANDARD_LIVE_ROOMS.find(r=>r.value===nextRoom);const nextHost=matched?matched.host:nextRoom?(initial?.details?.hostName??form.hostName):"";setForm({...form,liveRoomCode:nextRoom,hostName:nextHost});}}><option value="">{activeChannel==="private"?"不选（私推可选）":"请选择直播间"}</option>{STANDARD_LIVE_ROOMS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}{hasLegacy&&<option value={current}>{current}{form.hostName?`（${form.hostName} · 历史记录）`:"（历史记录）"}</option>}</select></Field>;}return <Field key={k} label={label}><input required={!optional} maxLength={k==="orderRef"||k==="customerLabel"?64:128} type={type} max={type==="date"?today:undefined} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/></Field>;})}
    {chooseTeam&&<Field label="业绩归属小组">
      <select required value={performanceTeamId??""} disabled={availableTeams.length<2||busy} onChange={e=>setSelectedTeam(e.target.value)}>
        {availableTeams.length!==1&&<option value="">{availableTeams.length?"请选择小组":teamNotice}</option>}
        {availableTeams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
      {!availableTeams.length&&<small>{teamNotice}</small>}
    </Field>}
  </div>}
  {DemoOrderBasicFields&&chooseTeam&&<div className="grid two"><Field label="业绩归属小组">
    <select required value={performanceTeamId??""} disabled={availableTeams.length<2||busy} onChange={e=>setSelectedTeam(e.target.value)}>
      {availableTeams.length!==1&&<option value="">{availableTeams.length?"请选择小组":teamNotice}</option>}
      {availableTeams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}
    </select>
    {!availableTeams.length&&<small>{teamNotice}</small>}
  </Field></div>}

        <h3>商品明细</h3>{items.map((i,index)=><fieldset className="commerce-item" key={index}><legend>第 {index+1} 件</legend><div className="grid two"><Field label="类别"><select aria-label={`第 ${index+1} 件类别`} value={i.kind} onChange={e=>patchItem(index,{kind:e.target.value})}><option value="material">原石</option><option value="finished">成品</option>{i.kind==="service"&&<option value="service">工费 / 镶嵌 / 服务</option>}</select></Field>{isDemo?<><Field label="料子编号（可选）"><input aria-label={`第 ${index+1} 件料子编号`} maxLength={128} value={i.materialRef} onChange={e=>setItems(items.map((x,n)=>n===index?{...x,materialRef:e.target.value}:x))}/></Field><Field label="开单价（¥）"><input required aria-label={`第 ${index+1} 件开单价`} inputMode="decimal" value={i.priceCny} onChange={e=>patchItem(index,{priceCny:e.target.value})}/></Field></>:([['label',i.kind==="service"?'服务 / 加工项目名':'商品名称'],['materialRef','料子编号（可选）'],['priceCny',i.kind==="service"?'服务费 · 人民币（¥）':'谈成价 · 人民币（¥）']] as const).map(([k,l])=><Field key={k} label={l}><input required={k!=="materialRef"} inputMode={k==="priceCny"?"decimal":"text"} value={i[k]} onChange={e=>k==="priceCny"?patchItem(index,{priceCny:e.target.value}):setItems(items.map((x,n)=>n===index?{...x,[k]:e.target.value}:x))}/></Field>)}
    {activeChannel!=="private"&&i.kind==="material"?<Field label="代购费（¥）"><input inputMode="decimal" aria-label={`第 ${index+1} 件代购费`} value={i.buyingFeeCny} onChange={e=>{setItems(items.map((x,n)=>n===index?{...x,buyingFeeCny:e.target.value,feeManual:true}:x));}}/>{i.feeManual&&previews[index]?.autoFee!=null&&<button type="button" className="text-action" onClick={()=>setItems(items.map((x,n)=>n===index?{...x,buyingFeeCny:buyingFeeRestored(x.priceCny,x.kind,activeChannel).feeCny,feeManual:false}:x))}>恢复按 10% 计算（{previews[index]?.autoFee}）</button>}</Field>:<span>{isDemo?"代购费":"服务费（代购费）"} {previews[index]?.fee != null ? yuan(previews[index].fee) : "—"}</span>}
    <Field label={initial?"开单卡截图（补传可选）":"开单卡截图（必填）"}><span className="item-photo"><input aria-label={`第 ${index+1} 件开单卡截图`} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0]??null;e.currentTarget.value="";setItemPhoto(index,file);}}/>{photos[index]&&<><img src={photos[index].preview} alt={`第 ${index+1} 件开单卡截图`}/><button type="button" className="text-action" onClick={()=>setItemPhoto(index,null)}>移除截图</button></>}</span></Field></div>{items.length>1&&<div className="commerce-line"><button type="button" className="secondary" onClick={()=>removeItem(index)}>移除此件</button></div>}</fieldset>)}
    <button type="button" className="secondary" disabled={items.length>=50} onClick={()=>setItems([...items,freshItem()])}>＋ 再加一件</button><div className="commerce-total">成交总额 <strong>{yuan(total)}</strong><small>{activeChannel==="private"?"私推成交，不含代购费。":isDemo?"开单价＋代购费；演示不保存。":"料价＋代购费；有有效收款或发货后不能直接修改成交。"}</small></div>
    <div className="grid two"><Field label="本价（白条价）· 人民币（¥，可选）"><input inputMode="decimal" value={form.materialCostCny} onChange={e=>setForm({...form,materialCostCny:e.target.value})} aria-label="料子本钱"/><small className="hint">按原石标签/白条本价录入，留空表示暂未登记。</small></Field>
    <Field label="料号（可选）"><input maxLength={64} value={form.materialLotNo} onChange={e=>setForm({...form,materialLotNo:e.target.value})} aria-label="料号"/><small className="hint">原石标签上的编号，例如 D367-32。可留空。</small></Field></div>
    <div className="grid two"><Field label="与客户约定的付款币种"><CurrencySelect value={form.customerCurrency} onChange={v=>setForm({...form,customerCurrency:v})}/></Field>{form.customerCurrency!=="CNY"&&<Field label={`约定总应收 · ${currencies[form.customerCurrency]}`}><input required inputMode="decimal" value={form.customerDue} onChange={e=>setForm({...form,customerDue:e.target.value})}/></Field>}</div><p className="notice">外币总应收以客户约定为准，不按第三方后续结汇汇率计算。</p><Field label="备注"><textarea maxLength={500} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></Field>{error&&<p role="alert" className="error">{error}</p>}{initial&&<><p className="notice">修改明细后，已有照片保留在整笔订单中。</p><Field label="修改原因"><input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></Field></>}{previewOnly?<><p role="status" className="notice">试填预览 · 不写入正式后台</p>{onPractice&&<button type="button" disabled={chooseTeam&&!performanceTeamId} onClick={()=>{const draft=practiceDraft();if(!draft){setError("请先填写每件商品的开单价");return;}const missingIdx=items.findIndex((_,idx)=>!photos[idx]);if(missingIdx!==-1){setError(`第 ${missingIdx+1} 件商品请先上传开单卡截图（含金额信息与翡翠料子照片）`);return;}try{onPractice(draft);setError("");}catch(cause){setError(toErrorMessage(cause));}}}>{practiceLabel}</button>}</>:<button disabled={busy||(chooseTeam&&!performanceTeamId)}>{busy?"保存中…":initial?"保存成交更正":"保存成交，继续登记收款"}</button>}
  </form>;
}

export function OrderDetail({id,today,canFill,canCancel,canDelete,canCorrectRoom,onBack,onDeleted,onRoomCorrected,initialPayment,initialAfterSales=false,backLabel="返回订单列表"}:{initialPayment:boolean;initialAfterSales?:boolean;backLabel?:string;onBack:()=>void;onDeleted:()=>void;onRoomCorrected?:()=>void;id:string;today:string;canFill:boolean;canCancel:boolean;canDelete:boolean;canCorrectRoom:boolean}) {
  const [data,setData]=useState<OrderRecord|null>(null),[error,setError]=useState("");
  const [busy,setBusy]=useState(false); const [editing,setEditing]=useState(false);
  const [payment,setPayment]=useState({paymentDate:today,amount:"",currency:"CNY" as Currency,creditAmount:"",receivedCny:"",allowOverpay:false,purpose:"deposit",channel:"",thirdParty:false,reference:"",note:"",afterSaleChargeId:""});
  const [expense,setExpense]=useState({businessDate:today,category:"goods",label:"",amountCny:"",counterparty:"",itemId:"",note:"",afterSaleChargeId:""});
  const [shippedOn,setShippedOn]=useState(today),[itemId,setItemId]=useState("");
  const [correction,setCorrection]=useState<{path:string;label:string}|null>(null),[reason,setReason]=useState("");
  const [cancellationAction,setCancellationAction]=useState<{path:string;label:string}|null>(null),[cancellationReason,setCancellationReason]=useState('');
  const [deleteConfirm,setDeleteConfirm]=useState(false),[deleteReason,setDeleteReason]=useState('');
  const [roomCorrection,setRoomCorrection]=useState<{room:string;reason:string;version:number}|null>(null);
  const paymentKey=useRef(submissionKey()),expenseKey=useRef(submissionKey());
  async function load(){const d=await api.orderRecord(id);setError("");setData(d);return d;}
  useEffect(()=>{let active=true;api.orderRecord(id).then(d=>{if(active){setData(d);setPayment(p=>({...p,currency:d.details?.customerCurrency??"CNY",thirdParty:d.details?.customerCurrency!=="CNY"}));}}).catch(e=>{if(active)setError(toErrorMessage(e));});return()=>{active=false;};},[id]);
  async function action(fn:()=>Promise<unknown>,success:string){if(busy)return;setBusy(true);setError("");const who=data?`${data.order.order_ref}${data.order.customer_label?`（${data.order.customer_label}）`:""}`:"订单";
    try{await fn();}catch(e){const text=toErrorMessage(e,"保存失败");setError(text);toast.error(`${who}：${text}`);setBusy(false);return;}
    toast.success(`${who}：${success}`);
    // 保存已成功；刷新失败单独说明，不误报为保存失败。
    try{await load();}catch{setError(REFRESH_AFTER_SAVE_FAILED);toast.error(REFRESH_AFTER_SAVE_FAILED);}finally{setBusy(false);}}
  async function reload(){if(busy)return;setBusy(true);setError("");try{await load();}catch(e){setError(toErrorMessage(e));}finally{setBusy(false);}}
  async function handleDeleteOrder(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const who = data ? `${data.order.order_ref}${data.order.customer_label ? `（${data.order.customer_label}）` : ""}` : "订单";
    try {
      await api.deleteOrderRecord(id, deleteReason);
      toast.success(`${who}：订单已永久删除`);
      onDeleted();
    } catch (err) {
      const text = toErrorMessage(err, "删除失败");
      setError(text);
      toast.error(`${who}：${text}`);
      setBusy(false);
    }
  }
  const [tab,setTab]=useState<"items"|"payment"|"cost">(initialAfterSales?"cost":initialPayment?"payment":"items");
  if(!data)return error?<section className="card overview-error" role="alert"><p>{error}</p><button type="button" className="secondary" disabled={busy} onClick={()=>void reload()}>{busy?"读取中…":"重新读取"}</button></section>:<section className="card"><p role="status">正在读取订单档案…</p></section>;

  const d=data.details,o=data.order;
  const hasPay=!!data.payments?.some(p=>!p.voided_at),hasCharge=!!data.charges?.some(c=>!c.voided_at),canMarkCancel=!!d&&canCancel&&o.historical_team_access!==false&&!o.cancelled&&!['shipped','refunded'].includes(o.status)&&!hasPay&&!hasCharge,canDeleteOrder=canDelete&&o.historical_team_access!==false&&!['shipped','refunded'].includes(o.status)&&!d?.shippedOn&&!(data.payments?.length)&&!(data.expenses?.length)&&!(data.charges?.length),hasCancelExtra=Boolean((d&&(o.cancelled||data.cancellations?.length||cancellationAction))||deleteConfirm),statusHint=d&&!canMarkCancel&&!o.cancelled?(hasPay?"已有收款，不可直接登记跑单":hasCharge?"已有售后追加，不可直接登记跑单":['shipped','refunded'].includes(o.status)?"已发货或退款，不可直接登记跑单":""):"";
  const canChangeRoom=Boolean(canCorrectRoom&&d&&d.dealChannel!=="private"&&o.historical_team_access!==false&&!o.cancelled&&!d.shippedOn&&!["shipped","refunded"].includes(o.status)&&!data.payments?.length&&!data.expenses?.length&&!data.charges?.length);
  return <div className="commerce-workspace fill-order-detail"><div className="commerce-line order-detail-topbar"><button type="button" className="secondary" onClick={onBack}>← {backLabel}</button><p className="fill-status">{o.cancelled?"已跑单":labelOrderStatus(o.status)}{d?.dealChannel==="private"?" · 客服私推":""}{d?.projectLine?` · ${d.projectLine}`:""}{o.performance_team_name?` · 业绩归属 ${o.performance_team_name}`:""}</p><button type="button" className="secondary" disabled={busy} onClick={()=>void reload()}>刷新</button></div><header className="card order-hero-card"><div className="order-hero-top"><p className="order-hero-ref">{o.order_ref} · {o.business_date}</p>{d&&<span className={`order-hero-status ${o.cancelled?"is-cancelled":""}`}><span className={`order-status-dot ${o.cancelled?"is-cancelled":""}`} aria-hidden="true"/>开单状态 · {o.cancelled?"已跑单":"正常"}</span>}</div><div className="order-hero-main"><h1>{o.customer_label||"历史订单"}</h1><strong className="order-hero-amount">{yuan(o.amount)}<small>订单合计（含追加）</small></strong></div><div className="order-hero-foot"><div className="order-hero-tags">{d?<><span className="order-meta-chip">人设：{d.personaName||"待补"}</span><span className="order-meta-chip">{d.dealChannel==="private"?"客服私推":`${d.liveRoomCode||"直播间待补"}${d.hostName?`（${d.hostName}）`:""}`}</span><span className="order-meta-chip">客服：{d.operatorName||"待补"}</span></>:<span className="order-meta-chip">经办：{o.wechat_id||o.display_name}</span>}</div><div className="order-hero-actions">{canChangeRoom&&d&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setDeleteConfirm(false);setCancellationAction(null);setRoomCorrection({room:"",reason:"",version:d.version});}}>更正直播间</button>}{canMarkCancel?<button type="button" className="secondary order-hero-cancel-btn" disabled={busy} onClick={()=>{setRoomCorrection(null);setDeleteConfirm(false);setCancellationReason('');setCancellationAction({path:'cancellations',label:'登记跑单'});}}>登记跑单</button>:statusHint?<small className="order-status-hint">{statusHint}</small>:null}{canDeleteOrder&&<button type="button" className="secondary order-hero-cancel-btn order-hero-delete-btn" disabled={busy} onClick={()=>{setRoomCorrection(null);setCancellationAction(null);setDeleteReason('');setDeleteConfirm(true);}}>删除订单</button>}</div></div>{roomCorrection&&canChangeRoom&&d&&<form className="order-hero-cancel-area" onSubmit={e=>{
      e.preventDefault();
      void action(async()=>{
        await api.orderAction(id,"live-room",{liveRoomCode:roomCorrection.room,reason:roomCorrection.reason,version:roomCorrection.version});
        setRoomCorrection(null);
        onRoomCorrected?.();
      }, "直播间已更正");
    }}>
      <h3>更正直播间</h3>
      <p className="notice">当前归属 {d.liveRoomCode||"未填写"}{d.hostName?"（"+d.hostName+"）":""}。主播随直播间更新。</p>
      <div className="grid two">
        <Field label="更正为"><select required value={roomCorrection.room} onChange={e=>setRoomCorrection({...roomCorrection,room:e.target.value})}>
          <option value="">请选择直播间</option>
          {STANDARD_LIVE_ROOMS.filter(r=>r.value!==d.liveRoomCode||r.host!==d.hostName).map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
        </select></Field>
        <Field label="更正原因"><input required maxLength={500} value={roomCorrection.reason} onChange={e=>setRoomCorrection({...roomCorrection,reason:e.target.value})}/></Field>
      </div>
      <div className="actions"><button disabled={busy||!roomCorrection.reason.trim()||!roomCorrection.room}>保存更正</button><button type="button" className="secondary" disabled={busy} onClick={()=>setRoomCorrection(null)}>取消</button></div>
    </form>}{hasCancelExtra&&<div className="order-hero-cancel-area">{d&&o.cancelled&&<p className="notice">此单已从 {o.business_date} 的营业额中冲抵，原开单卡及成本保留；不生成退款流水，不再按未付尾款催收。</p>}{d&&data.cancellations?.map(c=><article key={c.id} className="commerce-record"><span><strong>{c.voided_at?'跑单已撤销':'跑单冲抵'} · ¥ {c.base_amount_cny}</strong><small>原开单日 {c.booked_on} · 登记人 {c.created_by_name||'历史账号'} · {new Date(c.created_at).toLocaleString('zh-CN')}</small><small>原因：{c.reason}</small>{c.voided_at&&<small>撤销人 {c.voided_by_name||'历史账号'} · 原因：{c.void_reason}</small>}</span>{canCancel&&o.historical_team_access!==false&&!c.voided_at&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setRoomCorrection(null);setDeleteConfirm(false);setCancellationReason('');setCancellationAction({path:`cancellations/${c.id}/void`,label:'撤销跑单'});}}>撤销跑单</button>}</article>)}{d&&cancellationAction&&<form onSubmit={e=>{e.preventDefault();void action(async()=>{await api.orderAction(id,cancellationAction.path,{version:d.version,reason:cancellationReason});setCancellationAction(null);},`${cancellationAction.label}已保存，原开单日营业额已重新计算`);}}><h3>{cancellationAction.label}</h3><p className="notice">{o.cancelled?'撤销后恢复原开单日营业额。':'料价和代购费将回冲原开单日；已发生的业务费用保留，不生成退款。'}</p><Field label="原因"><textarea required maxLength={500} value={cancellationReason} onChange={e=>setCancellationReason(e.target.value)}/></Field><div className="actions"><button disabled={busy}>{busy?'保存中…':`确认${cancellationAction.label}`}</button><button type="button" className="secondary" disabled={busy} onClick={()=>setCancellationAction(null)}>取消</button></div></form>}{deleteConfirm&&<form onSubmit={e=>{void handleDeleteOrder(e);}}><h3>删除订单</h3><p className="notice">删除后将永久移除该订单及其明细、留底照片和跑单记录（不可恢复），仅用于清理测试单或误录单，操作会记入审计日志。</p><Field label="删除原因"><textarea required maxLength={500} placeholder="例如：客服测试账号录入的测试单" value={deleteReason} onChange={e=>setDeleteReason(e.target.value)}/></Field><div className="actions"><button className="danger" disabled={busy}>{busy?'删除中…':'确认永久删除'}</button><button type="button" className="secondary" disabled={busy} onClick={()=>setDeleteConfirm(false)}>取消</button></div></form>}</div>}</header>
    {error&&<p role="alert" className="error">{error}</p>}

    {data.legacy||!d?<section className="card"><h2>历史简版订单</h2><p>未登记客户约定币种和逐笔付款，收款状态未知。旧金额与成本保留，不自动补造已收款记录。</p><p>商品成本 ¥{o.custom_product_cost} · 工费 ¥{o.labor_cost} · 运费 ¥{o.shipping_cost}</p></section>:<>
    <section className="card"><div className="commerce-kpis"><div><small>订单合计 · {currencies[d.customerCurrency]}</small><strong>{d.customerDue}</strong></div><div><small>客户已付 · {currencies[d.customerCurrency]}</small><strong>{data.paid}</strong></div><div><small>{o.cancelled?"跑单前未收金额（停止催收）":data.balance==="0.00"?"客户已结清":"客户尾款"} · {currencies[d.customerCurrency]}</small><strong>{data.balance}</strong></div></div><p className="notice">客户付款与公司结算分开。第三方扣点、汇差由公司承担，不增加客户欠款。</p></section>
    <nav className="order-detail-tabs fill-pills" aria-label="订单详情">
      {([["items","开单明细与原图"],["payment","收款与尾款登记"],["cost","售后费用与成本"]] as const).map(([key,label])=><button type="button" className="secondary" key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}
    </nav>
    <div hidden={tab!=="items"} className="fill-order-panel">
    <section className="card"><div className="commerce-line"><h2>开单卡明细</h2>{canFill&&!o.cancelled&&!data.charges?.length&&!data.payments?.some(p=>!p.voided_at)&&!["shipped","refunded"].includes(o.status)&&<button className="secondary" disabled={busy} onClick={()=>setEditing(!editing)}>{editing?"收起修改":"更正成交"}</button>}</div>{editing&&<CreateOrder key={d.version} today={today} operator={d.operatorName} initial={data} onSaved={()=>{setEditing(false);void action(async()=>{try{const fresh=await load();setPayment(p=>({...p,currency:fresh.details!.customerCurrency,thirdParty:fresh.details!.customerCurrency!=="CNY"}));}catch{/* 更正已保存；刷新失败由 action 随后的刷新单独提示 */}},"成交已更正，已保留修改记录");}}/>}<div className="commerce-list order-items-list">{data.items?.map(i=><article key={i.id} className="commerce-record"><span><strong>{i.label}</strong><small>{i.material_ref||"未填料号"} · {itemKindLabels[i.kind]??i.kind}{i.sourcing_no_settle?" · 接待（PH）· 此料未售出，不结供应商料款":""}</small>{i.sourcing_no_settle&&<small>此料已标接待（PH），未售出，不与供应商结原石料款；实际接待费用在下方支出中按「市场配货采购款」登记。</small>}</span><span className="order-item-price">{i.kind==="service"?"服务费":isDemo?"开单价":"料价"} ¥{i.price_cny}<small>{isDemo?"代购费":"服务费（代购费）"} ¥{i.buying_fee_cny}</small>{canFill&&!o.cancelled&&i.kind!=="service"&&<button type="button" className="text-action" disabled={busy} onClick={()=>void action(()=>api.orderAction(id,`items/${i.id}/sourcing-status`,{sourcingNoSettle:!i.sourcing_no_settle}),i.sourcing_no_settle?`已取消「${i.label}」接待（PH）标记`:`已将「${i.label}」标为接待（PH）`)}>{i.sourcing_no_settle?"取消接待（PH）":"标为接待（PH）"}</button>}</span></article>)}</div>
    {d.source&&<p>来源：{d.source}</p>}{o.note&&<p>备注：{o.note}</p>}</section>

    <section className="card"><h2>成交 / 成本原图留底</h2><p className="notice">照片仅向有权查看此单的账号开放。图片中的金额须人工核对，系统不从手写照片自动填价。</p><div className="commerce-photos">{data.attachments?.map(a=><a key={a.id} href={`/api/order-records/${id}/attachments/${a.id}`} target="_blank" rel="noreferrer"><img loading="lazy" src={`/api/order-records/${id}/attachments/${a.id}`} alt={`订单留底：${a.filename}`}/><span>{a.filename}{a.item_id?` · ${data.items?.find(i=>i.id===a.item_id)?.label??"料子"}`:""}</span></a>)}</div>{canFill&&<><Field label="关联商品"><select value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">整笔订单</option>{data.items?.map(i=><option value={i.id} key={i.id}>{i.label} {i.material_ref}</option>)}</select></Field><Field label="上传原图（JPEG / PNG / WebP，每张≤8MB，每单≤12张）"><input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;if(file.size>8*1024*1024){setError("每张照片最多8MB");toast.error(`${o.order_ref}：照片未上传，每张照片最多8MB`);return;}void action(()=>api.uploadOrderPhoto(id,file,itemId),"照片已留存");}}/></Field></>}</section>
    </div>
    <div hidden={tab!=="payment"} className="fill-order-panel">
    <section className="card"><h2>客户付款</h2>{!data.payments?.length&&<p className="notice">尚未登记收款。</p>}{data.payments?.map(p=><article key={p.id} className={`commerce-record ${p.voided_at?"commerce-void":""}`}><span><strong>{p.amount} {p.currency} · {purposeLabels[p.purpose]}</strong><small>{p.payment_date} · {p.channel} · {p.third_party?"第三方收款":"人民币直接到账"}</small><small>{p.after_sale_charge_id?'售后 · '+(data.charges?.find(c=>c.id===p.after_sale_charge_id)?.label??'历史售后业务'):'原开单款／历史未分类'}</small><small>抵扣 {p.credit_amount} {d.customerCurrency}{p.received_cny!=null?` · 折合实收 ¥ ${p.received_cny}`:""}{p.third_party?` · 已结算原币 ${p.settled_amount} ${p.currency}`:""}</small>{p.reference&&<small>流水：{p.reference}</small>}{p.voided_at&&<small>已作废：{p.void_reason}</small>}</span>{canFill&&!p.voided_at&&<button className="secondary" disabled={busy} onClick={()=>{setCorrection({path:`payments/${p.id}/void`,label:"作废收款"});setReason("");}}>纠错</button>}</article>)}
    {canFill&&!o.cancelled&&<details open={initialPayment||undefined}><summary>＋ 登记定金 / 尾款</summary><form onSubmit={e=>{e.preventDefault();const body={...payment,thirdParty:payment.currency!=="CNY"||payment.thirdParty};void action(async()=>{await api.orderAction(id,"payments",{...body,requestKey:paymentKey.current(body)});paymentKey.current=submissionKey();setPayment(p=>({...p,amount:"",creditAmount:"",receivedCny:"",allowOverpay:false,reference:"",note:""}));},`客户收款 ${body.amount} ${body.currency} 已登记`);}}><div className="grid two"><Field label="本笔收款归属"><select value={payment.afterSaleChargeId} onChange={e=>setPayment({...payment,afterSaleChargeId:e.target.value})}><option value="">原开单款／历史未分类</option>{data.charges?.filter(c=>!c.voided_at).map(c=><option key={c.id} value={c.id}>售后 · {c.label} · 应收 {c.customer_amount} {d.customerCurrency}</option>)}</select></Field><Field label="实际付款日期"><input required type="date" min={o.business_date} max={today} value={payment.paymentDate} onChange={e=>setPayment({...payment,paymentDate:e.target.value})}/></Field><Field label="付款性质"><select value={payment.purpose} onChange={e=>setPayment({...payment,purpose:e.target.value})}>{Object.entries(purposeLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="付款币种"><CurrencySelect value={payment.currency} onChange={v=>setPayment({...payment,currency:v,thirdParty:v!=="CNY"})}/></Field><Field label={`本次收到 · ${currencies[payment.currency]}`}><input required inputMode="decimal" value={payment.amount} onChange={e=>setPayment({...payment,amount:e.target.value})}/></Field>{payment.currency!==d.customerCurrency&&<Field label={`双方认可抵扣应收 · ${currencies[d.customerCurrency]}`}><input required inputMode="decimal" value={payment.creditAmount} onChange={e=>setPayment({...payment,creditAmount:e.target.value})}/></Field>}<Field label="折合实收人民币（¥，可选）"><input inputMode="decimal" placeholder="外币收款可填实际折合人民币" value={payment.receivedCny} onChange={e=>setPayment({...payment,receivedCny:e.target.value})}/></Field><Field label="收款账户 / 第三方名称"><input required maxLength={128} value={payment.channel} onChange={e=>setPayment({...payment,channel:e.target.value})}/></Field><Field label="收款流水号（建议填写，防重复）"><input maxLength={128} value={payment.reference} onChange={e=>setPayment({...payment,reference:e.target.value})}/></Field>{payment.currency==="CNY"&&<Field label="资金去向"><select value={payment.thirdParty?"third":"direct"} onChange={e=>setPayment({...payment,thirdParty:e.target.value==="third"})}><option value="direct">直接到账公司人民币账户</option><option value="third">由第三方代收，尚待结算</option></select></Field>}<Field label="备注"><input maxLength={500} value={payment.note} onChange={e=>setPayment({...payment,note:e.target.value})}/></Field></div><label className="commerce-check"><input type="checkbox" checked={payment.allowOverpay} onChange={e=>setPayment({...payment,allowOverpay:e.target.checked})}/> 允许超额收款（如汇差、多付或小费）</label><button disabled={busy}>{busy?"保存中…":"保存本次收款"}</button></form></details>}</section>
    </div>
    <div hidden={tab!=="cost"} className="fill-order-panel">
    <section className="card"><h2>料子本钱</h2>    <article className="commerce-record order-jade-cost" aria-label="料子本钱"><span><strong>本价（白条价）· 人民币（¥）</strong><small>{o.material_lot_no?`料号 ${o.material_lot_no} · `:""}{o.material_cost_cny!=null?'开单卡登记，按标签录入':'未在开单卡登记；毛利回退已登记供货款/配货款'}{o.cancelled?' · 已跑单，不计入本价成本':''}</small>{!o.material_lot_no&&o.material_cost_cny!=null&&<small>未填料号</small>}</span><span className="commerce-amount">{o.material_cost_cny!=null?`¥ ${o.material_cost_cny}`:'—'}</span></article>
</section>
    <OrderCharges data={data} today={today} canFill={canFill&&!o.cancelled} onSaved={load}/>
    <section className="card"><div className="commerce-line"><h2>公司成本与发货</h2><strong>¥ {data.expenseTotal}</strong></div><p>{d.shippedOn?`发货日期：${d.shippedOn}`:"尚未登记发货"}</p>{data.expenses?.map(x=><article className={`commerce-record ${x.voided_at?"commerce-void":""}`} key={x.id}><span><strong>{x.label} · ¥ {x.amount_cny}</strong><small>归属：{x.after_sale_charge_id?'售后 · '+(data.charges?.find(c=>c.id===x.after_sale_charge_id)?.label??'历史售后业务'):'原开单／历史未分类'}</small><small>供货/服务方：{x.counterparty||"待补"} · 商品：{data.items?.find(i=>i.id===x.item_id)?.material_ref||"整单"}</small>{x.note&&<small>{x.note}</small>}<small>{expenseLabels[x.category]} · {x.business_date}{x.voided_at?` · 已作废：${x.void_reason}`:""}</small></span>{canFill&&!x.voided_at&&<button className="secondary" disabled={busy} onClick={()=>{setCorrection({path:`expenses/${x.id}/void`,label:"作废支出"});setReason("");}}>纠错</button>}</article>)}{canFill&&<><details><summary>＋ 补记支出</summary><form onSubmit={e=>{e.preventDefault();const body={...expense};void action(async()=>{await api.orderAction(id,"expenses",{...body,requestKey:expenseKey.current(body)});expenseKey.current=submissionKey();setExpense(x=>({...x,label:"",amountCny:""}));},`支出「${body.label}」¥ ${body.amountCny} 已登记`);}}><div className="grid two"><Field label="成本归属"><select value={expense.afterSaleChargeId} onChange={e=>setExpense({...expense,afterSaleChargeId:e.target.value})}><option value="">原开单／历史未分类成本</option>{data.charges?.filter(c=>!c.voided_at).map(c=><option key={c.id} value={c.id}>售后 · {c.label}</option>)}</select></Field><Field label="支出日期"><input required type="date" max={today} value={expense.businessDate} onChange={e=>setExpense({...expense,businessDate:e.target.value})}/></Field><Field label="费用类别"><select value={expense.category} onChange={e=>setExpense({...expense,category:e.target.value})}>{Object.entries(expenseLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="供货 / 服务方"><input required maxLength={128} value={expense.counterparty} onChange={e=>setExpense({...expense,counterparty:e.target.value})}/></Field><Field label="对应商品 / 原石"><select value={expense.itemId} onChange={e=>setExpense({...expense,itemId:e.target.value})}><option value="">整笔订单</option>{data.items?.map(i=><option key={i.id} value={i.id}>{i.material_ref||"未填料号"} · {i.label}{i.sourcing_no_settle?"（接待（PH）不结料款）":""}</option>)}</select></Field><Field label="商品 / 费用名称"><input required maxLength={128} value={expense.label} onChange={e=>setExpense({...expense,label:e.target.value})}/></Field><Field label="支出金额 · 人民币"><input required inputMode="decimal" value={expense.amountCny} onChange={e=>setExpense({...expense,amountCny:e.target.value})}/></Field></div><Field label="业务备注"><textarea maxLength={500} value={expense.note} onChange={e=>setExpense({...expense,note:e.target.value})}/></Field><p className="notice">接待（PH）采购按真实类别“市场配货采购款”登记；设计雕刻费等客户收费在上方追加应收登记。此处为应付成本，实际付款由财务登记。</p><button disabled={busy}>{busy?"保存中…":"保存应付成本"}</button></form></details><details hidden={o.cancelled}><summary>登记 / 更新发货日期</summary><form onSubmit={e=>{e.preventDefault();void action(()=>api.orderAction(id,"shipping",{shippedOn}),`发货日期 ${shippedOn} 已保存`);}}><Field label="发货日期"><input required type="date" min={o.business_date} max={today} value={shippedOn} onChange={e=>setShippedOn(e.target.value)}/></Field><button disabled={busy}>{busy?"保存中…":"保存发货日期"}</button></form></details></>}</section>
    </div>
    {correction&&<section className="card commerce-correction"><h2>{correction.label}</h2><p>用于纠正登记错误，会保留原记录与原因。实际退款请另行核对，不用作废记录代替资金退款。</p><form onSubmit={e=>{e.preventDefault();void action(async()=>{await api.orderAction(id,correction.path,{reason});setCorrection(null);},`${correction.label}已保存，原记录保留`);}}><Field label="纠错原因"><input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></Field><div className="commerce-line"><button disabled={busy}>{busy?"保存中…":"确认作废"}</button><button type="button" className="secondary" onClick={()=>setCorrection(null)}>取消</button></div></form></section>}

    </>}
  </div>;
}

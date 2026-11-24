import './demo/ops-analysis.css';
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { toErrorMessage } from "./errors";
import { createRequestGate } from "./requestGate";
import { toast } from "./Toast";
import { detailLines, fanFields, opsFields, editorFields, fanNote, opsNote, editorNote } from "./dailyDetail";
import {editorNames,productionGroups} from './productionGroups';
import {InfoTip} from './InfoTip';
import {leadApi} from './leadApi';

type Kind = "fan_report" | "ops_report" | "editor_report";
type Row = { id: string; businessDate: string } & Record<string, unknown>;
const REFRESH_AFTER_SAVE_FAILED = "已保存，但列表刷新失败，请点刷新";
const NEW_PERSONA_OPTION = "__new_persona__";
export function DailyForm({ kind, today, onError, readOnly = false, servicePlatform, editorName }: { kind: Kind; today: string; onError: (value: string) => void; readOnly?: boolean; servicePlatform?: string | null; editorName?: string }) {

  const fields = kind === "fan_report" ? fanFields : kind === "ops_report" ? opsFields : editorFields;
  const nameKey = kind === "fan_report" ? "pageName" : "personaName";
  const reportLabel = kind === "fan_report" ? "加粉日报" : kind === "ops_report" ? "运营日报" : "拍剪日报";
  const [form, setForm] = useState<Record<string, string>>({ businessDate: today, [nameKey]: "", note: "" });
  const [rows, setRows] = useState<Row[]>([]);
  const [rowsLoaded, setRowsLoaded] = useState(false);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [legacyId, setLegacyId] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [reportId,setReportId]=useState('');
  const [filters,setFilters]=useState({editor:'',persona:'',from:'',to:'',group:'persona' as 'editor'|'persona'});
  const [adAccounts,setAdAccounts]=useState<{code:string;name:string}[]>([]);
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);
  const [customPersona, setCustomPersona] = useState(false);
  const gate = useRef(createRequestGate());
  const opsDrawer=useRef<HTMLDialogElement>(null);
  const [opsAccount,setOpsAccount]=useState("");
  const opsMode=kind==="ops_report";
  const formRef = useRef<HTMLFormElement>(null);
  async function refresh() {
    const ticket = gate.current.next();
    setRowsLoading(true);
    try {
      const result = kind === "fan_report" ? await api.myFanReports() : kind === "ops_report" ? await api.opsReports() : await api.editorReports();
      if (!ticket.isCurrent()) return;
      setRows(result.reports as unknown as Row[]);
      setRowsLoaded(true);
      setRowsError("");
    } finally {
      if (ticket.isCurrent()) setRowsLoading(false);
    }
  }
  useEffect(() => {
    setForm({ businessDate: today, [nameKey]: "", note: "" });
    setReportId(""); setLegacyId(""); setTargetUserId(""); setSaveError(""); setMessage(""); setCustomPersona(false);
    refresh().catch((err) => setRowsError(toErrorMessage(err)));
    return () => { gate.current.next(); };
  }, [kind]);
  useEffect(() => {
    let active = true;
    const loadAccounts = () => {
      api.adAccounts().then(d => { if (active) setAdAccounts(d.accounts); }).catch(err => { if (active) onError(toErrorMessage(err)); });
    };
    if (kind === 'ops_report') {
      loadAccounts();
      window.addEventListener("cms:ad-accounts-updated", loadAccounts);
    }
    return () => { active = false; window.removeEventListener("cms:ad-accounts-updated", loadAccounts); };
  }, [kind]);
  const visibleRows=rows.filter(r=>(kind!=='editor_report'||(!filters.editor||(filters.editor==='legacy'?!r.editorName:r.editorName===filters.editor))&&(!filters.persona||r.personaName===filters.persona))&&(!filters.from||r.businessDate>=filters.from)&&(!filters.to||r.businessDate<=filters.to));
  const personaOptions=kind==='editor_report'?[...new Set(rows.map(r=>String(r.personaName??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')):[];
  const groups=kind==='editor_report'?productionGroups(visibleRows,editorName?'persona':filters.group):[];
  function edit(row: Row) {
    const next: Record<string, string> = { businessDate: row.businessDate, [nameKey]: String(row[nameKey] ?? ""), note: String(row.note ?? "") };
    for (const key of Object.keys(fields)) next[key] = row[key] == null ? "" : String(row[key]);
    if (kind === "fan_report" && row.isLegacyUnclassified) {
      next.addedCount = String(row.addedCount ?? 0);
      setLegacyId(row.id);
    } else setLegacyId("");
    setForm({...next,editorName:String(row.editorName??''),adAccountRef:String(row.adAccountRef??'')});
    setReportId(row.id);
    setTargetUserId(String(row.userId ?? ""));
    setCustomPersona(false);
    setSaveError("");
    setMessage("已加载原记录，修改后保存会直接更新统计。变更日期或人设请点击新建；归类会更新原记录，不重复计数。");
    if(opsMode)opsDrawer.current?.showModal();
    else requestAnimationFrame(() => formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }));
  }
  const latestOps=opsMode?[...rows].sort((a,b)=>b.businessDate.localeCompare(a.businessDate))[0]:undefined;
  function createOps(reuse=false){
    setReportId("");setLegacyId("");setTargetUserId("");setSaveError("");setMessage("");setCustomPersona(false);
    const previous=reuse?latestOps:undefined;
    setForm({businessDate:today,[nameKey]:String(previous?.[nameKey]??""),note:"",adAccountRef:String(previous?.adAccountRef??""),platform:String(previous?.platform??"")});
    opsDrawer.current?.showModal();
  }
  return <section className={opsMode?"card ops-daily":"card"}>
    <h2>{kind === "fan_report" ? "客服主页日报" : kind === "ops_report" ? "运营投放日报" : readOnly?"视频素材明细":"拍剪日报"}{kind==="editor_report"&&<InfoTip label="库存与统计口径" text={editorNote+" 历史未归类记录保留原归属，需原填报人员明确归类。"}/>}</h2>
    {kind!=="editor_report"&&<p className="notice">{kind === "fan_report" ? fanNote : opsNote}</p>}
    {readOnly && kind!=="editor_report" && <p className="notice">BOSS 端仅查看数据，业务填报由对应岗位完成。</p>}
    {opsMode&&!readOnly&&<div className="actions"><button type="button" onClick={()=>createOps()}>＋ 填报今日投放</button><button type="button" className="secondary" disabled={!latestOps} onClick={()=>createOps(true)}>沿用上条基础信息填报</button></div>}
    {!readOnly && (()=>{
      const reportForm=<form ref={formRef} onSubmit={async (event) => {
      event.preventDefault();
      if (pending) return;
      setPending(true); setMessage(""); setSaveError("");
      const savedDate = form.businessDate;
      const savedName = legacyId ? "未分类旧加粉" : form[nameKey].trim();
      if (!legacyId && !savedName) {
        setSaveError(kind === "fan_report" ? "请填写主页全名" : "请选择或填写人设/主页名称");
        setPending(false);
        return;
      }
      try {
        const payload: Record<string, unknown> = { businessDate: form.businessDate, [nameKey]: form[nameKey].trim(), note: form.note };
        if (targetUserId) payload.userId = targetUserId;
        if(kind==='editor_report'){payload.editorName=editorName||form.editorName;if(reportId)payload.reportId=reportId;}
        if(kind==='ops_report'){payload.adAccountRef=form.adAccountRef||null;if(reportId)payload.reportId=reportId;}
        if (legacyId) {
          delete payload.pageName; delete payload.note;
          payload.addedCount = Number(form.addedCount);
        } else {
          for (const key of Object.keys(fields)) payload[key] = kind==='fan_report'&&(servicePlatform==='whatsapp'&&key.startsWith('ms')||servicePlatform==='messenger'&&key.startsWith('ws'))?'0':form[key];
        }
        if (kind === "fan_report") await api.saveFanReport(payload);
        else if (kind === "ops_report") { await api.saveOps(payload); opsDrawer.current?.close(); }
        else await api.saveEditor(payload);
      } catch (err) {
        // 失败原因显示在“保存日报”按钮旁，并发失败提示；不再只写到页面最顶部。
        const text = toErrorMessage(err, "保存失败");
        setSaveError(text);
        toast.error(`${savedDate} ${savedName} ${reportLabel}未保存：${text}`);
        setPending(false);
        return;
      }
      onError("");
      toast.success(`已保存 ${savedDate}「${savedName}」${reportLabel}；相同日期和主页/人设会更新原记录，保存后直接计入统计`);
      if (kind === "editor_report") {
        setForm((prev) => ({ ...prev, [nameKey]: savedName }));
        setCustomPersona(false);
      }
      setPending(false);
      // 保存已成功；刷新列表失败单独说明，不误报为保存失败。
      try { await refresh(); }
      catch { setRowsError(REFRESH_AFTER_SAVE_FAILED); toast.error(REFRESH_AFTER_SAVE_FAILED); }
    }}>
      <fieldset disabled={pending}>
        <div className={kind === "editor_report" ? "grid two editor-report-grid" : "grid two"}>
          <label className="row editor-full-row">业务日<input required type="date" max={today} value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} /></label>
          {kind==='editor_report'&&!editorName&&<label className="row editor-full-row">拍剪师<select required value={form.editorName??''} onChange={e=>setForm({...form,editorName:e.target.value})}><option value="">选择拍剪师</option>{editorNames.map(name=><option key={name}>{name}</option>)}</select></label>}
          {kind==='ops_report'&&<label className="row">广告账户<select required={adAccounts.length>0} value={form.adAccountRef??''} onChange={e=>setForm({...form,adAccountRef:e.target.value})}><option value="">{adAccounts.length?'选择广告账户':'尚无账户（历史未关联）'}</option>{adAccounts.map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></label>}
          {!legacyId && (kind === "editor_report" && personaOptions.length > 0 ? (
            <label className="row editor-full-row">
              人设/主页名称
              <select
                required={!customPersona}
                value={customPersona ? NEW_PERSONA_OPTION : form[nameKey]}
                onChange={(e) => {
                  if (e.target.value === NEW_PERSONA_OPTION) {
                    setCustomPersona(true);
                    setForm({ ...form, [nameKey]: "" });
                  } else {
                    setCustomPersona(false);
                    setForm({ ...form, [nameKey]: e.target.value });
                  }
                }}
              >
                <option value="">选择人设/主页</option>
                {personaOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                <option value={NEW_PERSONA_OPTION}>＋ 新增人设/主页</option>
              </select>
              {customPersona && (
                <input
                  style={{ marginTop: 8 }}
                  required
                  maxLength={128}
                  placeholder="输入新人设/主页名称，保存后自动加入待选"
                  value={form[nameKey]}
                  onChange={(e) => setForm({ ...form, [nameKey]: e.target.value })}
                />
              )}
            </label>
          ) : (
            <label className="row editor-full-row">{kind === "fan_report" ? "主页全名" : "人设/主页名称"}<input required maxLength={128} placeholder={kind === "editor_report" ? "输入新人设/主页名称，保存后自动加入待选" : undefined} value={form[nameKey]} onChange={(e) => setForm({ ...form, [nameKey]: e.target.value })} /></label>
          ))}
          {legacyId ? <label className="row">未分类旧加粉<input required type="number" min="0" max="1000000" step="1" value={form.addedCount} onChange={(e) => setForm({ ...form, addedCount: e.target.value })} /></label> : Object.entries(fields).filter(([key])=>kind!=='fan_report'||!(servicePlatform==='whatsapp'&&key.startsWith('ms')||servicePlatform==='messenger'&&key.startsWith('ws'))).map(([key, label]) => {
            const decimal = key.endsWith("Usd") || key === "ctrPercent";
            return <label className="row" key={key}>{label}<input required type="number" min="0" max={key === "ctrPercent" ? 100 : decimal ? undefined : key === "clickCount" ? 100000000 : 1000000} step={decimal ? "0.01" : "1"} inputMode={decimal ? "decimal" : "numeric"} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>;
          })}
        </div>
        {kind==='fan_report'&&!legacyId&&<button type="button" className="secondary" disabled={!form.businessDate||!form.pageName?.trim()} onClick={async()=>{setPending(true);setSaveError('');try{const data=await leadApi.list(form.businessDate,form.businessDate),leads=data.leads.filter(l=>!l.voidedAt&&l.pageName===form.pageName.trim());setForm(f=>({...f,msToday:String(leads.filter(l=>l.channel==='ms').length),wsToday:String(leads.filter(l=>l.channel==='ws').length)}));setMessage(`已按该主页客户明细带入 ${leads.length} 位当日进粉；月累计与当日沟通情况请继续填报。`);onError('');}catch(e){const text=toErrorMessage(e);setSaveError(text);onError(text);toast.error(`带入今日进粉失败：${text}`);}finally{setPending(false);}}}>从客户明细带入今日进粉</button>}
        {!legacyId && <label className="row">备注（可选）<textarea maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>}
        {kind==='ops_report'&&<button type="button" className="secondary" disabled={refreshingAccounts} onClick={async()=>{if(refreshingAccounts)return;setRefreshingAccounts(true);setSaveError('');try{const d=await api.adAccounts();setAdAccounts(d.accounts);setMessage('广告账户选项已更新');onError('');}catch(e){const text=toErrorMessage(e);setSaveError(text);onError(text);toast.error(`刷新广告账户失败：${text}`);}finally{setRefreshingAccounts(false);}}}>{refreshingAccounts?'刷新中…':'刷新广告账户选项'}</button>}
        <div className="actions"><button type="submit">{pending ? "保存中…" : "保存日报"}</button><button type="button" className="secondary" onClick={() => { setReportId('');setLegacyId(""); setTargetUserId(""); setMessage(""); setSaveError(""); setCustomPersona(false); setForm({ businessDate: today, [nameKey]: "", note: "" }); }}>新建另一主页/人设</button></div>
        {saveError && <p className="action-error" role="alert">未保存：{saveError}</p>}

      </fieldset>
    </form>;
      return opsMode?<dialog ref={opsDrawer} className="ops-workflow-drawer" aria-label="投放日报填报" onCancel={event=>{if(pending)event.preventDefault();}}>
        <header className="commerce-line"><h2>{reportId?"编辑投放日报":"填报今日投放"}</h2><button type="button" className="secondary" disabled={pending} onClick={()=>opsDrawer.current?.close()}>关闭</button></header>
        {reportForm}
      </dialog>:reportForm;
    })()}
    {message && <p className="ok" role="status">{message}</p>}
    <div className="commerce-line daily-records-header"><h3>已填记录</h3><button type="button" className="secondary" disabled={rowsLoading} onClick={()=>refresh().catch(err=>setRowsError(toErrorMessage(err)))}>{rowsLoading?'读取中…':'刷新'}</button></div>
    {rowsError&&<p className="error" role="alert">{rowsError}</p>}{rowsLoading&&!rowsLoaded&&<p role="status">正在读取已填记录…</p>}
    {kind==='editor_report'&&<><div className="production-filter-grid">{!editorName&&<label className="row">拍剪师筛选<select value={filters.editor} onChange={e=>setFilters({...filters,editor:e.target.value})}><option value="">全部拍剪师</option>{editorNames.map(name=><option key={name}>{name}</option>)}<option value="legacy">历史未归类</option></select></label>}<label className="row">人设筛选<select value={filters.persona} onChange={e=>setFilters({...filters,persona:e.target.value})}><option value="">全部人设</option>{personaOptions.map(name=><option key={name}>{name}</option>)}</select></label>{!editorName&&<label className="row">分类方式<select value={filters.group} onChange={e=>setFilters({...filters,group:e.target.value as 'editor'|'persona'})}><option value="editor">按拍剪师</option><option value="persona">按人设</option></select></label>}<details className="production-date-filter"><summary>日期筛选{filters.from||filters.to?" · 已设置":""}</summary><div className="grid two">{(['from','to'] as const).map((k,i)=><label className="row" key={k}>{['开始','结束'][i]}日期<input type="date" max={today} value={filters[k]} onChange={e=>setFilters({...filters,[k]:e.target.value})}/></label>)}</div></details></div><p className="notice">当前范围 {visibleRows.length} 条日报</p><div className="production-groups">{groups.map(g=><article className="production-group" key={g.name}><h3>{g.name}</h3><div className="stat-grid">{[['拍摄',g.shoot],['剪辑',g.edit],['发给运营',g.sent],['末次库存',g.inventory]].map(([label,value])=><div key={String(label)}><strong>{value??'—'}</strong><small>{label}</small></div>)}</div><small>{g.records.length} 条日报</small></article>)}</div></>}
    {rowsLoaded&&!visibleRows.length&&<div className="empty-state"><strong>当前范围暂无记录</strong><p>{readOnly?'对应岗位保存日报后会显示在这里。':'填写上方表单并保存即可。'}</p></div>}
    {opsMode?<><div className="oa-detail-tabs ops-account-filters" role="group" aria-label="广告账户筛选">{["",...new Set(rows.map(row=>String(row.adAccountRef??"")).filter(Boolean))].map(account=><button type="button" className="secondary" key={account} aria-pressed={opsAccount===account} onClick={()=>setOpsAccount(account)}>{account||"全部广告户"}</button>)}</div>
      <div className="oa-native-scroll"><table className="oa-native" aria-label="已填投放日报"><thead><tr>{["日期","广告账户","人设／主页","平台","消耗 USD","咨询","点击","余额 USD","操作"].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{visibleRows.filter(row=>!opsAccount||row.adAccountRef===opsAccount).map(row=><tr key={row.id}>{[row.businessDate,row.adAccountRef,row[nameKey],row.platform,row.spendUsd,row.consultCount,row.clickCount,row.balanceUsd].map((value,i)=><td key={i}>{String(value??"—")}</td>)}<td>{!readOnly&&<button type="button" className="text-action" disabled={pending} onClick={()=>edit(row)}>编辑 →</button>}</td></tr>)}</tbody></table></div>
    </>:visibleRows.map((row) => <article className="review-card" key={row.id}>
      <div className="review-card-head"><strong>{row.businessDate}</strong></div>
      {detailLines(kind, row).map((line) => <p key={line}>{line}</p>)}
      {!readOnly && <button type="button" className="secondary" disabled={pending} onClick={() => edit(row)}>加载并修改</button>}
    </article>)}
  </section>;
}

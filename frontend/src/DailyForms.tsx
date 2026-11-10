import { useEffect, useState } from "react";
import { api } from "./api";
import { toErrorMessage } from "./errors";
import { toast } from "./Toast";
import { detailLines, fanFields, opsFields, editorFields, fanNote, opsNote, editorNote } from "./dailyDetail";

type Kind = "fan_report" | "ops_report" | "editor_report";
type Row = { id: string; businessDate: string } & Record<string, unknown>;
const REFRESH_AFTER_SAVE_FAILED = "已保存，但列表刷新失败，请点刷新";
export function DailyForm({ kind, today, onError, readOnly = false }: { kind: Kind; today: string; onError: (value: string) => void; readOnly?: boolean }) {
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
  async function refresh() {
    setRowsLoading(true);
    try {
      const result = kind === "fan_report" ? await api.myFanReports() : kind === "ops_report" ? await api.opsReports() : await api.editorReports();
      setRows(result.reports as unknown as Row[]);
      setRowsLoaded(true);
      setRowsError("");
    } finally {
      setRowsLoading(false);
    }
  }
  useEffect(() => { refresh().catch((err) => onError(toErrorMessage(err))); }, [kind]);
  function edit(row: Row) {
    const next: Record<string, string> = { businessDate: row.businessDate, [nameKey]: String(row[nameKey] ?? ""), note: String(row.note ?? "") };
    for (const key of Object.keys(fields)) next[key] = row[key] == null ? "" : String(row[key]);
    if (kind === "fan_report" && row.isLegacyUnclassified) {
      next.addedCount = String(row.addedCount ?? 0);
      setLegacyId(row.id);
    } else setLegacyId("");
    setForm(next);
    setTargetUserId(String(row.userId ?? ""));
    setSaveError("");
    setMessage("已加载原记录，修改后保存会直接更新统计。修改主页或人设名称会保存为另一条记录。");
  }
  return <section className="card">
    <h2>{kind === "fan_report" ? "客服主页日报" : kind === "ops_report" ? "运营投放日报" : "拍剪人设日报"}</h2>
    <p className="notice">{kind === "fan_report" ? fanNote : kind === "ops_report" ? opsNote : editorNote}</p>
    {readOnly && <p className="notice">BOSS 端仅查看数据，业务填报由对应岗位完成。</p>}
    {!readOnly && <form onSubmit={async (event) => {
      event.preventDefault();
      if (pending) return;
      setPending(true); setMessage(""); setSaveError("");
      const savedDate = form.businessDate;
      const savedName = legacyId ? "未分类旧加粉" : form[nameKey].trim();
      try {
        const payload: Record<string, unknown> = { businessDate: form.businessDate, [nameKey]: form[nameKey].trim(), note: form.note };
        if (targetUserId) payload.userId = targetUserId;
        if (legacyId) {
          delete payload.pageName; delete payload.note;
          payload.addedCount = Number(form.addedCount);
        } else {
          for (const key of Object.keys(fields)) payload[key] = form[key];
        }
        if (kind === "fan_report") await api.saveFanReport(payload);
        else if (kind === "ops_report") await api.saveOps(payload);
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
      setPending(false);
      // 保存已成功；刷新列表失败单独说明，不误报为保存失败。
      try { await refresh(); }
      catch { setRowsError(REFRESH_AFTER_SAVE_FAILED); toast.error(REFRESH_AFTER_SAVE_FAILED); }
    }}>
      <fieldset disabled={pending}>
        <div className="grid two">
          <label className="row">业务日<input required type="date" max={today} value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} /></label>
          {!legacyId && <label className="row">{kind === "fan_report" ? "主页全名" : "人设/主页名称"}<input required maxLength={128} value={form[nameKey]} onChange={(e) => setForm({ ...form, [nameKey]: e.target.value })} /></label>}
          {legacyId ? <label className="row">未分类旧加粉<input required type="number" min="0" max="1000000" step="1" value={form.addedCount} onChange={(e) => setForm({ ...form, addedCount: e.target.value })} /></label> : Object.entries(fields).map(([key, label]) => {
            const decimal = key.endsWith("Usd") || key === "ctrPercent";
            return <label className="row" key={key}>{label}<input required type="number" min="0" max={key === "ctrPercent" ? 100 : decimal ? undefined : key === "clickCount" ? 100000000 : 1000000} step={decimal ? "0.01" : "1"} inputMode={decimal ? "decimal" : "numeric"} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>;
          })}
        </div>
        {!legacyId && <label className="row">备注（可选）<textarea maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>}
        <div className="actions"><button type="submit">{pending ? "保存中…" : "保存日报"}</button><button type="button" className="secondary" onClick={() => { setLegacyId(""); setTargetUserId(""); setMessage(""); setSaveError(""); setForm({ businessDate: today, [nameKey]: "", note: "" }); }}>新建另一主页/人设</button></div>
        {saveError && <p className="action-error" role="alert">未保存：{saveError}</p>}
      </fieldset>
    </form>}
    {message && <p className="ok" role="status">{message}</p>}
    <div className="commerce-line"><h3>已填记录</h3><button type="button" className="secondary" disabled={rowsLoading} onClick={() => refresh().then(() => onError("")).catch((err) => setRowsError(toErrorMessage(err)))}>{rowsLoading ? "读取中…" : "刷新"}</button></div>
    {rowsError && <p className="error" role="alert">{rowsError}</p>}
    {rowsLoading && !rowsLoaded && <p className="notice" role="status">正在读取已填记录…</p>}
    {rowsLoaded && !rows.length && <div className="empty-state">
      {readOnly
        ? <><strong>所选范围还没有{kind === "ops_report" ? "运营" : kind === "editor_report" ? "拍剪" : "加粉"}日报</strong><p>对应岗位保存日报后会显示在这里。</p></>
        : <><strong>还没有填过日报</strong><p>填写上方表单并保存即可。</p></>}
    </div>}
    {rows.map((row) => <article className="review-card" key={row.id}>
      <div className="review-card-head"><strong>{row.businessDate}</strong></div>
      {detailLines(kind, row).map((line) => <p key={line}>{line}</p>)}
      {!readOnly && <button type="button" className="secondary" disabled={pending} onClick={() => edit(row)}>加载并修改</button>}
    </article>)}
  </section>;
}

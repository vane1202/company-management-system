import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { requestInner } from "../api";
import { InfoTip } from "../InfoTip";
import { toErrorMessage } from "../errors";
import "./customer-invalid-review.css";

const tabs = { pending: "待复核", approved: "无效客资池", history: "处理记录" } as const;
const outcomes = { pending: "待复核", approved: "已确认无效", rejected: "已驳回", restored: "已恢复跟进" } as const;

type ReviewTab = keyof typeof tabs;
type ReviewStatus = keyof typeof outcomes;
type Decision = "approve" | "reject" | "restore";

export type ReviewRow = {
  id: string;
  status: ReviewStatus;
  name: string;
  customerRef: string;
  employeeId: string;
  employeeName: string;
  teamName: string;
  accountLabel: string;
  source: string;
  createdOn: string;
  reason: string;
  note: string;
  need: string;
  reviewNote: string;
  requestedAt: string;
  dealt: boolean;
};

const decisionResult = {
  approve: "已确认无效，并移入无效客资池。",
  reject: "已退回客服继续跟进。",
  restore: "已恢复跟进，原订单仍保留。"
};

export const reviewStamp = (value?: string) => value
  ? new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })
  : "—";

function matchesTab(row: ReviewRow, tab: ReviewTab) {
  return tab === "history" ? row.status === "rejected" || row.status === "restored" : row.status === tab;
}

function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return <span className={"cir-status is-" + status}>{outcomes[status]}</span>;
}

function Facts({ row }: { row: ReviewRow }) {
  return <dl className="cir-facts">
    <div><dt>经办客服</dt><dd>{[row.employeeName, row.teamName].filter(Boolean).join(" · ") || "未填写"}</dd></div>
    <div><dt>接待账号</dt><dd>{row.accountLabel || "未填写"}</dd></div>
    <div><dt>来源主页</dt><dd>{row.source || "未填写"}</dd></div>
    <div><dt>登记日期</dt><dd>{row.createdOn || "未填写"}</dd></div>
    <div><dt>申请无效原因</dt><dd>{row.reason || "未填写"}</dd></div>
    <div><dt>申请时间</dt><dd>{reviewStamp(row.requestedAt)}</dd></div>
    <div className="cir-wide"><dt>申请备注</dt><dd>{row.note || "未填写"}</dd></div>
    <div className="cir-wide"><dt>沟通与需求</dt><dd>{row.need || "未填写具体需求"}</dd></div>
  </dl>;
}

export function InvalidReviewDesk({ rows, rule, demo = false, loading = false, loadError, onReload, onCommit, renderAudit, employeeOptions }: {
  rows: ReviewRow[];
  rule: string;
  demo?: boolean;
  loading?: boolean;
  loadError?: string;
  onReload?: () => void;
  onCommit: (id: string, decision: Decision, note: string) => void | Promise<void>;
  renderAudit?: (id: string) => ReactNode;
  employeeOptions?: [string, string][];
}) {
  const [tab, setTab] = useState<ReviewTab>("pending");
  const [employee, setEmployee] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>();
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const listRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailId = useId();
  const people = employeeOptions ?? [...new Map(rows.filter((row) => row.employeeId).map((row) => [row.employeeId, row.employeeName])).entries()];
  const needle = query.trim().toLowerCase();
  const visible = rows
    .filter((row) => matchesTab(row, tab)
      && (!employee || row.employeeId === employee)
      && [row.name, row.customerRef, row.employeeName, row.reason, row.note].join(" ").toLowerCase().includes(needle))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const selected = selectedId === null ? undefined : visible.find((row) => row.id === selectedId) ?? visible[0];
  const action = selected?.status === "approved" ? "restore" : decision;
  const editable = selected?.status === "pending" || selected?.status === "approved";
  const emptyTitle = needle || employee ? "没有匹配的客资"
    : tab === "pending" ? "本组暂无待复核申请" : tab === "approved" ? "无效客资池暂无客户" : "暂无退回或恢复记录";

  function choose(id?: string | null) {
    setSelectedId(id);
    setDecision("approve");
    setNote("");
    setError("");
    setMessage("");
  }

  function moveTo(ref: typeof detailRef) {
    const element = ref.current;
    if (!element || (ref === detailRef && getComputedStyle(element).getPropertyValue("--cir-stacked").trim() !== "1")) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  async function submit() {
    if (!selected || !editable || saving || loading) return;
    const reason = note.trim();
    if (action !== "approve" && !reason) {
      setError("请填写处理原因。");
      return;
    }
    const index = visible.findIndex((row) => row.id === selected.id);
    const next = tab === "pending" ? visible[index + 1] ?? visible.find((row) => row.id !== selected.id) : undefined;
    setSaving(true);
    setError("");
    try {
      await onCommit(selected.id, action, reason);
      choose(tab === "pending" && autoAdvance ? next?.id : null);
      setMessage((demo ? "演练：" : "") + decisionResult[action] + (next && autoAdvance ? "已切到下一条待复核客资。" : ""));
      if (next && autoAdvance) moveTo(detailRef);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return <section className="customer-invalid-review" aria-label="无效客资复核" aria-busy={loading || saving}>
    <header className="cir-heading">
      <p className="eyebrow">客服主管 · 本组客资</p>
      <div className="cir-title">
        <h1>无效客资复核</h1>
        <InfoTip label="无效客资复核规则" text={rule} />
        {demo && <span className="cir-demo-pill">本标签页流程演练，未写入正式后台</span>}
      </div>
    </header>
    <nav className="cir-tabs" aria-label="客资复核视图">
      {(Object.keys(tabs) as ReviewTab[]).map((key) => <button type="button" key={key} disabled={saving} aria-pressed={tab === key} onClick={() => { if (key !== tab) { setTab(key); choose(); } }}>
        <span>{tabs[key]}</span><b className="cir-tab-cnt">{rows.filter((row) => matchesTab(row, key)).length}</b>
      </button>)}
    </nav>
    <div className="cir-toolbar">
      <label>经办客服
        <select aria-label="复核客服筛选" value={employee} disabled={saving} onChange={(event) => { setEmployee(event.target.value); choose(); }}>
          <option value="">全部本组客服</option>
          {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label>搜索客户
        <input aria-label="复核客户搜索" type="search" placeholder="客户名或客户编号" value={query} disabled={saving} onChange={(event) => { setQuery(event.target.value); choose(); }} />
      </label>
      <span className="cir-count">当前列表 <b>{visible.length}</b> 条</span>
    </div>
    {loadError && <p className="error" role="alert">{loadError}{onReload && <button type="button" className="text-action" disabled={saving} onClick={onReload}>重新读取</button>}</p>}
    {message && <p className="notice cir-message" role="status">{message}</p>}
    <div className="cir-layout">
      <div className="cir-split">
        <section className="cir-list-card" aria-label="复核队列" ref={listRef} tabIndex={-1}>
          {visible.length ? visible.map((row) => <button type="button" className="cir-row" key={row.id} disabled={saving} aria-pressed={selected?.id === row.id} aria-controls={detailId} onClick={() => {
            if (selected?.id !== row.id) choose(row.id);
            moveTo(detailRef);
          }}>
            <span className="cir-row-name"><strong>{row.name || "未命名客户"}</strong>{row.dealt && <span className="cir-status is-dealt">已有有效订单</span>}</span>
            <ReviewStatusBadge status={row.status} />
            <small>{[row.employeeName, row.reason || "未填写原因"].filter(Boolean).join(" · ")}</small>
            <time dateTime={row.createdOn || undefined}>{row.createdOn || "—"}</time>
          </button>) : <div className="cir-empty">
            <strong>{loading ? "正在读取复核记录…" : emptyTitle}</strong>
            {!loading && <p>{needle || employee ? "可清除搜索或调整经办客服。" : tab === "pending" ? "客服提交申请后，会出现在这里。" : "可切换查看其他复核状态。"}</p>}
          </div>}
        </section>
        <article id={detailId} className="cir-detail-card" aria-label="审批详情" ref={detailRef} tabIndex={-1}>
          {selected ? <>
            <button type="button" className="text-action cir-back-to-list" onClick={() => moveTo(listRef)}>← 返回队列</button>
            <header>
              <div><h2>{selected.name || "未命名客户"}</h2><small>{selected.customerRef || selected.id}</small></div>
              <ReviewStatusBadge status={selected.status} />
            </header>
            <Facts row={selected} />
            {selected.dealt && <p className="cir-order-note"><span className="cir-status is-dealt">已有有效订单</span> 确认无效仍会保留原订单和业绩。</p>}
            {editable ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <h3>{action === "restore" ? "恢复客户跟进" : "复核处理"}</h3>
              {selected.status === "pending" && <div className="cir-decision" role="group" aria-label="复核决定">
                <button type="button" className="secondary cir-approve" aria-pressed={decision === "approve"} disabled={saving} onClick={() => setDecision("approve")}>确认无效</button>
                <button type="button" className="secondary cir-reject" aria-pressed={decision === "reject"} disabled={saving} onClick={() => setDecision("reject")}>退回客服继续跟进</button>
              </div>}
              <label className="cir-note">{action === "approve" ? "复核备注（可选）" : "处理原因（必填）"}
                <textarea aria-label="复核处理原因" rows={3} required={action !== "approve"} maxLength={demo ? 1000 : 500} value={note} disabled={saving} onChange={(event) => setNote(event.target.value)}
                  placeholder={action === "restore" ? "说明为何恢复客户跟进" : action === "reject" ? "填写退回原因，供客服继续跟进" : "补充复核意见"} />
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="cir-submit">
                <button type={demo ? "button" : "submit"} onClick={demo ? () => void submit() : undefined}
                  className={action === "reject" ? "secondary cir-reject" : undefined} disabled={saving || loading}>
                  {saving ? "正在保存…" : action === "approve" ? "确认并移入无效池" : action === "reject" ? "退回客服跟进" : "恢复客户跟进"}
                </button>
                {selected.status === "pending" && <label><input type="checkbox" checked={autoAdvance} disabled={saving} onChange={(event) => setAutoAdvance(event.target.checked)} />提交后自动切到下一条</label>}
              </div>
            </form> : <section className="cir-outcome"><h3>处理结果</h3><p>{outcomes[selected.status]} · 尝试沟通</p><p>{selected.reviewNote || "未补充备注"}</p></section>}
            {renderAudit?.(selected.id)}
          </> : <div className="cir-empty">
            <strong>{selectedId === null && visible.length ? "请选择下一条客资" : "暂无可查看的复核详情"}</strong>
            <p>{visible.length ? "从队列选择一条客资，即可查看详情。" : "有符合条件的记录时，详情将显示在这里。"}</p>
          </div>}
        </article>
      </div>
    </div>
  </section>;
}

type ProductionReview = Omit<ReviewRow, "employeeId"> & { version: number };

export function ProductionInvalidReview() {
  const [rows, setRows] = useState<ProductionReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    requestInner<{ rows: ProductionReview[] }>("/api/customer-reviews", { signal: controller.signal }).then((body) => {
      if (!controller.signal.aborted) setRows((body.rows ?? []).filter((row) => Object.hasOwn(outcomes, row.status)));
    }).catch((cause) => {
      if (!controller.signal.aborted) setLoadError(toErrorMessage(cause));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [tick]);

  async function commit(id: string, decision: Decision, note: string) {
    const row = rows.find((item) => item.id === id);
    if (!row) throw new Error("复核记录不存在，请重新读取。");
    await requestInner("/api/customer-reviews/" + encodeURIComponent(id), {
      method: "POST",
      body: JSON.stringify({ decision, note, version: row.version })
    });
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "restored";
    setLoading(true);
    setRows((current) => current.map((item) => item.id === id ? { ...item, status, reviewNote: note, version: row.version + 1 } : item));
    setTick((value) => value + 1);
  }

  return <InvalidReviewDesk rows={rows.map((row) => ({ ...row, employeeId: row.employeeName }))} loading={loading} loadError={loadError}
    onReload={() => setTick((value) => value + 1)} onCommit={commit}
    rule="语言不通、误点咨询/不感兴趣、色粉三类预设原因由客服登记后直接计入无效客资池。其他原因由主管复核。退回或恢复必须填写原因，客户会自动打上「尝试沟通」标识。" />;
}

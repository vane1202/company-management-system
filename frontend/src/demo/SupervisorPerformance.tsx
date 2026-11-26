import SupervisorOrderFollowup from "./SupervisorOrderFollowup";
import { useEffect, useMemo, useState } from "react";
import { api, type CsAccount, type User } from "../api";
import { OrderWorkspace, Field } from "../OrderWorkspace";
import { InfoTip } from "../InfoTip";
import { toErrorMessage } from "../errors";
import { labelOrderStatus } from "../labels";
import { aggregate, amount, channelOf, convert, money, operatorOf, paymentRows, shiftDay, sortTeamNames, teamOf, teamShare, UNKNOWN, type Selection, type Source } from "./supervisorPerformanceData";
import type { CustomerPaymentFx } from "./adExchangeRates";
import "./supervisor-performance.css";
import { useReferenceQuotes } from "./useReferenceQuotes";
import { AnalysisPlot, ChartStyleControl, Ranking, useChartStyle } from "./AnalysisChart";
import type { TrendSeries } from "./bossTrendData";

type FxSet = {
  paid: CustomerPaymentFx;
  base: CustomerPaymentFx;
  after: CustomerPaymentFx;
  pending: CustomerPaymentFx;
  people: Record<string, CustomerPaymentFx>;
  peoplePending: Record<string, CustomerPaymentFx>;
  days: CustomerPaymentFx[];
};
type PeopleSort = "turnover" | "paid" | "pending";
type ArchiveQuick = "all" | "live" | "private" | "open" | "cancelled";
type ArchiveSort = "date_desc" | "amount_desc";

const yuan = (v: string) => `¥${Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fxValue = (v: CustomerPaymentFx | undefined, loading: boolean) =>
  loading ? "..." : !v || v.cny === null ? "待折算" : `${v.hasForeign ? "约 " : ""}${yuan(v.cny)}`;
const short = (v: bigint) => yuan(money(v));
const basis = "直播间开单按开单日统计料价+代购费，跑单回冲原日，追加收费另列。客服私推另列，只计料价，不收代购费，不计入直播间开单，也不进入主播提成；主管提成规则尚未启用。客户已付款按付款日统计，含旧单尾款，不代表公司到账。待收款覆盖截至结束日期的历史有效订单，按约定币种抵扣；未分配的收款先列入原开单款／历史未分类，需财务核对。个人贡献按记录中的经办客服姓名统计，不随当前账号持有人变化；同名人员需在真实资料中补充唯一标识。";

export default function SupervisorPerformance({
  today,
  user,
  selectedId,
  onSelectOrder,
}: {
  today: string;
  user: User;
  selectedId: string;
  onSelectOrder: (id: string) => void;
}) {
  const revision = useReferenceQuotes();
  const [chartStyle, setChartStyle] = useChartStyle();
  const [trendMetric, setTrendMetric] = useState<"turnover" | "receipts">("turnover");
  const [trendDay, setTrendDay] = useState(today);
  const [data, setData] = useState<{ sources: Source[]; accounts: CsAccount[] } | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState<Selection>({ from: today, to: today, operator: "", account: "", persona: "", room: "", team: "" });
  const [tab, setTab] = useState<"overview" | "people" | "orders">("overview");
  const [sort, setSort] = useState<PeopleSort>("turnover");
  const [search, setSearch] = useState("");
  const [archiveStatus, setArchiveStatus] = useState("");
  const [archiveQuick, setArchiveQuick] = useState<ArchiveQuick>("all");
  const [archiveSort, setArchiveSort] = useState<ArchiveSort>("date_desc");
  const [fx, setFx] = useState<FxSet | null>(null);
  const [fxLoading, setFxLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    void Promise.all([api.orders(), api.csAccounts()])
      .then(async ([orders, accounts]) => {
        const sources = await Promise.all(
          orders.orders.map(async (identity) => ({ identity, record: await api.orderRecord(identity.id) }))
        );
        if (active) setData({ sources, accounts: accounts.accounts });
      })
      .catch((e) => {
        if (active) setError(toErrorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [version]);

  const validRange = !!f.from && !!f.to && f.from <= f.to && f.to <= today;
  const stats = useMemo(() => (data && validRange ? aggregate(data.sources, f, data.accounts) : null), [data, f, validRange]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDay(f.to || today, i - 6)), [f.to, today]);

  useEffect(() => {
    let active = true;
    setFx(null);
    if (!stats) return;
    setFxLoading(true);
    const pending = stats.pending
      .filter((p) => p.balance !== null && p.currency)
      .map((p) => ({ date: f.to, amount: p.balance!, currency: p.currency! }));
    void Promise.all([
      convert(paymentRows(stats.scoped, f.from, f.to)),
      convert(paymentRows(stats.scoped, f.from, f.to, "base")),
      convert(paymentRows(stats.scoped, f.from, f.to, "after")),
      convert(pending),
      Promise.all(stats.contributions.map(async (p) => [p.name, await convert(paymentRows(p.sources, f.from, f.to))] as const)),
      Promise.all(days.map((day) => convert(paymentRows(stats.scoped, day, day)))),
      Promise.all(
        stats.contributions.map(
          async (p) =>
            [
              p.name,
              await convert(
                p.pending
                  .filter((x) => x.balance !== null && x.currency)
                  .map((x) => ({ date: f.to, amount: x.balance!, currency: x.currency! }))
              ),
            ] as const
        )
      ),
    ])
      .then(([paid, base, after, pendingFx, peopleFx, daysFx, peoplePendingFx]) => {
        if (active) {
          setFx({
            paid,
            base,
            after,
            pending: pendingFx,
            people: Object.fromEntries(peopleFx),
            peoplePending: Object.fromEntries(peoplePendingFx),
            days: daysFx,
          });
        }
      })
      .catch((e) => {
        if (active) setError(toErrorMessage(e, "金额待核对"));
      })
      .finally(() => {
        if (active) setFxLoading(false);
      });
    return () => {
      active = false;
    };
  }, [stats, days, f.to, revision]);

  const options = (get: (s: Source) => string) => [...new Set(data?.sources.map(get).filter(Boolean) || [])].sort();
  const teamOptions = useMemo(
    () =>
      sortTeamNames([
        ...(data?.accounts.map((a) => a.teamName || "") || []),
        ...(data?.sources.map((s) => teamOf(s, data?.accounts || [])) || []),
      ]),
    [data]
  );
  const change = (key: keyof Selection, value: string) => setF((current) => ({ ...current, [key]: value }));
  const activeFilterCount = [f.team, f.operator, f.account, f.persona, f.room].filter(Boolean).length;

  const people = useMemo(() => {
    const list = stats?.contributions.slice() || [];
    return list.sort((a, b) => {
      if (sort === "paid" || sort === "pending") {
        const dict = sort === "paid" ? fx?.people : fx?.peoplePending;
        const av = dict?.[a.name]?.cny;
        const bv = dict?.[b.name]?.cny;
        if (av == null) return bv == null ? a.name.localeCompare(b.name) : 1;
        if (bv == null) return -1;
        return Number(amount(bv) - amount(av)) || a.name.localeCompare(b.name);
      }
      return Number(b.turnover - a.turnover) || a.name.localeCompare(b.name);
    });
  }, [stats, sort, fx]);

  const allBookings = stats?.bookings || [];
  const archiveCounts = useMemo(
    () => ({
      all: allBookings.length,
      live: allBookings.filter((s) => !s.record.order.cancelled && channelOf(s) !== "private").length,
      private: allBookings.filter((s) => !s.record.order.cancelled && channelOf(s) === "private").length,
      open: allBookings.filter((s) => !s.record.order.cancelled && (s.identity.status === "placed" || s.identity.status === "in_production")).length,
      cancelled: allBookings.filter((s) => !!s.record.order.cancelled).length,
    }),
    [allBookings]
  );

  const archives = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allBookings.filter((s) => {
      const isCancelled = !!s.record.order.cancelled;
      const isPrivate = channelOf(s) === "private";
      if (archiveQuick === "live" && (isCancelled || isPrivate)) return false;
      if (archiveQuick === "private" && (isCancelled || !isPrivate)) return false;
      if (archiveQuick === "open" && (isCancelled || (s.identity.status !== "placed" && s.identity.status !== "in_production"))) return false;
      if (archiveQuick === "cancelled" && !isCancelled) return false;
      if (archiveStatus) {
        if (archiveStatus === "cancelled" ? !isCancelled : isCancelled || s.identity.status !== archiveStatus) return false;
      }
      if (q) {
        const hay = `${s.identity.orderRef} ${s.record.order.customer_label || ""} ${operatorOf(s)} ${s.identity.wechatId || ""} ${s.identity.liveRoomCode || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return filtered.slice().sort((a, b) => {
      if (archiveSort === "amount_desc") {
        return Number(amount(b.identity.amount) - amount(a.identity.amount)) || b.identity.businessDate.localeCompare(a.identity.businessDate);
      }
      return b.identity.businessDate.localeCompare(a.identity.businessDate) || b.identity.orderRef.localeCompare(a.identity.orderRef);
    });
  }, [allBookings, archiveQuick, archiveStatus, search, archiveSort]);

  const archiveSummary = useMemo(() => {
    let validAmount = 0n;
    let cancelledAmount = 0n;
    let cancelledCount = 0;
    let privateCount = 0;
    for (const s of archives) {
      const val = amount(s.identity.amount);
      if (s.record.order.cancelled) {
        cancelledAmount += val;
        cancelledCount += 1;
      } else {
        validAmount += val;
        if (channelOf(s) === "private") privateCount += 1;
      }
    }
    return { validAmount, cancelledAmount, cancelledCount, privateCount };
  }, [archives]);

  const jumpToPersonAccount = (operatorName: string, wechatId: string) => {
    const matched = data?.accounts.find((a) => a.wechatId === wechatId);
    setF((current) => ({ ...current, operator: operatorName, account: matched ? matched.id : "" }));
    setSearch(matched ? "" : wechatId);
    setArchiveQuick("all");
    setArchiveStatus("");
    setTab("orders");
  };

  const countPending = stats?.pending.filter((p) => p.balance !== null).length || 0;
  const pendingIncomplete = stats?.pending.some(
    (p) =>
      p.kind === "资料待补" &&
      p.missing !== "经办客服" &&
      p.missing !== "客户姓名" &&
      p.missing !== "直播间" &&
      /应收|付款归属|抵扣|关联/.test(p.missing || "")
  );

  const peoplePanel = stats && (
    <>
      <div className="sp-receipts sp-receipts-card">
        <span>参与开单客服 <b>{people.length} 人</b></span>
        <span>直播间开单合计 <b>{stats.unknownLive ? "待核对" : short(stats.liveTurnover)}</b></span>
        <span>客服私推合计 <b>{stats.privateCount ? short(stats.privateTurnover) : "¥0.00"}</b></span>
        <span className="is-jade">本组基准营业额 <b>{stats.teamUnknownBookings ? "待核对" : short(stats.teamTurnover)}</b></span>
      </div>

      <section className="card sp-people-head-card">
        <div className="sp-section-title" style={{ marginBottom: 0 }}>
          <div>
            <h2>
              客服贡献
              <InfoTip
                label="本组贡献口径"
                text="以同一日期、授权小组及当前直播间/人设范围的开单营业额为分母。选择某位客服或某个接待账号不会改变本组分母；个人金额按业务当时登记的经办人归属。"
              />
            </h2>
            <p className="sp-team-basis">本组同期营业额 {stats.teamUnknownBookings ? "待核对" : short(stats.teamTurnover)} · 筛选客服不改变本组基准</p>
          </div>
          <div className="sp-seg-control" role="group" aria-label="客服贡献排序">
            {([["turnover", "开单营业额"], ["paid", "客户已付款"], ["pending", "待收款"]] as const).map(([key, label]) => (
              <button type="button" key={key} aria-pressed={sort === key} onClick={() => setSort(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {!people.length ? (
        <section className="card"><p className="empty-state">当前范围暂无客服记录</p></section>
      ) : (
        <div className="sp-people-list">
          {people.map((p, index) => {
            const share = teamShare(p.turnover, stats.teamTurnover, stats.teamUnknownBookings);
            const pendingCount = p.pending.filter((x) => x.balance !== null).length;
            const pendingHasMissing = p.pending.some((x) => /应收|付款归属|抵扣|关联/.test(x.missing || ""));
            const accountRows = p.accounts.map((account) => {
              const records = p.sources.filter((s) => (s.record.order.wechat_id || s.identity.wechatId || "原账号") === account);
              const subtotal = aggregate(records, { ...f, operator: p.name });
              return { account, count: subtotal.valid.length, turnover: subtotal.turnover, unknown: subtotal.unknownBookings };
            });
            const maxAcctTurnover = accountRows.reduce((m, r) => (r.turnover > m ? r.turnover : m), 1n);

            return (
              <article className="card sp-person-card" key={p.name}>
                <div className="sp-person-head">
                  <span className={`sp-rank-badge ${index === 0 ? "is-top" : ""}`}>{index + 1}</span>
                  <strong className="sp-person-name">{p.name}</strong>
                  <div className="sp-share-wrap" aria-label={`${p.name}的本组开单贡献`}>
                    <div className="sp-share-track">
                      <div className="sp-share-fill" style={{ width: `${Math.min(100, Math.max(0, share ?? 0)).toFixed(1)}%` }} />
                    </div>
                    <span className="sp-share-pct">{share !== null ? `${share.toFixed(1)}%` : "-"}</span>
                    <small className="sp-share-label">本组贡献</small>
                  </div>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => {
                      change("operator", p.name);
                      setTab("orders");
                    }}
                  >
                    查看订单 →
                  </button>
                </div>

                <dl className="sp-person-values">
                  <div>
                    <dt>有效开单</dt>
                    <dd>{p.count} 笔</dd>
                  </div>
                  <div>
                    <dt>直播间开单</dt>
                    <dd>{p.unknown ? "待核对" : short(p.liveTurnover)}</dd>
                  </div>
                  <div>
                    <dt>客服私推</dt>
                    <dd>
                      {short(p.privateTurnover)}
                      <small> · {p.privateCount} 笔</small>
                    </dd>
                  </div>
                  <div className="sp-split-left">
                    <dt>客户已付款</dt>
                    <dd className="is-jade">{fxValue(fx?.people[p.name], fxLoading)}</dd>
                  </div>
                  <div>
                    <dt>待收款</dt>
                    <dd className={pendingCount > 0 || pendingHasMissing ? "is-gold" : ""}>
                      {pendingHasMissing ? "待核对" : fxValue(fx?.peoplePending[p.name], fxLoading)}
                      <small> · {pendingCount} 项</small>
                    </dd>
                  </div>
                </dl>

                <details className="sp-acct-details">
                  <summary>接待账号明细 · {p.accounts.length}</summary>
                  <div className="sp-acct-panel">
                    {accountRows.length ? (
                      accountRows.map((row) => {
                        const pct = row.unknown ? 0 : Number((row.turnover * 100n) / maxAcctTurnover);
                        return (
                          <div className="sp-acct-row" key={row.account}>
                            <span className="sp-acct-name">{row.account}</span>
                            <small>{row.count} 笔</small>
                            <div className="sp-acct-bar">
                              <div className="sp-acct-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                            <b className="sp-acct-amt">{row.unknown ? "待核对" : short(row.turnover)}</b>
                            <button
                              type="button"
                              className="text-action sp-acct-btn"
                              onClick={() => jumpToPersonAccount(p.name, row.account)}
                            >
                              筛该号 ›
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <p className="empty-state">本期无业务记录</p>
                    )}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </>
  );

  const ordersPanel = (
    <>
      <div className="sp-receipts sp-receipts-card">
        <span>匹配订单 <b>{archives.length} 笔</b></span>
        <span>有效订单合计 <b>{short(archiveSummary.validAmount)}</b></span>
        <span>客服私推 <b>{archiveSummary.privateCount} 笔</b></span>
        <span>已跑单冲抵 <b>{short(archiveSummary.cancelledAmount)}（{archiveSummary.cancelledCount} 笔）</b></span>
      </div>

      <section className="card sp-orders-toolbar-card">
        <div className="sp-section-title">
          <h2>订单档案 · {archives.length} 笔</h2>
          {(archiveQuick !== "all" || archiveStatus || search.trim()) && (
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setArchiveQuick("all");
                setArchiveStatus("");
                setSearch("");
              }}
            >
              清除本栏筛选
            </button>
          )}
        </div>

        <div className="sp-quick-pills" role="group" aria-label="快捷类型筛选">
          {([
            ["all", `全部 ${archiveCounts.all}`],
            ["live", `直播间 ${archiveCounts.live}`],
            ["private", `客服私推 ${archiveCounts.private}`],
            ["open", `待付款/制作中 ${archiveCounts.open}`],
            ["cancelled", `已跑单 ${archiveCounts.cancelled}`],
          ] as const).map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={`sp-pill ${key === "open" ? "is-gold-pill" : ""}`}
              aria-pressed={archiveQuick === key}
              onClick={() => setArchiveQuick(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="sp-orders-controls">
          <Field label="搜索客户/订单/经办客服">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="客户名、订单号、客服或账号" />
          </Field>
          <Field label="订单状态">
            <select value={archiveStatus} onChange={(e) => setArchiveStatus(e.target.value)}>
              <option value="">全部状态</option>
              {["placed", "in_production", "shipped", "refunded"].map((s) => (
                <option value={s} key={s}>
                  {labelOrderStatus(s)}
                </option>
              ))}
              <option value="cancelled">已跑单</option>
            </select>
          </Field>
          <Field label="排序方式">
            <select value={archiveSort} onChange={(e) => setArchiveSort(e.target.value as ArchiveSort)}>
              <option value="date_desc">按开单日期倒序</option>
              <option value="amount_desc">按订单金额从高到低</option>
            </select>
          </Field>
        </div>
      </section>

      {!archives.length ? (
        <section className="card">
          <p className="empty-state">所选开单日期与分类下暂无订单；历史欠款可从「业绩总览」的待跟进列表进入。</p>
        </section>
      ) : (
        <div className="sp-order-list">
          {archives.map((s) => {
            const isCancelled = !!s.record.order.cancelled;
            const isPrivate = channelOf(s) === "private";
            const isOpen = !isCancelled && (s.identity.status === "placed" || s.identity.status === "in_production");
            const badgeClass = isCancelled
              ? "sp-badge is-muted"
              : s.identity.status === "shipped"
                ? "sp-badge is-jade"
                : isOpen
                  ? "sp-badge is-gold"
                  : "sp-badge is-slate";

            return (
              <button
                type="button"
                key={s.identity.id}
                className={`sp-order-card ${isOpen ? "is-open" : ""} ${isCancelled ? "is-cancelled" : ""}`}
                onClick={() => onSelectOrder(s.identity.id)}
              >
                <div className="sp-order-top">
                  <div className="sp-order-id-group">
                    <strong>{s.record.order.customer_label || "客户待补"}</strong>
                    <span className="sp-order-ref">{s.identity.orderRef}</span>
                    {isPrivate ? (
                      <span className="sp-badge is-slate">客服私推 · 不计代购费</span>
                    ) : (
                      <span className="sp-badge is-jade">{s.identity.liveRoomCode || "直播间"}</span>
                    )}
                  </div>
                  <span className={badgeClass}>{isCancelled ? "已跑单" : labelOrderStatus(s.identity.status)}</span>
                </div>

                <div className="sp-order-bottom">
                  <small className="sp-order-meta">
                    {s.identity.businessDate} · 经办：{operatorOf(s)} · {isPrivate ? "私推渠道" : s.identity.wechatId || "原账号"}
                  </small>
                  <div className="sp-order-right">
                    <div className="sp-order-amt-wrap">
                      <b className={isCancelled ? "is-strike" : ""}>{yuan(s.identity.amount)}</b>
                      <small>{isCancelled ? "已计入跑单冲抵" : "订单合计"}</small>
                    </div>
                    <span className="sp-order-cta">查看档案 →</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <>
      <div className="sp-workspace" hidden={!!selectedId} aria-busy={loading}>
        <header className="sp-heading">
          <div>
            <p className="eyebrow">小组业绩 · 客服贡献 · 客户跟进</p>
            <h1>
              本组业绩 <InfoTip label="业绩统计口径" text={basis} />
            </h1>
          </div>
          <button className="secondary" disabled={loading} onClick={() => setVersion((n) => n + 1)}>
            刷新
          </button>
        </header>

        <div className="sp-toolbar">
          <div className="sp-dates">
            <div className="sp-presets">
              {["今日", "昨日", "本月"].map((label) => (
                <button
                  type="button"
                  className="secondary"
                  key={label}
                  aria-pressed={
                    label === "今日"
                      ? f.from === today && f.to === today
                      : label === "昨日"
                        ? f.from === shiftDay(today, -1) && f.to === f.from
                        : f.from === today.slice(0, 8) + "01" && f.to === today
                  }
                  onClick={() => {
                    setF({
                      ...f,
                      from: label === "本月" ? today.slice(0, 8) + "01" : label === "昨日" ? shiftDay(today, -1) : today,
                      to: label === "昨日" ? shiftDay(today, -1) : today,
                    });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {teamOptions.length > 1 && (
              <>
                <span className="sp-divider-v" aria-hidden="true" />
                <div className="sp-presets" role="group" aria-label="按小组分类查看">
                  <button type="button" className="secondary" aria-pressed={!f.team} onClick={() => change("team", "")}>
                    全部小组
                  </button>
                  {teamOptions.map((t) => (
                    <button type="button" key={t} className="secondary" aria-pressed={f.team === t} onClick={() => change("team", t)}>
                      {t}
                    </button>
                  ))}
                </div>
              </>
            )}

            <small className="sp-range-caption">{f.from === f.to ? f.to.slice(5) : `${f.from.slice(5)} 至 ${f.to.slice(5)}`}</small>

            <details className="sp-custom-dates">
              <summary>日期筛选</summary>
              <div className="sp-date-fields">
                <label>
                  开始
                  <input aria-label="业绩开始日期" type="date" max={f.to || today} value={f.from} onChange={(e) => change("from", e.target.value)} />
                </label>
                <label>
                  结束
                  <input aria-label="业绩结束日期" type="date" min={f.from} max={today} value={f.to} onChange={(e) => change("to", e.target.value)} />
                </label>
              </div>
            </details>

            <details className="sp-filters">
              <summary>筛选{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}</summary>
              <div className="grid two">
                {teamOptions.length > 1 && (
                  <Field label="所属小组">
                    <select value={f.team || ""} onChange={(e) => change("team", e.target.value)}>
                      <option value="">全部小组</option>
                      {teamOptions.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="经办客服">
                  <select value={f.operator} onChange={(e) => change("operator", e.target.value)}>
                    <option value="">全部客服</option>
                    {[...new Set([...options(operatorOf), ...(data?.accounts.map((a) => a.holderName || "").filter(Boolean) || [])])].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </Field>
                <Field label="接待账号">
                  <select value={f.account} onChange={(e) => change("account", e.target.value)}>
                    <option value="">全部本组账号</option>
                    {data?.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.wechatId}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="人设/主页">
                  <select value={f.persona} onChange={(e) => change("persona", e.target.value)}>
                    <option value="">全部人设/主页</option>
                    {options((s) => s.identity.personaCode || s.identity.personaName || "").map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="直播间">
                  <select value={f.room} onChange={(e) => change("room", e.target.value)}>
                    <option value="">全部直播间</option>
                    {options((s) => s.identity.liveRoomCode || "").map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setF({ ...f, team: "", operator: "", account: "", persona: "", room: "" })}
                  >
                    清除分类筛选
                  </button>
                </div>
              </div>
            </details>
          </div>
        </div>

        {!validRange && (
          <p className="error" role="alert">
            请选择有效的起止日期，结束日期不能晚于今日。
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
            <button className="text-action" onClick={() => setVersion((n) => n + 1)}>
              重新读取
            </button>
          </p>
        )}

        {loading ? (
          <section className="card" role="status">
            正在读取本组订单与收款…
          </section>
        ) : (
          stats && (
            <>
              <div className="sp-kpis" aria-label="本组业绩汇总">
                <article className="sp-kpi-hero">
                  <span>直播间开单</span>
                  <strong>{stats.unknownLive ? "待核对" : short(stats.liveTurnover)}</strong>
                  <small>料价+代购费 · 不含私推</small>
                </article>
                <article className="sp-kpi-paid">
                  <span>客户已付款</span>
                  <strong>{fxValue(fx?.paid, fxLoading)}</strong>
                  <small>付款日 · 含历史订单收款</small>
                </article>
                <article className={countPending > 0 || pendingIncomplete ? "sp-kpi-pending" : ""}>
                  <span>待收款</span>
                  <strong>{pendingIncomplete ? "待核对" : fxValue(fx?.pending, fxLoading)}</strong>
                  <small>
                    截至 {f.to.slice(5)} · {countPending} 项
                  </small>
                </article>
                <article>
                  <span>有效开单数</span>
                  <strong>
                    {stats.valid.length}
                    <small> 笔</small>
                  </strong>
                  <small>{stats.customers} 位客户</small>
                </article>
              </div>

              <p className="sp-private" aria-label="客服私推">
                客服私推 <b>{stats.privateCount ? short(stats.privateTurnover) : "¥0.00"}</b> · <b>{stats.privateCount} 笔</b> · 只计料价，不计入直播间开单。主管提成尚未计算。
              </p>

              <nav className="sp-tabs" aria-label="消费业绩视图">
                {([["overview", "业绩总览"], ["people", "客服贡献"], ["orders", "订单档案"]] as const).map(([value, label]) => (
                  <button type="button" aria-pressed={tab === value} key={value} onClick={() => setTab(value)}>
                    {label}
                  </button>
                ))}
              </nav>

              {tab === "overview" && (
                <>
                  <div className="sp-receipts sp-receipts-card">
                    <span>
                      开单款／历史未分类 <b>{fxValue(fx?.base, fxLoading)}</b>
                    </span>
                    <span>
                      售后收款 <b>{fxValue(fx?.after, fxLoading)}</b>
                    </span>
                    <span>
                      跑单冲抵 <b>{short(stats.cancelled)}</b>
                    </span>
                  </div>
                  <SupervisorOrderFollowup
                    pending={stats.pending}
                    today={today}
                    asOf={f.to}
                    onOpen={onSelectOrder}
                    onArchive={() => setTab("orders")}
                  />
                  <section className="card sp-compact-contribution">
                    <div className="sp-section-title">
                      <h2>客服贡献</h2>
                      <button type="button" className="text-action" onClick={() => setTab("people")}>
                        查看全部 →
                      </button>
                    </div>
                    <p className="sp-team-basis">本组同期营业额 {stats.teamUnknownBookings ? "待核对" : short(stats.teamTurnover)}</p>
                    <Ranking
                      label="客服贡献前三名"
                      rows={people.slice(0, 3).map((p) => ({
                        key: p.name,
                        label: p.name,
                        value: p.unknown ? null : Number(p.turnover) / 100,
                        display: p.unknown ? "待核对" : short(p.turnover),
                        note: `私推 ${short(p.privateTurnover)} · 本组贡献 ${
                          teamShare(p.turnover, stats.teamTurnover, stats.teamUnknownBookings) === null
                            ? "-"
                            : teamShare(p.turnover, stats.teamTurnover, stats.teamUnknownBookings)!.toFixed(1) + "%"
                        } · 有效开单 ${p.count} 笔`,
                      }))}
                      onOpen={(name) => {
                        change("operator", name);
                        setTab("orders");
                      }}
                    />
                  </section>
                  <section className="card sp-trend">
                    <div className="analysis-toolbar">
                      <h2>近七日趋势</h2>
                      <ChartStyleControl style={chartStyle} onChange={setChartStyle} />
                    </div>
                    <div className="analysis-tabs sp-trend-metrics" aria-label="本组趋势指标">
                      {([["turnover", "开单营业额"], ["receipts", "客户已付款"]] as const).map(([key, label]) => (
                        <button type="button" key={key} aria-pressed={trendMetric === key} onClick={() => setTrendMetric(key)}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="analysis-caption">
                      {days[0]} 至 {f.to} · 人民币{trendMetric === "receipts" ? "参考折算" : ""}
                    </p>
                    <AnalysisPlot
                      series={[
                        {
                          key: trendMetric,
                          label: trendMetric === "turnover" ? "开单营业额" : "客户已付款",
                          points: days.map((date, i) => {
                            const day = aggregate(stats.scoped, { ...f, from: date, to: date });
                            const items =
                              trendMetric === "turnover"
                                ? day.bookings.filter((s) => channelOf(s) !== "private").length
                                : paymentRows(stats.scoped, date, date).length;
                            return {
                              date,
                              value: !items
                                ? null
                                : trendMetric === "turnover"
                                  ? day.unknownLive
                                    ? null
                                    : money(day.liveTurnover)
                                  : fx?.days[i]?.cny ?? null,
                              reason: !items ? "无记录" : trendMetric === "turnover" ? "金额待核对" : "待折算",
                              count: items,
                              native: "",
                              estimated: trendMetric === "receipts",
                            };
                          }),
                        } satisfies TrendSeries,
                      ]}
                      style={chartStyle}
                      today={today}
                      selected={trendDay}
                      onSelect={setTrendDay}
                      label="本组业绩"
                    />
                  </section>
                </>
              )}

              {tab === "people" && peoplePanel}
              {tab === "orders" && ordersPanel}

              <footer className="sp-notes">
                <details>
                  <summary>统计口径与数据说明</summary>
                  <p>{basis}</p>
                  <p>
                    历史范围按当前有效记录重算，不能还原当时录入进度。未设约定付款日的订单仅标待跟进，不判逾期。姓名相同的经办人暂按同一人汇总；缺失姓名归入「{UNKNOWN}」。
                  </p>
                  <p>
                    外币收款按付款日参考汇率；待收款按所选结束日期参考汇率，仅供管理查看。各分项独立四舍五入，可能有分位差异；明细保留原币。
                  </p>
                  <p>
                    待补资料 {stats.pending.filter((p) => p.kind === "资料待补").length} 项 · 开单金额待核对 {stats.unknownBookings} 笔
                  </p>
                </details>
                {(fx?.paid.hasForeign || fx?.pending.hasForeign) && (
                  <small>
                    人民币参考折算{fx?.paid.stale || fx?.pending.stale ? " · 行情更新延迟" : ""} ·{" "}
                    <a href="https://exchangerate.dev" target="_blank" rel="noreferrer">
                      Rates by Exchangerate.dev
                    </a>
                  </small>
                )}
              </footer>
            </>
          )
        )}
      </div>
      {selectedId && <OrderWorkspace today={today} user={user} selectedId={selectedId} onSelectOrder={onSelectOrder} onOrderDeleted={() => setVersion((v) => v + 1)} />}
    </>
  );
                    }

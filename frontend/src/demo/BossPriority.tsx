import { useEffect, useState, type ReactNode } from "react";
import { InfoTip } from "../InfoTip";
import "./boss-priority.css";

export type BossStats = {
  live: string;
  private: string;
  total: string;
  count: number;
  privateShare: number | null;
  afterSales?: string;
  avgOrder?: string;
};
type Member = BossStats & {
  id: string;
  name: string;
  team: string;
  sample: boolean;
  fans: number | null;
  effective: number | null;
  invalid: number | null;
  pendingInvalid: number;
};
type Room = BossStats & { id: string; name: string; team: string | null; status: string; members: Member[] };
export type DailyExpense = { id: string; date: string; category: string; amount: string; purpose: string; operator: string; proof: string };
export type BossTrendRow = {
  date: string;
  total: string | null;
  grossProfit?: string | null;
  adSpendCny?: string | null;
  adSpendUsd?: string | null;
  operatingCost: string | null;
};
export type ChannelProfitRow = {
  id: string;
  name: string;
  roomCode: string;
  isPrivate: boolean;
  count: number;
  turnover: string;
  materialAndAfterSale: string;
  thirdPartyFee: string;
  adSpendCny: string;
  grossProfit: string;
  grossMargin: number;
};
export type BossPriorityData = {
  version: string;
  period: { from: string; to: string };
  performance: BossStats;
  grossProfit?: {
    amount: string;
    margin: number;
    materialCost: string;
    afterSaleCost: string;
    thirdPartyFee: string;
    adSpendUsd: string;
    adSpendCny: string;
    missingMaterialCostCount: number;
  };
  acquisition?: {
    totalFans: number;
    effectiveFans: number | null;
    costPerEffectiveFanCny: string | null;
  };
  structure?: {
    estimatedNetProfit: string;
    netMargin: number;
    includesPayroll: boolean;
    items: { key: string; label: string; amount: string; ratio: number }[];
  };
  attention?: {
    pendingPaymentVerifications: number;
    missingMaterialCostOrders: number;
    pendingExpensesAndWarehouse: number;
  };
  days: { date: string; total: string | null; operatingCost: string | null }[];
  trend?: BossTrendRow[];
  rooms: Room[];
  channelProfits?: ChannelProfitRow[];
  expenses: {
    registered: string | null;
    recordedSubtotal?: string;
    dailyTotal?: string;
    approvedReimbursements?: string;
    approvedReimbursementCount?: number;
    payrollTotal?: string | null;
    payrollStatus?: string;
    status: string;
    categories: { key: string; label: string; amount: string | null; count: number; status: string }[];
    records: DailyExpense[];
  };
  definitions: { performance: string; grossProfit?: string; fans: string; expenses: string };
};

export const expenseLabels: Record<string, string> = { rent: "房租", utilities: "水电", salary: "员工工资", hospitality: "接待费用", other: "其他费用" };
const yuan = (v: string | null | undefined) => {
  if (v == null) return "—";
  const num = Number(v);
  if (!Number.isFinite(num)) return "—";
  const abs = Math.abs(num).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num < 0 ? `-¥${abs}` : `¥${abs}`;
};
const share = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "%");
const pct1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "0.0%" : `${v.toFixed(1)}%`);

export const bossPriorityApi = import.meta.env.MODE === "demo" ? "/api/demo/boss-priority" : "/api/dashboard/boss-priority";

export default function BossPriority({
  from,
  to,
  tick,
  priorityData,
  priorityError,
  onRetry,
  onSalary,
  onProfitDetail,
  receipts,
  ads
}: {
  from: string;
  to: string;
  tick: number;
  priorityData?: BossPriorityData | null;
  priorityError?: string;
  onRetry?: () => void;
  onSalary?: () => void;
  onProfitDetail?: () => void;
  receipts?: ReactNode;
  ads?: (ctx: { total: string | undefined; data: BossPriorityData | null }) => ReactNode;
}) {
  const managed = priorityData !== undefined;
  const [localData, setLocalData] = useState<BossPriorityData | null>(null);
  const [localError, setLocalError] = useState("");
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<"home" | "rooms" | "expenses">("home");
  const [roomId, setRoomId] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    if (managed) return;
    const controller = new AbortController();
    setLocalData(null);
    setLocalError("");
    fetch(bossPriorityApi + "?" + new URLSearchParams({ from, to }), { signal: controller.signal, cache: "no-store", credentials: "include" })
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok || payload.version !== "boss-priority/v1") throw Error(payload.error || "首页数据读取失败");
        if (!controller.signal.aborted) setLocalData(payload);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setLocalError(cause instanceof Error ? cause.message : "读取失败");
      });
    return () => controller.abort();
  }, [managed, from, to, tick, retry]);

  const data = managed ? (priorityData ?? null) : localData;
  const error = managed ? (priorityError ?? "") : localError;

  const needsReview = data?.rooms.find((item) => item.status === "unassigned" && item.count > 0);
  const listedRooms = data?.rooms.filter((item) => item.status !== "unassigned") ?? [];
  const room = listedRooms.find((item) => item.id === roomId);

  function open(next: typeof view) {
    setView(next);
    setRoomId("");
    setCategory("");
  }

  if (error) {
    return (
      <section className="boss-priority">
        <p className="error" role="alert">{error}</p>
        <button type="button" onClick={() => (onRetry ? onRetry() : setRetry((n) => n + 1))}>重试主数据</button>
      </section>
    );
  }

  const gp = data?.grossProfit;
  const afterSaleAndFee = gp ? (Number(gp.afterSaleCost || 0) + Number(gp.thirdPartyFee || 0)).toFixed(2) : null;
  const recordedSubtotal = data ? (data.expenses.recordedSubtotal ?? data.expenses.registered ?? "0.00") : null;
  const totalTurnoverNum = Number(data?.performance.total || 0);
  const opsSharePct = data && totalTurnoverNum > 0 && recordedSubtotal != null
    ? `${((Number(recordedSubtotal) / totalTurnoverNum) * 100).toFixed(1)}%`
    : "0.0%";
  const payrollReady = data?.expenses.payrollStatus === "ready" && data?.expenses.payrollTotal != null;
  const gpNegative = gp ? Number(gp.amount) < 0 : false;

  return (
    <section className={"boss-priority" + (view !== "home" ? " bp-detail" : "")} aria-label="优先经营数据">
      {view === "home" ? (
        <div className="bp-primary-grid">
          {/* 1. 总业绩（有效开单） */}
          <article className="bp-hero" aria-label="总业绩">
            <header>
              <h2>总业绩（有效开单）</h2>
              <InfoTip inline label="总业绩口径" text={data?.definitions.performance || "直播间开单与客服私推合计。"} />
              <span className="bp-chip bp-chip-hero">
                {data ? `有效 ${data.performance.count} 单 · 客单 ${yuan(data.performance.avgOrder ?? "0.00")}` : "读取中"}
              </span>
            </header>
            <strong className="bp-main-number">{data ? yuan(data.performance.total) : "—"}</strong>
            <div className="bp-mini">
              <span>直播间开单 <b>{data ? yuan(data.performance.live) : "—"}</b></span>
              <span>客服私推 <b>{data ? yuan(data.performance.private) : "—"}</b></span>
              <span>售后追加 <b>{data ? yuan(data.performance.afterSales ?? "0.00") : "—"}</b></span>
            </div>
            {receipts}
            <button type="button" className="bp-link" disabled={!data} onClick={() => open("rooms")}>
              按直播间与客服拆解业绩 →
            </button>
          </article>

          {/* 2. 经营毛利 */}
          <article className="bp-profit" aria-label="经营毛利">
            <header>
              <h2>经营毛利</h2>
              <InfoTip inline label="经营毛利口径" text={data?.definitions.grossProfit || "计算公式：有效业绩 - 料子本钱（白条价/库房结算价） - 售后公司成本 - 第三方扣点 - 投流成本（折合人民币）。"} />
              <span className={"bp-chip " + (gpNegative ? "bp-danger" : "bp-jade")}>
                毛利率 {gp ? pct1(gp.margin) : "—"}
              </span>
            </header>
            <strong className={"bp-main-number" + (gpNegative ? " is-negative" : "")}>{gp ? yuan(gp.amount) : "—"}</strong>
            <small className="bp-subline">
              {gp && gp.missingMaterialCostCount > 0 ? <span className="bp-warn-text">待补本价 {gp.missingMaterialCostCount} 单</span> : "料本已录齐"}
            </small>
            <dl className="bp-deductions">
              <div>
                <dt>料子本钱（白条/库房价）</dt>
                <dd className="bp-neg">{gp ? `-${yuan(gp.materialCost)}` : "—"}</dd>
              </div>
              <div>
                <dt>售后成本 + 第三方扣点</dt>
                <dd className="bp-neg">{afterSaleAndFee != null ? `-${yuan(afterSaleAndFee)}` : "—"}</dd>
              </div>
              <div>
                <dt>投流成本（折合人民币）</dt>
                <dd className="bp-neg">{gp ? `-${yuan(gp.adSpendCny)}` : "—"}</dd>
              </div>
            </dl>
            <button type="button" className="bp-link" disabled={!data} onClick={() => (onProfitDetail ? onProfitDetail() : open("rooms"))}>
              查看毛利与成本明细 →
            </button>
          </article>

          {/* 3. 投流成本 */}
          {ads?.({ total: data?.performance.total, data })}

          {/* 4. 公司运营成本 */}
          <article className="bp-ops-cost" aria-label="公司运营成本">
            <header>
              <h2>公司运营成本</h2>
              <InfoTip label="运营成本口径" text={data?.definitions.expenses || "按已登记日常运营、已核报销与固定薪资汇总。"} />
              <span className={"bp-chip " + (payrollReady ? "bp-jade" : "bp-gold")}>
                占业绩 {opsSharePct} · {payrollReady ? "含已核工资" : "工资待核"}
              </span>
            </header>
            <strong className="bp-main-number">{!data ? "—" : yuan(recordedSubtotal)}</strong>
            <small className="bp-subline">
              {payrollReady ? "已含当期财务核定工资" : "已登记运营开支小计（不含待核工资）"}
            </small>
            <dl className="bp-ops-breakdown">
              <div>
                <dt>日常运营（房租/水电/招待等）</dt>
                <dd>{data ? yuan(data.expenses.dailyTotal ?? data.expenses.registered ?? "0.00") : "—"}</dd>
              </div>
              <div>
                <dt>已核报销（含直播间费用）</dt>
                <dd>{data ? yuan(data.expenses.approvedReimbursements ?? "0.00") : "—"}</dd>
              </div>
              <div>
                <dt>固定薪资</dt>
                <dd className={payrollReady ? "" : "bp-muted-val"}>
                  {!data ? "—" : payrollReady ? yuan(data.expenses.payrollTotal) : "待月底财务核算"}
                </dd>
              </div>
            </dl>
            <button type="button" className="bp-link" disabled={!data} onClick={() => open("expenses")}>
              查看运营费用明细 →
            </button>
          </article>
        </div>
      ) : (
        <>
          <div className="bp-backbar">
            <button type="button" className="secondary" onClick={() => (room ? setRoomId("") : open("home"))}>
              ← {room ? "返回直播间" : "返回经营总览"}
            </button>
            {room && (
              <button type="button" className="text-action" onClick={() => open("home")}>
                经营总览
              </button>
            )}
          </div>
          <header className="bp-detail-heading">
            <h2>
              {view === "expenses" ? (
                "公司运营成本"
              ) : room ? (
                room.team ? `${room.name} · ${room.team}` : room.name
              ) : (
                <>
                  总业绩<span className="bp-room-heading-qualifier"> · 按直播间</span>
                </>
              )}
            </h2>
            <span className="bp-detail-date">{from} 至 {to}</span>
          </header>
          {!data ? (
            <p role="status">正在读取…</p>
          ) : view === "rooms" ? (
            !room ? (
              <>
                <div className="bp-room-list">
                  {listedRooms.map((item) => (
                    <button type="button" className="bp-room" key={item.id} onClick={() => setRoomId(item.id)}>
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.status === "pending" ? "资料待补，暂不分配小组" : item.team}</small>
                      </span>
                      <span>
                        <b>{item.status === "pending" ? "资料待补" : yuan(item.total)}</b>
                        {item.status !== "pending" && <small>私推占比 {share(item.privateShare)} · {item.count}笔</small>}
                      </span>
                      <span aria-hidden="true">›</span>
                      {item.status !== "pending" && (
                        <span className="bp-room-split">
                          <span>直播间 <b>{yuan(item.live)}</b></span>
                          <span>私推 <b>{yuan(item.private)}</b></span>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {needsReview && (
                  <p className="bp-unassigned">
                    全公司总业绩中有 {needsReview.count} 笔、{yuan(needsReview.total)} 待确认直播间。
                  </p>
                )}
              </>
            ) : room.status === "pending" ? (
              <p className="empty-state">二号直播间（海外三线，文强组）的客服小组和人员资料待补，不复制秋菊组数据。</p>
            ) : (
              <>
                <div className="bp-room-totals">
                  <span>开单合计 <b>{yuan(room.total)}</b></span>
                  <span>直播间 <b>{yuan(room.live)}</b></span>
                  <span>私推 <b>{yuan(room.private)}</b></span>
                  <span>私推占比 <b>{share(room.privateShare)}</b></span>
                </div>
                <p className="hint">
                  已登记人员没有业务记录时显示未填报；演练成员与实际人员分开标注。
                  <InfoTip label="成员数据口径" text={data.definitions.fans + " 业绩按开单当时的经办人归属，换号不改旧单；私推占比＝私推金额÷开单合计。"} />
                </p>
                <div className="bp-members">
                  {room.members.map((member) => (
                    <article key={member.id}>
                      <header>
                        <div>
                          <strong>{member.name}</strong>
                          <small>{member.sample ? "演练成员" : member.team}</small>
                        </div>
                        <span className="bp-chip">私推占比 {share(member.privateShare)}</span>
                      </header>
                      <dl>
                        {[
                          ["加粉总数", member.fans ?? "未填报"],
                          ["有效粉", member.effective ?? "未填报"],
                          ["无效粉", member.invalid ?? (member.pendingInvalid ? "待复核" : "未填报")],
                          ["直播间开单", member.count ? yuan(member.live) : "—"],
                          ["私推开单", member.count ? yuan(member.private) : "—"],
                          ["开单合计", member.count ? yuan(member.total) : "—"]
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  ))}
                </div>
                {!room.members.length && <p className="empty-state">成员资料待补。</p>}
              </>
            )
          ) : (
            <>
              <p className="notice">
                {payrollReady ? "已含当期财务核定工资。" : "工资待月底财务核算；以下为已登记日常运营费用与已核报销（含直播间费用，不含已计入订单成本的业务垫付）。"}
              </p>
              <div className="bp-room-totals">
                <span>已登记运营小计 <b>{yuan(recordedSubtotal)}</b></span>
                <span>日常运营 <b>{yuan(data.expenses.dailyTotal ?? data.expenses.registered ?? "0.00")}</b></span>
                <span>已核报销 <b>{yuan(data.expenses.approvedReimbursements ?? "0.00")}</b>（{data.expenses.approvedReimbursementCount ?? 0}笔）</span>
                {onSalary && (
                  <button type="button" className="bp-link" onClick={onSalary}>
                    查看工资汇总 →
                  </button>
                )}
              </div>
              <div className="bp-filters" role="group" aria-label="费用分类">
                {Object.entries({ "": "全部分类", rent: "房租", utilities: "水电", salary: "工资", hospitality: "接待", other: "其他" }).map(([key, label]) => (
                  <button type="button" key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>
                    {label}
                  </button>
                ))}
              </div>
              {data.expenses.records
                .filter((record) => !category || record.category === category)
                .map((record) => (
                  <article className="bp-expense-record" key={record.id}>
                    <div>
                      <strong>{expenseLabels[record.category]} · {record.purpose}</strong>
                      <small>{record.date} · 经办：{record.operator} · 凭证：{record.proof || "待补"}</small>
                    </div>
                    <b>{yuan(record.amount)}</b>
                  </article>
                ))}
              {!data.expenses.records.some((record) => !category || record.category === category) && (
                <p className="empty-state">
                  {category === "salary"
                    ? "员工工资待财务核算，不将月工资重复分摊到每日。"
                    : "该范围没有已登记日常费用，已核报销请前往财务报销台账查看。"}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

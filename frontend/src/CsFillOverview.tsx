import { yuan } from "./dashboardDisplay";
import type { PersonalFanPreset, PersonalFans, PersonalFillOverview } from "./leadApi";

const fanPeriods = [["day", "今日"], ["week", "本周"], ["month", "本月"]] as const;

export function CsFillOverview({data, fans, preset, onPreset, fanError}: {
  data: PersonalFillOverview | null;
  fans: PersonalFans | null;
  preset: PersonalFanPreset;
  onPreset: (value: PersonalFanPreset) => void;
  fanError?: string;
}) {
  const confirmed = data?.commission;
  const estimate = data?.commissionEstimate;
  const commission = confirmed ?? estimate?.amount;
  const invalid = fans?.invalid;
  const channels = [
    { label: "直播间成交", count: data?.liveCount, amount: data?.liveAmount },
    { label: "客服私推", count: data?.privateCount, amount: data?.privateAmount },
  ];
  return <section className="cs-fill-overview" aria-label="个人看板">
    <article className="card">
      <header className="cs-fans-heading">
        <h2>加粉数据</h2>
        <div className="fill-pills cs-fans-period" role="group" aria-label="加粉数据周期">
          {fanPeriods.map(([key, label]) =>
            <button type="button" className="secondary" key={key} aria-pressed={preset === key} onClick={() => onPreset(key)}>{label}</button>)}
        </div>
      </header>
      <div className="cs-overview-metric">新增客资 <strong>{fans ? fans.added + " 人" : "—"}</strong></div>
      <dl className="cs-fans-breakdown">
        <div><dt>有效</dt><dd>{fans && invalid != null ? fans.added - invalid + " 人" : "—"}</dd></div>
        <div><dt>无效</dt><dd>{invalid != null ? invalid + " 人" : "—"}</dd></div>
      </dl>
      <small className="hint">正常沟通 {fans ? fans.replied + " 人" : "—"}</small>
      {fanError && <small className="error" role="alert">{fanError}</small>}
    </article>
    <article className="card fill-hero">
      <header className="cs-fans-heading"><h2>本月业绩</h2><small>金额（人民币）</small></header>
      <div className="cs-overview-metric">有效开单 <strong>{data ? data.orderCount + " 单" : "—"}</strong></div>
      <dl className="cs-sales-breakdown">
        {channels.map(({label, count, amount}) =>
          <div key={label}><dt>{label}</dt><dd>{count != null ? count + " 单" : "—"}</dd><dd>{yuan(amount).replace("¥", "")}</dd></div>)}
      </dl>
    </article>
    <article className="card">
      <header className="cs-fans-heading"><h2>本月提成</h2></header>
      {commission != null ? <div className="cs-overview-metric">
        <strong>{yuan(commission)}</strong>
        <span className="cs-commission-status">{confirmed != null ? "财务已核定" : "预估"}</span>
      </div> : <div className="cs-overview-metric">{!data ? "—" : estimate ? "待核算" : "待财务核定"}</div>}
      {confirmed == null && !!estimate?.pendingCount && <small className="hint">
        {estimate.amount != null ? "另有 " : ""}{estimate.pendingCount} 笔待核算
      </small>}
      {commission != null && confirmed == null && <small className="hint">以财务核算为准</small>}
    </article>
  </section>;
}

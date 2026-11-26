import { yuan } from "./dashboardDisplay";
import type { PersonalFanPreset, PersonalFans, PersonalFillOverview } from "./leadApi";

export function CsFillOverview({data,fans,preset,onPreset,fanError}:{data:PersonalFillOverview|null;fans:PersonalFans|null;
  preset:PersonalFanPreset;onPreset:(value:PersonalFanPreset)=>void;fanError?:string}) {
  const confirmed = data?.commission;
  const estimate = data?.commissionEstimate;
  return <section className="cs-fill-overview" aria-label="个人看板">
    <article className="card">
      <header className="cs-fans-heading"><h2>加粉数据</h2>
        <div className="fill-pills cs-fans-period" role="group" aria-label="加粉数据周期">
          {([["day","今日"],["week","本周"],["month","本月"]] as const).map(([key,label])=>
            <button type="button" className="secondary" key={key} aria-pressed={preset===key} onClick={()=>onPreset(key)}>{label}</button>)}
        </div>
      </header>
      <strong>{fans?.added ?? "—"} 人</strong><span>新增客资</span>
      <dl className="cs-fans-breakdown"><div><dt>已开单</dt><dd>{fans?.booked ?? "—"} 人</dd></div>
        <div><dt>未开单</dt><dd>{fans ? fans.added-fans.booked : "—"} 人</dd></div></dl>
      <small className="hint">正常沟通 {fans?.replied ?? "—"} 人</small>
      {fanError&&<small className="error" role="alert">{fanError}</small>}
    </article>
    <article className="card fill-hero"><h2>本月业绩</h2><strong>{data?.orderCount ?? "—"} 单</strong><span>有效开单</span>
      <dl><div><dt>直播间成交</dt><dd>{yuan(data?.liveAmount)}</dd></div><div><dt>客服私推</dt><dd>{yuan(data?.privateAmount)}</dd></div></dl>
    </article>
    <article className="card"><h2>本月提成</h2>
      {confirmed!=null ? <><strong>{yuan(confirmed)}</strong><span>财务已核定</span></> : <>
        <strong>{yuan(estimate?.amount)}</strong>
        <span>{!data?"提成金额":estimate?.amount!=null?"预估提成":estimate?"待核算":"待财务核定"}</span>
        {!!estimate?.pendingCount&&<span className="hint">{estimate.amount!=null?"另有 ":""}{estimate.pendingCount} 笔待核算</span>}
        <p className="hint">以财务核算为准。</p>
      </>}
    </article>
  </section>;
}

import type { ReactNode } from "react";
import { yuan } from "./dashboardDisplay";
import type { PersonalFillOverview } from "./leadApi";

export function CsFillOverview({data,checkIn,onPerformance}:{data:PersonalFillOverview|null;checkIn?:ReactNode;onPerformance:()=>void}) {
  return <section className="cs-fill-overview" aria-label="个人看板">
    <article className="card"><h2>加粉</h2><strong>{data?.todayLeads ?? "—"} 条</strong><span>今日新增客资</span>
      <dl><div><dt>今日正常沟通</dt><dd>{data?.todayReplied ?? "—"} 人</dd></div><div><dt>本月累计加粉</dt><dd>{data?.monthFans ?? "—"} 人</dd></div></dl>
      {checkIn}
    </article>
    <article className="card fill-hero"><h2>本月业绩</h2><strong>{data?.orderCount ?? "—"} 单</strong><span>有效开单</span>
      <dl><div><dt>直播间成交</dt><dd>{yuan(data?.liveAmount)}</dd></div><div><dt>客服私推</dt><dd>{yuan(data?.privateAmount)}</dd></div></dl>
      <button type="button" className="secondary" onClick={onPerformance}>查看个人业绩 →</button>
    </article>
    <article className="card"><h2>本月提成</h2><strong>{data?.commission==null?"—":yuan(data.commission)}</strong>
      <span>{!data?"核定金额":data.commission==null?"待财务核定":"财务已核定"}</span>
      <p className="hint">以财务锁定的月度提成为准。</p>
    </article>
  </section>;
}

import {useEffect, useState} from 'react';
import type {LiveBusinessData} from '../api';
import type {LiveView} from '../liveBusinessNavigation';
import {InfoTip} from '../InfoTip';
import {yuan} from '../dashboardDisplay';
import './live-room-board.css';
import {RoomTrend} from './RoomTrend';
import {AnalysisPlot, ChartStyleControl, useChartStyle} from './AnalysisChart';
import {type TrendSeries} from './bossTrendData';

const roomNumber = new Map([['一号直播间',1],['二号直播间',2]]);
const cleanRoomName = (name: string) => name.replace(/\s*[（(][^）)]*[）)]\s*$/,'').trim() || name;
function compareRoomNumbers(a: string, b: string) {
  return (roomNumber.get(cleanRoomName(a)) ?? 3) - (roomNumber.get(cleanRoomName(b)) ?? 3) || a.localeCompare(b, 'zh-CN', {numeric:true});
}
function moneyText(v: string | null | undefined) {
  if (v == null) return '—';
  const num = Number(v);
  if (!Number.isFinite(num)) return '—';
  const abs = Math.abs(num).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  return num < 0 ? `-¥${abs}` : `¥${abs}`;
}
function pending(value:string|null|undefined,status?:string){return status==='unsupported_scope'?'当前维度不分摊':value==null?'待财务录入':yuan(value);}
type Props={today:string;data:LiveBusinessData|null;loading:boolean;failed:boolean;onOpen:(view:LiveView['view'],roomKey?:string)=>void;onOpenOrders?:()=>void};

export default function LiveRoomBoard({today,data,loading,failed,onOpen,onOpenOrders}:Props){
  const rooms=(data?.rooms??[]).filter(room=>room.key!=='__unassigned__').sort((a,b)=>compareRoomNumbers(a.roomCode,b.roomCode));
  const [selectedRoomKey,setSelectedRoomKey]=useState('');
  const [chartStyle,setChartStyle]=useChartStyle();
  const [selectedDate,setSelectedDate]=useState(today);

  useEffect(()=>{
    if(!rooms.length)return;
    if(!selectedRoomKey||!rooms.some(r=>r.key===selectedRoomKey)){
      setSelectedRoomKey(rooms[0].key);
    }
  },[rooms.map(r=>r.key).join(','), selectedRoomKey]);

  const activeRoom=rooms.find(r=>r.key===selectedRoomKey)??rooms[0]??null;
  const summary=data?.roomSummary;
  const t=data?.totals;
  const totalTurnover=summary?.totalTurnoverCny??t?.performanceCny??'0.00';
  const validCount=summary?.validOrderCount??t?.newOrderCount??0;
  const avgOrder=summary?.avgOrderCny??(validCount>0?(Number(totalTurnover)/validCount).toFixed(2):'0.00');
  const totalGp=summary?.totalGrossProfitCny??null;
  const gpMargin=summary?.grossMargin??(totalGp!=null&&Number(totalTurnover)>0?(Number(totalGp)/Number(totalTurnover))*100:0);
  const companyReceived=summary?.companyReceivedCny??t?.companyReceivedCny??'0.00';
  const pendingBalance=summary?.pendingBalanceCny??'0.00';
  const directExpenseTotal=summary?.totalDirectExpenseCny??t?.expenseCny??'0.00';

  const activeProfit=activeRoom?.profit;
  const activeTrend7d=activeRoom?.trend7d;
  const activeSeries:TrendSeries|null=activeRoom&&activeTrend7d?.length?{
    key:activeRoom.key,
    label:`${cleanRoomName(activeRoom.roomCode)}开单`,
    points:activeTrend7d.map(pt=>({date:pt.date,value:pt.amount,reason:pt.amount===null?'无记录':'',count:0,native:'',estimated:false}))
  }:null;

  return <div className="lr-board" aria-label="直播间经营看板" aria-busy={loading}>
    {/* 1. 顶部 4 张核心 KPI 卡片 */}
    <section className="lr-summary" aria-label="直播间经营汇总">
      <button className="lr-summary-hero" type="button" disabled={!data} onClick={()=>onOpen('income')}>
        <header><span>直播间有效业绩</span><em className="lr-kpi-pill is-hero">有效 {validCount} 单</em></header>
        <strong>{loading?'…':moneyText(totalTurnover)}</strong>
        <small>客单均价 {loading?'…':moneyText(avgOrder)} · 料价＋代购费</small>
      </button>

      <article className="lr-summary-profit">
        <header>
          <span>直播间合计毛利 <InfoTip label="直播间毛利口径" text="按「直播间有效业绩 - 料子本钱 - 人员场次费 - 售后成本 - 关联直播间已核报销」计算，明确不含全公司投流（投流在首页口径 A 统一核算）。"/></span>
          <em className={"lr-kpi-pill "+(totalGp!=null&&Number(totalGp)<0?"is-neg":"is-jade")}>毛利率 {loading?'—':`${gpMargin.toFixed(1)}%`}</em>
        </header>
        <strong className={totalGp!=null&&Number(totalGp)<0?"is-neg":""}>{loading?'…':moneyText(totalGp)}</strong>
        <small>不含全公司投流</small>
      </article>

      <button type="button" disabled={!data} onClick={()=>onOpen('income')}>
        <header><span>资金回流</span><em className="lr-kpi-pill is-gold">待收尾款 {loading?'…':moneyText(pendingBalance)}</em></header>
        <strong>{loading?'…':moneyText(companyReceived)}</strong>
        <small>财务已确认实收到账</small>
      </button>

      <button type="button" disabled={!data} onClick={()=>onOpen('expenses')}>
        <header><span>直播间直接费用</span><em className="lr-kpi-pill">3项合计</em></header>
        <strong>{loading?'…':moneyText(directExpenseTotal)}</strong>
        <small>场次 {moneyText(summary?.totalStaffCostCny)} · 售后 {moneyText(summary?.totalAfterSaleCostCny)} · 报销 {moneyText(summary?.totalRoomReimbursementCny)}</small>
      </button>
    </section>

    {/* 2. 各直播间横向对比表格 */}
    <section className="lr-compare-card" aria-label="各直播间横向对比">
      <header className="lr-section-heading">
        <div>
          <h2>各直播间横向对比</h2>
          <small>点击任意直播间行查看下方成本拆解与近 7 日开单趋势</small>
        </div>
        {onOpenOrders&&<button type="button" className="secondary lr-orders-btn" onClick={onOpenOrders}>全部订单档案 →</button>}
      </header>
      {loading?<p role="status">正在读取直播间经营数据…</p>:failed?<p className="notice">数据读取失败，请重试后查看。</p>:!rooms.length?<p className="notice">所选范围暂无直播间经营记录。</p>:<>
      <div className="lr-grid-table-wrap">
        <table className="lr-grid-table">
          <thead>
            <tr>
              <th>直播间 / 主播</th>
              <th>有效单</th>
              <th>有效业绩</th>
              <th>料子本钱</th>
              <th>直接费用 <InfoTip label="直接费用说明" text="含人员场次费 + 售后成本 + 主管关联该直播间的已核报销"/></th>
              <th>直播间毛利</th>
              <th>毛利率</th>
              <th>待收尾款</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map(r=>{
              const p=r.profit;
              const name=cleanRoomName(r.roomCode);
              const host=r.hosts.join('、')||'待补';
              const gp=p?.netLiveRoomProfitCny??p?.liveRoomProfitCny??null;
              const gpMarginVal=p?.netGrossMargin??(gp!=null&&Number(r.totals.performanceCny)>0?(Number(gp)/Number(r.totals.performanceCny))*100:null);
              const isSelected=activeRoom?.key===r.key;
              return (
                <tr key={r.key} className={isSelected?'is-selected':''} tabIndex={0} onClick={()=>setSelectedRoomKey(r.key)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelectedRoomKey(r.key);}}}>
                  <th scope="row">
                    <div className="lr-room-cell">
                      <strong>{name}</strong>
                      <span className="lr-host-pill">{host}</span>
                    </div>
                  </th>
                  <td>{r.totals.newOrderCount}</td>
                  <td>{moneyText(r.totals.performanceCny)}</td>
                  <td>{moneyText(p?.materialCostCny)}</td>
                  <td>{moneyText(p?.directExpenseCny)}</td>
                  <td className={gp!=null&&Number(gp)<0?'is-neg':'is-pos'}>{gp==null?'待核算':moneyText(gp)}</td>
                  <td><span className={'lr-margin-pill '+(gpMarginVal!=null&&gpMarginVal<0?'is-neg':'')}>{gpMarginVal==null?'—':`${gpMarginVal.toFixed(1)}%`}</span></td>
                  <td>{moneyText(p?.pendingBalanceCny??'0.00')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>}
    </section>

    {/* 3. 选中直播间的联动拆解与 7 日趋势 */}
    {activeRoom&&(
      <section className="lr-selected-grid" aria-label="选中直播间联动分析">
        <article className="lr-breakdown lr-finance">
          <header className="lr-panel-head">
            <div>
              <h3>{cleanRoomName(activeRoom.roomCode)} · 成本与毛利拆解</h3>
              <small>主播 {activeRoom.hosts.join('、')||'待补'} · 不含全公司投流</small>
            </div>
            <span className="lr-kpi-pill is-jade">
              毛利率 {activeProfit?.netGrossMargin!=null?`${activeProfit.netGrossMargin.toFixed(1)}%`:'—'}
            </span>
          </header>
          <dl>
            <div>
              <dt>料子本钱 <InfoTip label={`${cleanRoomName(activeRoom.roomCode)}料本来源`} text="优先采用开单卡「料子本钱」，缺省回退供货／配货款；跑单排除。"/></dt>
              <dd>{moneyText(activeProfit?.materialCostCny)}</dd>
            </div>
            <div>
              <dt>人员场次（主播 / 助理 / 演员）</dt>
              <dd>{pending(activeProfit?.staff.totalCny, activeProfit?.staff.status)}</dd>
            </div>
            <div>
              <dt>已登记售后费用</dt>
              <dd>{moneyText(activeProfit?.afterSaleCostCny??activeRoom.totals.expenseCny)}</dd>
            </div>
            <div>
              <dt>主管直播间报销</dt>
              <dd>{moneyText(activeProfit?.roomReimbursementCny??'0.00')}</dd>
            </div>
            <div className="lr-profit-total">
              <dt>直播间毛利（不含全公司投流）</dt>
              <dd>{activeProfit?.netLiveRoomProfitCny!=null?moneyText(activeProfit.netLiveRoomProfitCny):'待核算'}</dd>
            </div>
          </dl>
          {!!activeProfit?.roomReimbursementRecords?.length&&(
            <div className="lr-reim-notes">
              {activeProfit.roomReimbursementRecords.map(rec=>(
                <p className="lr-note" key={rec.id}>{rec.expense_date} · {rec.purpose}（¥{rec.amount} · {rec.claimant}）</p>
              ))}
            </div>
          )}
          <div className="lr-room-links">
            <button type="button" className="text-action" onClick={()=>onOpen('income',activeRoom.key)}>查看订单与收款 →</button>
            <button type="button" className="text-action" onClick={()=>onOpen('expenses',activeRoom.key)}>查看费用与成本明细 →</button>
          </div>
        </article>

        <article className="lr-breakdown lr-trend-panel">
          {activeSeries&&data?(
            <>
              <div className="lr-panel-head">
                <div>
                  <h3>{cleanRoomName(activeRoom.roomCode)} · 近 7 日开单趋势</h3>
                  <small>{activeSeries.points[0]?.date} 至 {activeSeries.points.at(-1)?.date} · 人民币</small>
                </div>
                <ChartStyleControl style={chartStyle} onChange={setChartStyle}/>
              </div>
              <AnalysisPlot series={[activeSeries]} style={chartStyle} today={today} selected={selectedDate} onSelect={setSelectedDate} label={`${cleanRoomName(activeRoom.roomCode)}近7日开单`}/>
            </>
          ):data?(
            <RoomTrend room={activeRoom.key} to={data.period.to} today={today} filters={data.selected}/>
          ):null}
        </article>
      </section>
    )}
  </div>;
}

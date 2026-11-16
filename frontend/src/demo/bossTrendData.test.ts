import { describe, expect, it } from "vitest";
import { buildTrend, daysIn, lineSegments, previousRange, sumPoints, type TrendPoint } from "./bossTrendData";
import type { LiveBusinessData, LiveBusinessEvent } from "../api";

const date="2026-11-12";
const quote=async(d:string,currency:"USD"|"TWD")=>({currency,date:d,sourceDate:d,rate:currency==="USD"?"7.000000":"0.200000",updatedAt:d+"T04:00:00Z",checkedAt:0,source:"test",delayed:false,stale:false});
function event(id:string,kind:LiveBusinessEvent['kind'],amount:string,day=date,room="A"):LiveBusinessEvent{return {id,kind,date:day,amount,currency:"CNY",order_id:id,label:id,category:"goods",order:{id,status:"placed",order_ref:id,customer_label:"虚构客户",persona_code:"",persona_name:"",live_room_code:room,host_name:"",customer_code:"",operator_name:"",wechat_id:""}};}
function source():LiveBusinessData {
  const cancelled=event("cancel","sale","330.00","2026-11-11");cancelled.order.cancelled=true;
  const twd=event("twd","receipt","1000.00");twd.currency="TWD";
  const events=[event("a","sale","1100.00"),event("b","sale","550.00",date,"B"),cancelled,event("charge","charge","90.00"),event("cost","expense","80.00"),twd,event("direct","receipt","50.00"),event("old","sale","400.00","2026-11-10")];
  return {events,options:[],rooms:[],ads:{scope:"company",spendUsd:"10.00",unknownCount:0,records:[{id:"ad",date,amount:"10.00",account:"广告户",persona:"人设"}]}} as unknown as LiveBusinessData;
}
describe("BOSS图表共用数据及统计口径",()=>{
  it("总览的上期参照按相邻等长期间独立加总，不把公司到账或追加收费算成营业额",async()=>{
    const data=source();
    data.events.push(event("prior-sale","sale","300.00","2026-11-11"),event("prior-receipt","receipt","90.00","2026-11-11"),event("prior-company","company","999.00","2026-11-11"),event("prior-charge","charge","888.00","2026-11-11"));
    const view=await buildTrend(data,{from:date,to:date},"",quote);
    expect(view.previous).toEqual({turnover:"300.00",receipts:"90.00",ads:null,expenses:null});
    expect(view.totals.turnover).toBe("1650.00");
  });
  it("开单不含追加、跑单回冲；收款不以公司到账代替；人民币按原日折算",async()=>{
    const data=source();data.events.push(event("settled","company","900.00"));
    const result=await buildTrend(data,{from:"2026-11-10",to:date},"",quote);
    expect(result.totals).toEqual({turnover:"2050.00",receipts:"250.00",ads:"70.00",expenses:"80.00"});
    expect(result.series.turnover.points.map(p=>p.value)).toEqual(["400.00","0.00","1650.00"]);
    expect(result.rooms.map(r=>sumPoints(r.points))).toEqual(["1500.00","550.00"]);
    expect(result.series.receipts.points.at(-1)?.native).toContain("1000.00 TWD");
  });
  it("直播间筛选改变业务序列，广告始终全公司；绘图形式不参与统计",async()=>{
    const data=source(),all=await buildTrend(data,{from:date,to:date},"",quote),one=await buildTrend(data,{from:date,to:date},"B",quote);
    expect(one.totals.turnover).toBe("550.00");expect(one.totals.receipts).toBeNull();expect(one.totals.ads).toBe(all.totals.ads);
    expect(one.rooms).toHaveLength(1);expect(one.rooms[0].key).toBe("B");expect(one).not.toHaveProperty("chartStyle");
  });
  it("无记录断线，明确0保留零，不能跨缺报日期插值",async()=>{
    const data=source();data.events.push(event("zero","sale","0.00","2026-11-09"));
    const result=await buildTrend(data,{from:"2026-11-08",to:date},"",quote);
    expect(result.series.turnover.points[0]).toMatchObject({value:null,reason:"无记录"});
    expect(result.series.turnover.points[1].value).toBe("0.00");
    const points=[null,"0.00","10.00",null,"20.00"].map((value,i)=>({date:String(i),value,reason:"",count:0,native:"",estimated:false})) as TrendPoint[];
    expect(lineSegments(points)).toEqual([[1,2],[4]]);
  });
  it("缺任一日汇率不以部分金额冒充合计；有数据的人民币序列仍可显示",async()=>{
    const result=await buildTrend(source(),{from:date,to:date},"",async()=>null);
    expect(result.totals.receipts).toBeNull();expect(result.totals.ads).toBeNull();expect(result.missingRates).toBe(true);
    expect(result.totals.turnover).toBe("1650.00");expect(result.totals.expenses).toBe("80.00");
  });
  it("上一等长区间跨月对齐，日期校验拒绝倒序、溢出日期或超长区间",()=>{
    expect(previousRange("2026-11-01","2026-11-07")).toEqual({from:"2026-10-25",to:"2026-10-31"});
    expect(daysIn(date,date)).toEqual([date]);expect(()=>daysIn("2026-02-30",date)).toThrow();expect(()=>daysIn(date,"2026-11-01")).toThrow();expect(()=>daysIn("2026-01-01",date)).toThrow();
  });
});

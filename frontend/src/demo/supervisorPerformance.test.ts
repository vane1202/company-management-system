import { describe, expect, it } from "vitest";
import { aggregate, convert, operatorOf, paymentRows, pendingFor, teamShare, UNKNOWN, type Selection, type Source } from "./supervisorPerformanceData";
import type { PaymentRecord, CsAccount } from "../api";

const today="2026-11-12";
const filter:Selection={from:today,to:today,operator:"",account:"",persona:"",room:""};
function source(id:string,operator:string,date=today):Source {
  return {identity:{id,userId:"account-1",operatorName:operator,businessDate:date,orderRef:id,amount:"110.00",status:"placed",isCustom:true,customProductCost:"0",laborCost:"0",shippingCost:"0",liveRoomCode:"room-1",personaCode:"persona-1"},
    record:{legacy:false,order:{id,order_ref:id,customer_label:id,business_date:date,amount:"110.00",status:"placed",display_name:"账号",wechat_id:"Messenger 固定号",custom_product_cost:"0",labor_cost:"0",shipping_cost:"0"},
      details:{personaName:"人设",operatorName:operator,liveRoomCode:"room-1",source:"",customerCurrency:"TWD",customerDue:"500.00",baseCustomerDue:"500.00",shippedOn:null,version:1},
      items:[{id:"item",label:"料子",material_ref:"",kind:"material",price_cny:"100.00",buying_fee_cny:"10.00"}],charges:[],payments:[]}};
}
const payment=(id:string,credit="100.00",date=today,charge?:string):PaymentRecord=>({id,payment_date:date,amount:credit,credit_amount:credit,currency:"TWD",after_sale_charge_id:charge,purpose:"deposit",channel:"第三方",third_party:true,reference:"",settled_amount:"0.00",voided_at:null});

describe("主管消费业绩的独立口径与个人贡献",()=>{
  it("开单含代购费而不含追加，跑单回冲原日；旧单今日收款单独统计",()=>{
    const a=source("today","甲"),old=source("old","乙","2026-11-10"),cancel=source("cancel","甲"),voided=payment("void");voided.voided_at=today;
    cancel.record.order.cancelled=true;
    a.record.charges=[{id:"after",business_date:today,label:"设计费",amount_cny:"50.00",customer_amount:"250.00",note:"",voided_at:null}];
    old.record.payments=[payment("old-receipt"),voided];
    const stats=aggregate([a,old,cancel],filter);
    expect(stats.turnover).toBe(11000n);expect(stats.cancelled).toBe(11000n);expect(stats.valid).toHaveLength(1);
    expect(paymentRows(stats.scoped,today,today)).toEqual([{date:today,amount:"100.00",currency:"TWD"}]);
    expect(stats.pending.some(p=>p.source.identity.id==="cancel")).toBe(false);
  });
  it("持有人换成乙，历史甲仍归甲；一个人多个账号可以合并，零业务持有人可见",()=>{
    const a=source("a","甲"),b=source("b","甲");b.identity.userId="account-2";
    const accounts=[{id:"account-1",holderName:"乙"}] as CsAccount[];
    const stats=aggregate([a,b],filter,accounts);
    expect(stats.contributions.find(p=>p.name==="甲")?.turnover).toBe(22000n);
    expect(stats.contributions.find(p=>p.name==="乙")?.turnover).toBe(0n);
    expect(operatorOf(source("unknown",""))).toBe(UNKNOWN);
  });
  it("待收按截止日重算原币抵扣，排除未来收款与收费；售后不与原单串账",()=>{
    const a=source("a","甲","2026-11-10");
    a.record.payments=[payment("base","200.00"),payment("future","300.00","2026-11-13"),payment("afterpaid","20.00",today,"after")];
    a.record.charges=[{id:"after",business_date:today,label:"雕刻",amount_cny:"30.00",customer_amount:"100.00",voided_at:null,note:""},{id:"future",business_date:"2026-11-13",label:"设计",amount_cny:"50.00",customer_amount:"250.00",voided_at:null,note:""}];
    expect(pendingFor(a,today).map(p=>[p.kind,p.balance,p.currency])).toEqual([["尾款待收","300.00","TWD"],["售后待收","80.00","TWD"]]);
    expect(paymentRows([a],today,today,"after")).toEqual([{date:today,amount:"20.00",currency:"TWD"}]);
  });
  it("资料不全不猜持有人、不把不明欠款当零；抵扣超额提示核对",()=>{
    const a=source("a","");a.record.legacy=true;a.record.details=undefined;
    expect(pendingFor(a,today).every(p=>p.balance===null)).toBe(true);
    expect(aggregate([a],filter).contributions[0].name).toBe(UNKNOWN);
    const b=source("b","乙");b.record.payments=[payment("over","600.00")];
    expect(pendingFor(b,today)[0]).toMatchObject({kind:"资料待补",balance:null});
    const invalid=source("bad","甲");invalid.record.items![0].price_cny="bad";invalid.record.details!.baseCustomerDue="bad";
    expect(aggregate([invalid],filter).unknownBookings).toBe(1);
    expect(pendingFor(invalid,today)[0]).toMatchObject({kind:"资料待补",balance:null});
  });
  it("日期、人设、直播间、账号和客服筛选不会混入其他贡献",()=>{
    const a=source("a","甲"),b=source("b","乙");b.identity.userId="account-2";
    expect(aggregate([a,b],{...filter,operator:"甲",account:"account-1",persona:"persona-1",room:"room-1"}).turnover).toBe(11000n);
    expect(aggregate([a,b],{...filter,operator:"乙",account:"account-1"}).turnover).toBe(0n);
    expect(aggregate([a,b],{...filter,from:"2026-11-01",to:"2026-11-11"}).valid).toHaveLength(0);
  });
  it('单选客服或接待账号不改变本组贡献分母；本组有未知金额时不猜占比',()=>{
    const a=source('a','甲'),b=source('b','乙');b.identity.userId='account-2';
    const selected=aggregate([a,b],{...filter,operator:'乙',account:'account-2'});
    expect(selected.turnover).toBe(11000n);expect(selected.teamTurnover).toBe(22000n);expect(teamShare(selected.turnover,selected.teamTurnover,selected.teamUnknownBookings)).toBe(50);
    a.record.items=undefined;a.identity.bookingAmount=undefined;
    const unknown=aggregate([a,b],{...filter,operator:'乙'});
    expect(teamShare(unknown.turnover,unknown.teamTurnover,unknown.teamUnknownBookings)).toBeNull();
  });
  it("私推只计料价，不因缺少直播间变成资料待补，也不进入直播间开单", () => {
    const live = source("live", "甲");
    const pushed = source("private", "甲");
    pushed.identity.dealChannel = "private";
    pushed.identity.liveRoomCode = "";
    pushed.record.details!.dealChannel = "private";
    pushed.record.details!.liveRoomCode = "";
    pushed.record.items = [{ id: "item", label: "料子", material_ref: "", kind: "material", price_cny: "600.00", buying_fee_cny: "0.00" }];
    const stats = aggregate([live, pushed], filter);
    expect(stats.liveTurnover).toBe(11000n);
    expect(stats.privateTurnover).toBe(60000n);
    expect(stats.turnover).toBe(71000n);
    expect(stats.privateCount).toBe(1);
    expect(pendingFor(pushed, today).some(row => row.missing === "直播间")).toBe(false);
    expect(stats.contributions.find(row => row.name === "甲")?.privateTurnover).toBe(60000n);
  });
  it("收款按付款日参考折算，缺汇率不报完整人民币总额",async()=>{
    const rows=[{date:today,amount:"100.00",currency:"TWD"},{date:today,amount:"50.00",currency:"CNY"}];
    const quote=async(date:string,currency:"TWD"|"USD")=>({currency,date,sourceDate:date,rate:"0.200000",updatedAt:today+"T05:00:00Z",checkedAt:0,source:"test",delayed:false,stale:false});
    expect((await convert(rows,quote)).cny).toBe("70.00");
    expect((await convert(rows,async()=>null)).cny).toBeNull();
  });
});

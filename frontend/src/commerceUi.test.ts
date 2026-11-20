import {describe,it,expect} from "vitest";
import {itemPreview,money,submissionKey,defaultBuyingFee,buyingFeeAfterPriceChange,buyingFeeRestored} from "./commerceUi";
import {bossDemoNav,bossLinkedPages,navItems,roleLabel,canAccessSalaries,canAccessDashboard} from "./access";
describe("财务与订单界面口径",()=>{
 it("展示逐块舍入、不混入成品加费，拒绝超过分的输入",()=>{const a=itemPreview("100.05","material")!,b=itemPreview("20.00","finished")!;expect(a.fee).toBe("10.01");expect(b.fee).toBe("0.00");expect(money(a.total+b.total)).toBe("130.06");expect(itemPreview("1.001","material")).toBe(null);});
 it("服务费默认按谈成价10%四舍五入到分，成品不加费",()=>{
  expect(defaultBuyingFee("100.05","material")).toBe("10.01");
  expect(defaultBuyingFee("20.00","finished")).toBe("0.00");
  expect(defaultBuyingFee("1.001","material")).toBe(null);
 });
 it("手动改过的服务费在改谈成价时保留，恢复后重新按10%计算",()=>{
  const locked=buyingFeeAfterPriceChange("material","200.00",{feeCny:"15.00",manual:true});
  expect(locked).toEqual({feeCny:"15.00",manual:true});
  const auto=buyingFeeAfterPriceChange("material","200.00",{feeCny:"10.01",manual:false});
  expect(auto).toEqual({feeCny:"20.00",manual:false});
  expect(buyingFeeRestored("200.00","material")).toEqual({feeCny:"20.00",manual:false});
  const preview=itemPreview("200.00","material","15.00")!;
  expect(preview.fee).toBe("15.00");expect(preview.autoFee).toBe("20.00");expect(money(preview.total)).toBe("215.00");
 });
 it("网络重试复用提交标识，修改内容或完成后新建提交使用新标识",()=>{const next=submissionKey(),first=next({amount:"10.00"});expect(next({amount:"10.00"})).toBe(first);expect(next({amount:"11.00"})).not.toBe(first);expect(submissionKey()({amount:"10.00"})).not.toBe(first);});
 it("手动清空的代购费必须补全，手填0有效，切换成品始终归零",()=>{
  expect(itemPreview("200.00","material","")).toBe(null);
  expect(itemPreview("200.00","material","0")?.fee).toBe("0.00");
  expect(itemPreview("200.00","finished","15.00")?.fee).toBe("0.00");
  expect(buyingFeeAfterPriceChange("finished","200.00",{feeCny:"15.00",manual:true})).toEqual({feeCny:"0.00",manual:false});
 });
 it("财务可核算工资，BOSS可只读查看结算与工资",()=>{expect(roleLabel.finance).toBe("财务");expect(navItems("finance").map(x=>x.id)).toEqual(["home","salaries"]);expect(bossLinkedPages().includes("finance")).toBe(true);expect(navItems("admin").some(x=>x.id==="finance")).toBe(false);expect(navItems("cs_supervisor").some(x=>x.id==="finance")).toBe(false);expect(canAccessDashboard("finance")).toBe(false);expect(canAccessSalaries("finance")).toBe(true);});
});

it("演示侧栏聚焦三个经营入口",()=>{expect(bossDemoNav().map(item=>item.label)).toEqual(["经营总览","直播间经营","拍剪数据"]);expect(bossDemoNav().some(item=>["home","finance","ops","salaries"].includes(item.id))).toBe(false);});

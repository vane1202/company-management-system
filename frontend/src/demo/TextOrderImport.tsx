import { useEffect, useState } from "react";
import { currencies, purposeLabels } from "../commerceUi";
import { importFieldLabels, type OrderTextFields, type ParsedOrderText, type TextOrderItem, type TextPaymentDraft } from "./orderTextParser";
import { parseSimpleOrderText, personaDisplay, roomDisplay } from "./orderIdentity";
import "./text-order-import.css";

type Props = { today: string; currentFields: Record<string, string>; defaultFields: Record<string, string>; currentItems: TextOrderItem[]; onApply: (result: ParsedOrderText) => void; channel?: "live" | "private" };
export default function TextOrderImport({ today, currentFields, defaultFields, currentItems, onApply, channel = "live" }: Props) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ParsedOrderText | null>(null);
  const [confirmed, setConfirmed] = useState(false), [applied, setApplied] = useState(false);
  const [payment, setPayment] = useState<TextPaymentDraft | null>(null);
  const fields = Object.entries(result?.fields ?? {}) as [keyof OrderTextFields, string][];
  const labels = { ...importFieldLabels, personaName: "人设姓名（ID）", hostName: "主播 / 直播间", liveRoomCode: "主播 / 直播间", customerLabel: "客户名", orderRef: "原汇报单号" };
  const visibleFields = fields.filter(([key]) => key !== "source" && !(key === "customerCode" && result?.fields.customerLabel) && !(key === "personaCode" && result?.fields.personaName) && !(key === "liveRoomCode" && result?.fields.hostName));
  const conflicts = fields.filter(([key, value]) => currentFields[key] && currentFields[key] !== value && currentFields[key] !== defaultFields[key]).map(([key, value]) => `${importFieldLabels[key]}：${currentFields[key]} → ${value}`);
  const itemsChanged = !!result?.items.length && currentItems.some(item => item.label || item.priceCny || item.materialRef) && JSON.stringify(currentItems) !== JSON.stringify(result.items);
  if (itemsChanged) conflicts.push(`商品明细：替换当前${currentItems.length}件商品，填入识别出的${result!.items.length}件商品`);
  const conflictKey = conflicts.join("\n");
  useEffect(() => { setConfirmed(false); }, [conflictKey]);
  function changeText(next: string) { setText(next); setResult(null); setConfirmed(false); setApplied(false); setPayment(null); }
  const canApply = result && !result.errors.length && (fields.length > 0 || result.items.length > 0 || result.payment !== null) && (!conflicts.length || confirmed) && !applied;
  function apply() {
    if (!result || !canApply) return;
    onApply(result); setPayment(result.payment ? { ...result.payment } : null); setApplied(true);
  }
  const privateDeal = channel === "private";
  return <details className="text-order-import" aria-label={privateDeal ? "文字识别私推成交" : "文字识别开单卡"}>
    <summary>粘贴旧日报快速录入</summary>
    <div className="text-import-heading"><h3>{privateDeal ? "粘贴汇报，快速填私推" : "粘贴汇报，快速填开单卡"}</h3><small>识别 → 核对 → 填入</small></div>
    <p>{privateDeal ? "只识别料价，不识别代购费，也不匹配直播间。核对客户名和经办客服后填入。演示不生成正式编号。" : "在当前页面识别文字，核对客户名、人设和绑定直播间后填入。新订单编号由系统在保存时生成；演示不生成正式编号。"}</p>
    <label className="row">开单汇报文字<textarea aria-label="开单汇报文字" rows={7} maxLength={12000} placeholder={privateDeal ? "粘贴日期、客服、客户、逐块料价和付款情况。不要写代购费或直播间" : "粘贴日期、人设、客服、客户、逐块料价及代购费、付款情况等汇报内容"} value={text} onChange={e => changeText(e.target.value)} /></label>
    <div className="text-import-actions"><button type="button" disabled={!text.trim()} onClick={() => { setResult(parseSimpleOrderText(text, today, channel)); setApplied(false); setConfirmed(false); }}>识别并预览</button><button type="button" className="secondary" onClick={() => changeText(privateDeal ? `日期：${today}\n客服：演示客服甲\n客户：演示私推客户\n第一块料子：980\n第二块料子：1800\n合计金额：人民币2780元\n实际收款：人民币1000元（定金）未收尾款1780元\n付款方式：演示支付宝账户\n付款日期：${today}\n备注：私推` : `日期：${today}\n人设：演示人设甲（P001）\n客服：演示客服甲\n客户：演示客户甲\n第一块料子：980+98\n第二块料子：1800+180\n第三块料子：14800+1480\n合计金额：人民币19338元\n实际收款：台币10000元（定金）未收尾款90557台币\n付款方式：演示台币账户\n付款日期：${today}\n备注：演示主播甲直播间`)}>载入虚构示例（替换文字）</button></div>
    {result && <section className="text-import-result" aria-label="识别结果预览">
      <h4>识别结果 · 核对后填入</h4>
      {!!visibleFields.length && <dl className="text-import-fields">{visibleFields.map(([key, value]) => <div key={key}><dt>{labels[key]}{key === "customerDue" && result.derivedDue ? "（推算，待确认）" : ""}</dt><dd>{key === "customerCurrency" ? currencies[value as keyof typeof currencies] : key === "personaName" ? personaDisplay(value, result.fields.personaCode) : key === "hostName" || key === "liveRoomCode" ? roomDisplay(result.fields) : value}{result.fieldHints[key] && <small className="text-import-field-hint">{result.fieldHints[key]}</small>}</dd></div>)}</dl>}
      {!!result.items.length && <div className="text-import-table"><table><caption>商品明细 · 人民币</caption><thead><tr><th>件次</th><th>{privateDeal ? "料价" : "开单价"}</th>{!privateDeal && <th>代购费</th>}</tr></thead><tbody>{result.items.map((item, index) => <tr key={index}><td>{item.label}</td><td>{item.priceCny}</td>{!privateDeal && <td>{item.buyingFeeCny}</td>}</tr>)}</tbody></table><p className="text-import-total">识别合计 <b>¥{result.itemTotal}</b>{result.statedTotal && <span>汇报合计 ¥{result.statedTotal}</span>}{privateDeal && <span>私推不收代购费</span>}</p></div>}
      {result.payment && <p className="text-import-payment-preview">收款草稿：{result.payment.amount || "金额待补"} {result.payment.currency || "币种待补"} · {purposeLabels[result.payment.purpose]} · 付款日期 {result.payment.paymentDate || "待补"} · {result.payment.channel || "收款账户待补"}{result.payment.remaining && `；未收尾款 ${result.payment.remaining} ${result.payment.remainingCurrency || "币种待补"}`}。仅生成草稿，不登记流水。</p>}
      {!!result.errors.length && <div className="text-import-errors" role="alert"><b>请先更正以下内容，再重新识别</b><ul>{result.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
      {!!result.warnings.length && <details className="text-import-warnings" open><summary>需要核对或补充（{result.warnings.length}项）</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      {!!result.unknownLines.length && <details className="text-import-unrecognized"><summary>未识别的文字</summary><ul>{result.unknownLines.map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
      {!!conflicts.length && !applied && <div className="text-import-conflicts"><b>以下内容已填写</b><ul>{conflicts.map((conflict, index) => <li key={index}>{conflict}</li>)}</ul><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />确认替换上述已填写内容</label></div>}
      <p className="text-import-hint">{privateDeal ? "「客户」按客户名填入。私推只保留料价，代购费固定为 0，不匹配直播间。同名客户不自动合并历史订单。" : "「客户」统一按客户名填入；人设姓名与ID合并显示。主播按已登记的绑定关系带出直播间，不根据人设猜测。未提供的已填内容保留；同名客户不自动合并历史订单。"}</p>
      <button type="button" disabled={!canApply} onClick={apply}>{applied ? "已填入，可继续手动修改" : privateDeal ? "确认填入私推" : "确认填入开单卡"}</button>
      {applied && <p role="status" className="text-import-success">{privateDeal ? "识别内容已填入下方私推记录；尚未保存，也未登记收款。" : "识别内容已填入下方开单卡；尚未保存订单，也未登记收款。"}</p>}
    </section>}
    {payment && <details className="text-import-payment" open><summary>识别的收款草稿（可修改，不保存）</summary><p>此处保留汇报中的付款信息。正式收款仍须在订单保存后单独核对登记。</p><div className="grid two">
      <label className="row">草稿付款日期<input aria-label="草稿付款日期" type="date" max={today} value={payment.paymentDate} onChange={e => setPayment({ ...payment, paymentDate: e.target.value })} /></label>
      <label className="row">草稿付款币种<select aria-label="草稿付款币种" value={payment.currency} onChange={e => setPayment({ ...payment, currency: e.target.value as TextPaymentDraft["currency"] })}><option value="">请选择</option>{Object.entries(currencies).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label className="row">草稿实收金额<input aria-label="草稿实收金额" inputMode="decimal" value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })} /></label>
      <label className="row">草稿收款账户<input aria-label="草稿收款账户" maxLength={128} value={payment.channel} onChange={e => setPayment({ ...payment, channel: e.target.value })} /></label>
      <label className="row">草稿付款性质<select aria-label="草稿付款性质" value={payment.purpose} onChange={e => setPayment({ ...payment, purpose: e.target.value as TextPaymentDraft["purpose"] })}>{Object.entries(purposeLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label className="row">汇报尾款（{payment.remainingCurrency || "币种待确认"}）<input aria-label="草稿未收尾款" inputMode="decimal" value={payment.remaining} onChange={e => setPayment({ ...payment, remaining: e.target.value })} /></label>
    </div><small>修改收款草稿不会自动改写订单约定总应收；请分别核对。</small></details>}
  </details>;
}

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, type Currency, type OrderRecord } from "./api";
import { cents, currencies, expenseLabels, submissionKey } from "./commerceUi";
import { yuan } from "./dashboardDisplay";
import { dataUrl, rememberShippingProofs } from "./demo/shippingProofStore";
import { readShippingFiles, releaseShippingShot, ShippingProofEditor, ShippingProofViewer, type ShippingShot } from "./ShippingProofs";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="row">{label}{children}</label>;
}

function toCents(value: string) {
  return cents(value.trim());
}

function formatCents(value: bigint | null) {
  if (value === null) return "—";
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return yuan(`${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`);
}

function sumCents(values: string[]) {
  let total = 0n;
  for (const value of values) {
    const next = cents(value);
    if (next === null) return null;
    total += next;
  }
  return total;
}

export function OrderAfterSales({ data, today, canFill, busy, action, onVoidExpense }: {
  data: OrderRecord;
  today: string;
  canFill: boolean;
  busy: boolean;
  action: (fn: () => Promise<unknown>, success: string) => void;
  onVoidExpense: (id: string) => void;
}) {
  const details = data.details;
  const orderCur = (details?.customerCurrency || "CNY") as Currency;
  const [open, setOpen] = useState<"" | "charge" | "cost" | "ship">("");
  const [charge, setCharge] = useState({ label: "", businessDate: today, amount: "", currency: orderCur, cnyQuote: "", orderDue: "", syncPay: false, paidAmount: "", channel: "" });
  const [cost, setCost] = useState({ category: "labor", businessDate: today, amountCny: "", counterparty: "" });
  const [shipDate, setShipDate] = useState(details?.shippedOn || today);
  const demo = import.meta.env.MODE === "demo";
  const [shipDraft, setShipDraft] = useState<ShippingShot[] | null>(null);
  const [shipRemoved, setShipRemoved] = useState<string[]>([]);
  const [shipError, setShipError] = useState("");
  const [shipView, setShipView] = useState(-1);
  const [shipShown, setShipShown] = useState<string | null>(null);
  const [voidId, setVoidId] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const chargeKey = useRef(submissionKey());
  const payKey = useRef(submissionKey());
  const costKey = useRef(submissionKey());
  if (!details) return null;
  const serverShots: ShippingShot[] = (data.attachments ?? []).filter(row => (row.kind ?? "card") === "shipping_proof").map(row => ({ id: row.id, name: row.filename, src: row.url || `/api/order-records/${data.order.id}/attachments/${row.id}`, remote: true }));
  const shipShots = shipDraft ?? serverShots.filter(shot => !shipRemoved.includes(shot.id));
  const shippedLabel = shipShown ?? details.shippedOn;

  const charges = data.charges ?? [];
  const expenses = data.expenses ?? [];
  const chargeTotal = sumCents(charges.filter(row => !row.voided_at).map(row => row.amount_cny));
  const costTotal = sumCents(expenses.filter(row => !row.voided_at).map(row => row.amount_cny));
  const difference = chargeTotal !== null && costTotal !== null ? chargeTotal - costTotal : null;
  const needCnyQuote = charge.currency !== "CNY";
  const needOrderDue = orderCur !== "CNY" && charge.currency !== orderCur;
  const toggle = (key: "charge" | "cost" | "ship") => setOpen(current => current === key ? "" : key);

  function saveCharge(event: FormEvent) {
    event.preventDefault();
    const amount = charge.amount.trim();
    const quote = charge.currency === "CNY" ? amount : charge.cnyQuote.trim();
    const agreed = orderCur === "CNY" ? quote : charge.currency === orderCur ? amount : charge.orderDue.trim();
    if (toCents(amount) === null || toCents(quote) === null || toCents(agreed) === null) return;
    if (charge.syncPay && toCents(charge.paidAmount) === null) return;
    const note = charge.currency !== "CNY" && charge.currency !== orderCur ? `约定 ${amount} ${charge.currency}` : "";
    const body = { businessDate: charge.businessDate, label: charge.label.trim(), amountCny: quote, customerAmount: agreed, note };
    void action(async () => {
      const saved = await api.orderAction(data.order.id, "charges", { ...body, requestKey: chargeKey.current(body) });
      chargeKey.current = submissionKey();
      if (charge.syncPay) {
        const payCurrency = charge.currency;
        const pay = {
          paymentDate: charge.businessDate,
          amount: charge.paidAmount.trim(),
          currency: payCurrency,
          creditAmount: payCurrency === orderCur ? charge.paidAmount.trim() : agreed,
          purpose: "balance",
          channel: charge.channel.trim(),
          thirdParty: payCurrency !== "CNY",
          afterSaleChargeId: saved.id,
          reference: "",
          note: ""
        };
        await api.orderAction(data.order.id, "payments", { ...pay, requestKey: payKey.current(pay) });
        payKey.current = submissionKey();
      }
      setCharge(current => ({ ...current, label: "", amount: "", cnyQuote: "", orderDue: "", syncPay: false, paidAmount: "", channel: "" }));
      setOpen("");
    }, charge.syncPay ? "售后收费和本次收款已登记" : "售后追加收费已登记");
  }

  function saveCost(event: FormEvent) {
    event.preventDefault();
    if (toCents(cost.amountCny) === null) return;
    const body = {
      businessDate: cost.businessDate,
      category: cost.category,
      label: expenseLabels[cost.category] || "费用",
      amountCny: cost.amountCny.trim(),
      counterparty: cost.counterparty.trim(),
      itemId: "",
      note: "",
      afterSaleChargeId: ""
    };
    void action(async () => {
      await api.orderAction(data.order.id, "expenses", { ...body, requestKey: costKey.current(body) });
      costKey.current = submissionKey();
      setCost(current => ({ ...current, amountCny: "", counterparty: "" }));
      setOpen("");
    }, `支出「${body.label}」¥${body.amountCny} 已登记`);
  }

  async function changeShipFiles(list: FileList | File[], replaceId = "") {
    const base = shipDraft ?? serverShots.filter(shot => !shipRemoved.includes(shot.id));
    const room = replaceId ? 1 : 3 - base.length;
    if (room <= 0) { setShipError("最多 3 张快递记录截图"); return; }
    const incoming = Array.from(list).slice(0, room);
    const read = await readShippingFiles(incoming);
    if (read.error || (replaceId && !read.shots[0])) { setShipError(read.error || "请上传图片"); return; }
    if (!replaceId && Array.from(list).length > room) setShipError("最多 3 张快递记录截图");
    else setShipError("");
    if (replaceId) {
      const current = base.find(shot => shot.id === replaceId);
      if (current?.remote) setShipRemoved(ids => ids.includes(replaceId) ? ids : [...ids, replaceId]);
      if (current) releaseShippingShot(current);
      setShipDraft(base.map(shot => shot.id === replaceId ? read.shots[0] : shot));
      return;
    }
    setShipDraft([...base, ...read.shots]);
  }

  function removeShip(id: string) {
    const base = shipDraft ?? serverShots.filter(shot => !shipRemoved.includes(shot.id));
    const current = base.find(shot => shot.id === id);
    if (current?.remote) setShipRemoved(ids => ids.includes(id) ? ids : [...ids, id]);
    if (current) releaseShippingShot(current);
    setShipDraft(base.filter(shot => shot.id !== id));
  }

  async function saveShip(event: FormEvent) {
    event.preventDefault();
    if (!details || !shipDate) return;
    const shots = shipDraft ?? serverShots.filter(shot => !shipRemoved.includes(shot.id));
    if (demo) {
      const stored = [];
      for (const shot of shots) stored.push({ id: shot.id, name: shot.name, url: shot.file && shot.file.size <= 1200000 ? await dataUrl(shot.file) : shot.src });
      rememberShippingProofs(data.order.id, shipDate, stored);
      setShipShown(shipDate);
      setShipError("");
      setOpen("");
      return;
    }
    void action(async () => {
      await api.orderAction(data.order.id, "shipping", { shippedOn: shipDate });
      for (const id of shipRemoved) await api.deleteOrderAttachment(data.order.id, id);
      for (const shot of shots) if (shot.file) await api.uploadOrderPhoto(data.order.id, shot.file, "", "shipping_proof");
      setShipDraft(null);
      setShipRemoved([]);
      setShipError("");
      setOpen("");
    }, "\u53d1\u8d27\u65e5\u671f " + shipDate + " \u5df2\u4fdd\u5b58");
  }

  return <section className="card as-panel">
    <p className="as-belong">自动归属：<b>{data.order.order_ref} · {data.order.customer_label || "客户"} · {details.operatorName || "经办客服"}</b></p>
    <div className="as-sums">
      <div><small>客户收费</small><strong>{formatCents(chargeTotal)}</strong></div>
      <div><small>公司成本</small><strong>{formatCents(costTotal)}</strong></div>
      <div><small>本笔差额</small><strong>{formatCents(difference)}</strong></div>
    </div>
    <div className="as-list">
      {charges.map(row => <article key={row.id} className={row.voided_at ? "as-line is-void" : "as-line"}>
        <div className="as-line-top"><span><em className="as-tag">收费</em>{row.label}</span><b>{yuan(row.amount_cny)}</b></div>
        <div className="as-line-sub">
          <small>{row.business_date} · 约定 {orderCur === "CNY" ? yuan(row.customer_amount) : `${row.customer_amount} ${orderCur}`}{row.voided_at ? ` · 已作废：${row.void_reason || ""}` : ""}</small>
          {canFill && !row.voided_at && <span className="as-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => void action(() => api.orderAction(data.order.id, `charges/${row.id}/costs-complete`, { version: details.version, complete: !row.costs_completed_at }), row.costs_completed_at ? "已重新打开成本补录" : "已确认成本录齐")}>{row.costs_completed_at ? "再补成本" : "成本已齐"}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { setVoidId(row.id); setVoidReason(""); }}>纠错</button>
          </span>}
        </div>
        {voidId === row.id && <form className="as-void" onSubmit={event => { event.preventDefault(); void action(async () => { await api.orderAction(data.order.id, `charges/${row.id}/void`, { reason: voidReason.trim() }); setVoidId(""); }, "错误收费已作废"); }}>
          <input required maxLength={500} placeholder="纠错原因" value={voidReason} onChange={event => setVoidReason(event.target.value)} />
          <button disabled={busy}>作废</button>
          <button type="button" className="secondary" onClick={() => setVoidId("")}>取消</button>
        </form>}
      </article>)}
      {expenses.map(row => <article key={row.id} className={row.voided_at ? "as-line is-void" : "as-line"}>
        <div className="as-line-top"><span><em className="as-tag is-cost">成本</em>{expenseLabels[row.category] || row.label}</span><b>{yuan(row.amount_cny)}</b></div>
        <div className="as-line-sub">
          <small>{row.business_date} · {row.counterparty || "供货方待补"}{row.voided_at ? ` · 已作废：${row.void_reason || ""}` : ""}</small>
          {canFill && !row.voided_at && <button type="button" className="secondary" disabled={busy} onClick={() => onVoidExpense(row.id)}>纠错</button>}
        </div>
      </article>)}
      <div className="as-shipped-row"><p className="as-shipped">{shippedLabel ? "已发货 " + shippedLabel : "尚未登记发货"}</p>{!!shipShots.length && <button type="button" className="text-action" onClick={() => setShipView(0)}>查看快递截图</button>}{shipShots.map((shot, index) => <button type="button" className="ship-proof-mini" key={shot.id} onClick={() => setShipView(index)} aria-label="查看快递截图"><img src={shot.src} alt="" /></button>)}</div>
    </div>
    {canFill && <div className="as-entries">
      <button type="button" className="secondary" aria-expanded={open === "charge"} onClick={() => toggle("charge")}>+ 登记售后追加收费（客户付）</button>
      {open === "charge" && <form onSubmit={saveCharge}>
        <div className="as-grid">
          <Row label="收费项目"><input required maxLength={128} value={charge.label} onChange={event => setCharge({ ...charge, label: event.target.value })} /></Row>
          <Row label="发生日期"><input required className="as-num" type="date" min={data.order.business_date} max={today} value={charge.businessDate} onChange={event => setCharge({ ...charge, businessDate: event.target.value })} /></Row>
          <Row label="约定金额"><input required className="as-num" inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" value={charge.amount} onChange={event => setCharge({ ...charge, amount: event.target.value })} /></Row>
          <Row label="币种"><select value={charge.currency} onChange={event => setCharge({ ...charge, currency: event.target.value as Currency })}>{Object.entries(currencies).map(([key, label]) => <option key={key} value={key}>{label}（{key}）</option>)}</select></Row>
        </div>
        {charge.currency !== "CNY" && <p className="as-hint">按约定外币计应收，不受结汇汇率影响</p>}
        {needCnyQuote && <Row label="人民币报价"><input required className="as-num" inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" value={charge.cnyQuote} onChange={event => setCharge({ ...charge, cnyQuote: event.target.value })} /></Row>}
        {needOrderDue && <Row label={`订单约定应收 · ${orderCur}`}><input required className="as-num" inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" value={charge.orderDue} onChange={event => setCharge({ ...charge, orderDue: event.target.value })} /></Row>}
        <label className="as-check"><input type="checkbox" checked={charge.syncPay} onChange={event => setCharge({ ...charge, syncPay: event.target.checked })} />同步登记本次收款（可选）</label>
        {charge.syncPay && <div className="as-grid">
          <Row label="本次实收"><input required className="as-num" inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" value={charge.paidAmount} onChange={event => setCharge({ ...charge, paidAmount: event.target.value })} /></Row>
          <Row label="收款账户 / 方式"><input required maxLength={128} value={charge.channel} onChange={event => setCharge({ ...charge, channel: event.target.value })} /></Row>
        </div>}
        <button disabled={busy}>{busy ? "保存中…" : "保存追加收费"}</button>
      </form>}
      <button type="button" className="secondary" aria-expanded={open === "cost"} onClick={() => toggle("cost")}>+ 登记公司成本支出（逐笔）</button>
      {open === "cost" && <form onSubmit={saveCost}>
        <div className="as-grid">
          <Row label="费用类别"><select value={cost.category} onChange={event => setCost({ ...cost, category: event.target.value })}>{Object.entries(expenseLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Row>
          <Row label="发生日期"><input required className="as-num" type="date" max={today} value={cost.businessDate} onChange={event => setCost({ ...cost, businessDate: event.target.value })} /></Row>
          <Row label="支出金额 (¥)"><input required className="as-num" inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" value={cost.amountCny} onChange={event => setCost({ ...cost, amountCny: event.target.value })} /></Row>
          <Row label="供货 / 服务方"><input required maxLength={128} value={cost.counterparty} onChange={event => setCost({ ...cost, counterparty: event.target.value })} /></Row>
        </div>
        <button disabled={busy}>{busy ? "保存中…" : "保存这笔成本"}</button>
      </form>}
      <button type="button" className="secondary" aria-expanded={open === "ship"} onClick={() => toggle("ship")}>登记 / 更新发货日期</button>
      {open === "ship" && <form className="as-ship" onSubmit={saveShip}>
        <Row label="发货日期"><input required className="as-num" type="date" min={data.order.business_date} max={today} value={shipDate} onChange={event => setShipDate(event.target.value)} /></Row>
        <ShippingProofEditor shots={shipShots} disabled={busy} onAdd={files => void changeShipFiles(files)} onRemove={removeShip} onReplace={(id, file) => void changeShipFiles([file], id)} onOpen={setShipView} />
        {shipError && <p className="error" role="alert">{shipError}</p>}
        <button type="button" disabled={busy} onClick={event => { const form = event.currentTarget.form; if (form?.reportValidity()) void saveShip({ preventDefault() {} } as FormEvent); }}>{busy ? "保存中…" : "保存"}</button>
      </form>}
    </div>}
      <ShippingProofViewer shots={shipShots} index={shipView} onClose={() => setShipView(-1)} onIndex={setShipView} />
  </section>;
}

import { useState } from "react";
import type { Currency } from "../api";
import { cents, currencies, expenseLabels } from "../commerceUi";
import { yuan } from "../dashboardDisplay";
import { Field } from "../OrderWorkspace";
import { PaymentProofField } from "../PaymentProofField";
import { signedMoney } from "./afterSalesText";
import { dataUrl, rememberShippingProofs } from "./shippingProofStore";
import { readShippingFiles, releaseShippingShot, ShippingProofEditor, ShippingProofViewer, type ShippingShot } from "../ShippingProofs";

export type AfterSalesContext = {
  orderRef: string;
  customerCode: string;
  customerName: string;
  personaName: string;
  personaCode: string;
  liveRoomCode: string;
  hostName: string;
  operatorName: string;
};

type ChargeLine = {
  id: string;
  label: string;
  businessDate: string;
  amount: string;
  currency: Currency;
  amountCny: string;
  customerAmount: string;
  paidAmount: string;
  channel: string;
  context: AfterSalesContext;
};

type CostLine = {
  id: string;
  category: string;
  label: string;
  businessDate: string;
  amountCny: string;
  counterparty: string;
  context: AfterSalesContext;
};

let serial = 0;
const nextId = () => `as-${Date.now().toString(36)}-${serial++}`;

function parseMoney(value: string) {
  return cents(value.trim());
}

export default function OrderAfterSalesFill({ today, operator, customerName, customerCode, orderRef, orderDate, currency = "CNY", room }: {
  today: string;
  operator: string;
  customerName: string;
  customerCode: string;
  orderRef: string;
  orderDate: string;
  currency?: Currency;
  room?: { name: string; host: string };
}) {
  const context: AfterSalesContext = {
    orderRef,
    customerCode,
    customerName,
    personaName: "",
    personaCode: "",
    liveRoomCode: room?.name || "",
    hostName: room?.host || "",
    operatorName: operator
  };
  const [open, setOpen] = useState<"" | "charge" | "cost" | "ship">("");
  const [charges, setCharges] = useState<ChargeLine[]>([]);
  const [costs, setCosts] = useState<CostLine[]>([]);
  const [shippedOn, setShippedOn] = useState("");
  const [charge, setCharge] = useState({ label: "", businessDate: today, amount: "", currency, syncPay: false, paidAmount: "", channel: "" });
  const [payProof, setPayProof] = useState<File | null>(null);
  const [cost, setCost] = useState({ category: "labor", businessDate: today, amountCny: "", counterparty: "" });
  const [shipDate, setShipDate] = useState(today);
  const [shipShots, setShipShots] = useState<ShippingShot[]>([]);
  const [shipView, setShipView] = useState(-1);
  const [error, setError] = useState("");
  const toggle = (key: "charge" | "cost" | "ship") => setOpen(current => current === key ? "" : key);
  const chargeSame = charges.every(row => row.currency === charges[0]?.currency);
  const chargeCents = charges.length && chargeSame && charges[0].currency === "CNY"
    ? charges.reduce((sum, row) => sum + (parseMoney(row.amountCny) ?? 0n), 0n)
    : null;
  const costCents = costs.reduce((sum, row) => sum + (parseMoney(row.amountCny) ?? 0n), 0n);
  const chargeText = !charges.length ? "—" : chargeCents !== null ? `¥${signedMoney(chargeCents)}` : chargeSame ? `${charges.reduce((sum, row) => sum + Number(row.customerAmount), 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${charges[0].currency}` : "多币种";
  const costText = costs.length ? `¥${signedMoney(costCents)}` : "—";
  const diffText = chargeCents !== null ? `¥${signedMoney(chargeCents - costCents)}` : "—";

  function saveCharge() {
    if (parseMoney(charge.amount) === null || (charge.syncPay && parseMoney(charge.paidAmount) === null)) {
      setError("金额需为最多两位小数的数字");
      return;
    }
    if (charge.syncPay && !payProof) {
      setError("请先上传客户付款凭证截图");
      return;
    }
    const amount = charge.amount.trim();
    setCharges(rows => [...rows, {
      id: nextId(),
      label: charge.label.trim(),
      businessDate: charge.businessDate,
      amount,
      currency: charge.currency,
      amountCny: charge.currency === "CNY" ? amount : "",
      customerAmount: amount,
      paidAmount: charge.syncPay ? charge.paidAmount.trim() : "",
      channel: charge.syncPay ? charge.channel.trim() : "",
      context
    }]);
    setCharge(current => ({ ...current, label: "", amount: "", syncPay: false, paidAmount: "", channel: "" }));
    setPayProof(null);
    setError("");
    setOpen("");
  }

  function saveCost() {
    if (parseMoney(cost.amountCny) === null) {
      setError("金额需为最多两位小数的数字");
      return;
    }
    setCosts(rows => [...rows, {
      id: nextId(),
      category: cost.category,
      label: expenseLabels[cost.category] || "费用",
      businessDate: cost.businessDate,
      amountCny: cost.amountCny.trim(),
      counterparty: cost.counterparty.trim(),
      context
    }]);
    setCost(current => ({ ...current, amountCny: "", counterparty: "" }));
    setError("");
    setOpen("");
  }

  async function changeShipFiles(list: FileList | File[], replaceId = "") {
    const room = replaceId ? 1 : 3 - shipShots.length;
    if (room <= 0) { setError("最多 3 张快递记录截图"); return; }
    const incoming = Array.from(list).slice(0, room);
    const read = await readShippingFiles(incoming);
    if (read.error || (replaceId && !read.shots[0])) { setError(read.error || "请上传图片"); return; }
    if (!replaceId && Array.from(list).length > room) setError("最多 3 张快递记录截图");
    else setError("");
    if (replaceId) {
      const current = shipShots.find(shot => shot.id === replaceId);
      if (current) releaseShippingShot(current);
      setShipShots(shipShots.map(shot => shot.id === replaceId ? read.shots[0] : shot));
      return;
    }
    setShipShots([...shipShots, ...read.shots]);
  }

  function removeShip(id: string) {
    const current = shipShots.find(shot => shot.id === id);
    if (current) releaseShippingShot(current);
    setShipShots(shipShots.filter(shot => shot.id !== id));
  }

  async function saveShip() {
    const stored = [];
    for (const shot of shipShots) stored.push({ id: shot.id, name: shot.name, url: shot.file && shot.file.size <= 1200000 ? await dataUrl(shot.file) : shot.src });
    rememberShippingProofs(orderRef, shipDate, stored);
    setShippedOn(shipDate);
    setError("");
    setOpen("");
  }

  return <section className="card as-panel">
    <p className="as-belong">自动归属：<b>{orderRef} · {customerName} · {operator}</b></p>
    <div className="as-sums">
      <div><small>客户收费</small><strong>{chargeText}</strong></div>
      <div><small>公司成本</small><strong>{costText}</strong></div>
      <div><small>本笔差额</small><strong>{diffText}</strong></div>
    </div>
    <div className="as-list">
      {charges.map(row => <article key={row.id} className="as-line">
        <div className="as-line-top"><span><em className="as-tag">收费</em>{row.label}</span><b>{row.currency === "CNY" ? yuan(row.amountCny) : `${row.customerAmount} ${row.currency}`}</b></div>
        <div className="as-line-sub">
          <small>{row.businessDate}{row.paidAmount ? ` · 实收 ${row.paidAmount} ${row.currency} · ${row.channel}` : ""}</small>
          <button type="button" className="secondary" onClick={() => setCharges(rows => rows.filter(item => item.id !== row.id))}>删除</button>
        </div>
      </article>)}
      {costs.map(row => <article key={row.id} className="as-line">
        <div className="as-line-top"><span><em className="as-tag is-cost">成本</em>{row.label}</span><b>{yuan(row.amountCny)}</b></div>
        <div className="as-line-sub">
          <small>{row.businessDate} · {row.counterparty || "供货方待补"}</small>
          <button type="button" className="secondary" onClick={() => setCosts(rows => rows.filter(item => item.id !== row.id))}>删除</button>
        </div>
      </article>)}
      <div className="as-shipped-row"><p className="as-shipped">{shippedOn ? "已发货 " + shippedOn : "尚未登记发货"}</p>{!!shipShots.length && <button type="button" className="text-action" onClick={() => setShipView(0)}>查看快递截图</button>}{shipShots.map((shot, index) => <button type="button" className="ship-proof-mini" key={shot.id} onClick={() => setShipView(index)}><img src={shot.src} alt="" /></button>)}</div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="as-entries">
      <button type="button" className="secondary" aria-expanded={open === "charge"} onClick={() => toggle("charge")}>+ 登记售后追加收费（客户付）</button>
      {open === "charge" && <form onSubmit={event => event.preventDefault()}>
        <div className="as-grid">
          <Field label="收费项目"><input required maxLength={128} value={charge.label} onChange={event => setCharge({ ...charge, label: event.target.value })} /></Field>
          <Field label="发生日期"><input required className="as-num" type="date" min={orderDate} max={today} value={charge.businessDate} onChange={event => setCharge({ ...charge, businessDate: event.target.value })} /></Field>
          <Field label="约定金额"><input required className="as-num" inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" value={charge.amount} onChange={event => setCharge({ ...charge, amount: event.target.value })} /></Field>
          <Field label="币种"><select value={charge.currency} onChange={event => setCharge({ ...charge, currency: event.target.value as Currency })}>{Object.entries(currencies).map(([key, label]) => <option key={key} value={key}>{label}（{key}）</option>)}</select></Field>
        </div>
        {charge.currency !== "CNY" && <p className="as-hint">按约定外币计应收，不受结汇汇率影响</p>}
        <label className="as-check"><input type="checkbox" checked={charge.syncPay} onChange={event => setCharge({ ...charge, syncPay: event.target.checked })} />同步登记本次收款（可选）</label>
        {charge.syncPay && <><PaymentProofField file={payProof} onChange={next => { setPayProof(next); if (next) setError(""); }} /><div className="as-grid">
          <Field label="本次实收"><input required className="as-num" inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" value={charge.paidAmount} onChange={event => setCharge({ ...charge, paidAmount: event.target.value })} /></Field>
          <Field label="收款账户 / 方式"><input required maxLength={128} value={charge.channel} onChange={event => setCharge({ ...charge, channel: event.target.value })} /></Field>
        </div></>}
        <button type="button" onClick={event => { if (event.currentTarget.form?.reportValidity()) saveCharge(); }}>保存追加收费</button>
      </form>}
      <button type="button" className="secondary" aria-expanded={open === "cost"} onClick={() => toggle("cost")}>+ 登记公司成本支出（逐笔）</button>
      {open === "cost" && <form onSubmit={event => event.preventDefault()}>
        <div className="as-grid">
          <Field label="费用类别"><select value={cost.category} onChange={event => setCost({ ...cost, category: event.target.value })}>{Object.entries(expenseLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
          <Field label="发生日期"><input required className="as-num" type="date" max={today} value={cost.businessDate} onChange={event => setCost({ ...cost, businessDate: event.target.value })} /></Field>
          <Field label="支出金额 (¥)"><input required className="as-num" inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" value={cost.amountCny} onChange={event => setCost({ ...cost, amountCny: event.target.value })} /></Field>
          <Field label="供货 / 服务方"><input maxLength={128} value={cost.counterparty} onChange={event => setCost({ ...cost, counterparty: event.target.value })} /></Field>
        </div>
        <button type="button" onClick={event => { if (event.currentTarget.form?.reportValidity()) saveCost(); }}>保存这笔成本</button>
      </form>}
      <button type="button" className="secondary" aria-expanded={open === "ship"} onClick={() => toggle("ship")}>登记 / 更新发货日期</button>
      {open === "ship" && <form className="as-ship" onSubmit={event => event.preventDefault()}>
        <Field label="发货日期"><input required className="as-num" type="date" min={orderDate} max={today} value={shipDate} onChange={event => setShipDate(event.target.value)} /></Field>
        <ShippingProofEditor shots={shipShots} onAdd={files => void changeShipFiles(files)} onRemove={removeShip} onReplace={(id, file) => void changeShipFiles([file], id)} onOpen={setShipView} />
        <button type="button" onClick={event => { if (event.currentTarget.form?.reportValidity()) void saveShip(); }}>保存</button>
      </form>}
    </div>
      <ShippingProofViewer shots={shipShots} index={shipView} onClose={() => setShipView(-1)} onIndex={setShipView} />
  </section>;
}

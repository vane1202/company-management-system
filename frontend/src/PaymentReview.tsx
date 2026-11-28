import { useMemo, useState } from "react";
import { api, type FinancePayment } from "./api";
import { centsToYuan, useCustomerCrm } from "./demo/customerCrm";
import { toErrorMessage } from "./errors";

type Tab = "pending" | "confirmed" | "rejected";
type Channel = "all" | "cny" | "fx";

const purposeText: Record<string, string> = {
  deposit: "\u5b9a\u91d1",
  balance: "\u5c3e\u6b3e",
  full: "\u5168\u6b3e"
};
const quickReasons = ["\u6d41\u6c34\u672a\u67e5\u5230", "\u91d1\u989d\u4e0e\u622a\u56fe\u4e0d\u7b26", "\u8d26\u6237\u9009\u9519"];

function yuan(value: string | number | null | undefined) {
  const number = typeof value === "number" ? value : Number(value ?? "");
  if (!Number.isFinite(number)) return "\u2014";
  return "\u00a5" + number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Card = {
  key: string;
  source: "api" | "demo";
  orderId?: string;
  receiptId?: string;
  status: "pending" | "confirmed" | "rejected";
  amount: string;
  currency: string;
  thirdParty: boolean;
  purpose: string;
  channel: string;
  date: string;
  orderRef: string;
  customer: string;
  operator: string;
  proof?: string;
  historic: boolean;
  verifiedCny?: string | null;
  feeCny?: string | null;
  verifiedOn?: string | null;
  receivedCny?: string | null;
  reason?: string | null;
  charge?: boolean;
};

const DEMO_PROOF_CNY = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="420" viewBox="0 0 320 420"><rect width="320" height="420" rx="18" fill="#f3f8f6"/><rect x="20" y="24" width="280" height="72" rx="12" fill="#0e2c27"/><text x="40" y="56" fill="#fff" font-size="16" font-family="sans-serif">客户付款凭证（演练样例）</text><text x="40" y="80" fill="#b7d8ce" font-size="12" font-family="sans-serif">人民币直收 · 微信转账</text><text x="160" y="168" text-anchor="middle" fill="#0e2c27" font-size="34" font-weight="bold" font-family="monospace">¥1,980.00</text><rect x="28" y="210" width="264" height="1" fill="#d7e3df"/><text x="32" y="248" fill="#5d6b66" font-size="14" font-family="sans-serif">付款人：演练客户·已成交</text><text x="32" y="280" fill="#5d6b66" font-size="14" font-family="sans-serif">收款账户：公司微信收款01</text><text x="32" y="312" fill="#5d6b66" font-size="14" font-family="sans-serif">状态：对方已付款，待财务核流水</text></svg>');
const DEMO_PROOF_FX = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="420" viewBox="0 0 320 420"><rect width="320" height="420" rx="18" fill="#f7f6f2"/><rect x="20" y="24" width="280" height="72" rx="12" fill="#17594c"/><text x="40" y="56" fill="#fff" font-size="16" font-family="sans-serif">外币代收凭证（演练样例）</text><text x="40" y="80" fill="#c7e4dc" font-size="12" font-family="sans-serif">台币第三方代收 · 待核到账</text><text x="160" y="168" text-anchor="middle" fill="#0e2c27" font-size="32" font-weight="bold" font-family="monospace">6,800.00 TWD</text><rect x="28" y="210" width="264" height="1" fill="#dcd9d0"/><text x="32" y="248" fill="#5d6b66" font-size="14" font-family="sans-serif">付款人：演练客户·复购</text><text x="32" y="280" fill="#5d6b66" font-size="14" font-family="sans-serif">代收账户：台湾第三方通道A</text><text x="32" y="312" fill="#5d6b66" font-size="14" font-family="sans-serif">客服折合参考：¥1,520.00</text></svg>');

function statusOf(payment: FinancePayment): Card["status"] {
  if (payment.verify_status === "pending" || payment.verify_status === "rejected") return payment.verify_status;
  return "confirmed";
}

export function PaymentReview({ today, payments, error, onChanged }: {
  today: string;
  payments: FinancePayment[] | null;
  error: string;
  onChanged: () => void;
}) {
  const demo = import.meta.env.MODE === "demo";
  const crm = useCustomerCrm(today);
  const [tab, setTab] = useState<Tab>("pending");
  const [channel, setChannel] = useState<Channel>("all");
  const [open, setOpen] = useState("");
  const [mode, setMode] = useState<"confirm" | "reject" | "">("");
  const [verifiedCny, setVerifiedCny] = useState("");
  const [feeCny, setFeeCny] = useState("0");
  const [verifiedOn, setVerifiedOn] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [zoom, setZoom] = useState("");
  const [sampleCards, setSampleCards] = useState<Card[]>(() => demo ? [
    { key: "sample:cny-1", source: "demo", status: "pending", amount: "1980.00", currency: "CNY", thirdParty: false, purpose: "deposit", channel: "公司微信收款01", date: today, orderRef: "DEMO-PAY-01", customer: "演练客户·已成交", operator: "演示客服甲", proof: DEMO_PROOF_CNY, historic: false, receivedCny: "1980.00" },
    { key: "sample:fx-1", source: "demo", status: "pending", amount: "6800.00", currency: "TWD", thirdParty: true, purpose: "balance", channel: "台湾第三方通道A", date: today, orderRef: "DEMO-PAY-02", customer: "演练客户·复购", operator: "演示客服甲", proof: DEMO_PROOF_FX, historic: false, receivedCny: "1520.00" }
  ] : []);

  const cards = useMemo(() => {
    const apiCards: Card[] = (payments ?? []).filter(row => !row.voided_at).map(row => ({
      key: "api:" + row.id,
      source: "api",
      receiptId: row.id,
      status: statusOf(row),
      amount: row.amount,
      currency: row.currency,
      thirdParty: !!row.third_party || row.currency !== "CNY",
      purpose: row.after_sale_charge_id ? "balance" : row.purpose,
      channel: row.channel,
      date: row.payment_date,
      orderRef: row.order_ref,
      customer: row.customer_label,
      operator: row.operator_name || "",
      proof: row.proof_id ? "/api/finance/payments/" + row.id + "/proof" : "",
      historic: !row.proof_id && statusOf(row) === "confirmed" && !row.verify_status,
      verifiedCny: row.verified_cny,
      feeCny: row.fee_cny,
      verifiedOn: row.verified_on,
      receivedCny: row.received_cny,
      reason: row.verify_reason,
      charge: !!row.after_sale_charge_id
    }));
    if (!demo) return apiCards;
    const demoCards: Card[] = crm.state.orders.flatMap(order => (order.receipts ?? []).filter(receipt => !receipt.voidedAt).map(receipt => {
      const customer = crm.state.customers.find(item => item.id === order.customerId);
      return {
        key: "demo:" + receipt.id,
        source: "demo" as const,
        orderId: order.id,
        receiptId: receipt.id,
        status: receipt.verifyStatus ?? "pending",
        amount: centsToYuan(receipt.amountMinor),
        currency: order.customerCurrency ?? "CNY",
        thirdParty: (order.customerCurrency ?? "CNY") !== "CNY",
        purpose: receipt.purpose,
        channel: receipt.channel,
        date: receipt.date,
        orderRef: order.id,
        customer: customer?.name || "\u6f14\u7ec3\u5ba2\u6237",
        operator: receipt.reportedBy,
        proof: receipt.proofUrl || "",
        historic: !receipt.proofUrl && (receipt.verifyStatus ?? "pending") !== "pending",
        verifiedCny: receipt.verifiedCny == null ? null : centsToYuan(receipt.verifiedCny),
        feeCny: receipt.feeCny == null ? null : centsToYuan(receipt.feeCny),
        verifiedOn: receipt.verifiedOn,
        receivedCny: (order.customerCurrency ?? "CNY") === "CNY" ? centsToYuan(receipt.amountMinor) : null,
        reason: receipt.verifyReason,
        charge: false
      };
    }));
    return [...demoCards, ...sampleCards, ...apiCards];
  }, [payments, demo, crm.state, sampleCards]);

  const visible = cards.filter(card => card.status === tab).filter(card => {
    if (tab !== "pending" || channel === "all") return true;
    return channel === "cny" ? card.currency === "CNY" && !card.thirdParty : card.currency !== "CNY" || card.thirdParty;
  });
  const pendingCount = cards.filter(card => card.status === "pending").length;
  const rejectedCount = cards.filter(card => card.status === "rejected").length;
  const confirmedCny = cards.filter(card => card.status === "confirmed").reduce((sum, card) => sum + (Number(card.verifiedCny || (card.currency === "CNY" && !card.thirdParty ? card.amount : "0")) || 0), 0);
  const feeTotal = cards.filter(card => card.status === "confirmed").reduce((sum, card) => sum + (Number(card.feeCny || 0) || 0), 0);

  function start(card: Card, next: "confirm" | "reject") {
    setOpen(card.key);
    setMode(next);
    setLocalError("");
    setReason("");
    setFeeCny("0");
    setVerifiedOn(today);
    setVerifiedCny(card.currency === "CNY" && !card.thirdParty ? Number(card.amount).toFixed(2) : (card.receivedCny || card.verifiedCny || ""));
  }

  async function submit(card: Card) {
    setBusy(true);
    setLocalError("");
    try {
      if (mode === "confirm") {
        if (!verifiedCny.trim()) throw new Error("\u8bf7\u586b\u5199\u5b9e\u9645\u5230\u8d26\u4eba\u6c11\u5e01");
        if (card.key.startsWith("sample:")) {
          setSampleCards(rows => rows.map(row => row.key === card.key ? { ...row, status: "confirmed", verifiedCny: Number(verifiedCny).toFixed(2), feeCny: Number(feeCny || "0").toFixed(2), verifiedOn, reason: "" } : row));
        } else if (card.source === "demo") {
          crm.dispatch({ type: "verifyReceipt", orderId: card.orderId || "", receiptId: card.receiptId || "", status: "confirmed", verifiedCny: Math.round(Number(verifiedCny) * 100), feeCny: Math.round(Number(feeCny || "0") * 100), verifiedOn });
        } else {
          await api.financeAction("payments/" + card.receiptId + "/confirm", { verifiedCny: Number(verifiedCny).toFixed(2), feeCny: Number(feeCny || "0").toFixed(2), verifiedOn });
          onChanged();
        }
      } else {
        const text = reason.trim();
        if (!text) throw new Error("\u8bf7\u586b\u5199\u9000\u56de\u539f\u56e0");
        if (card.key.startsWith("sample:")) {
          setSampleCards(rows => rows.map(row => row.key === card.key ? { ...row, status: "rejected", reason: text } : row));
        } else if (card.source === "demo") crm.dispatch({ type: "verifyReceipt", orderId: card.orderId || "", receiptId: card.receiptId || "", status: "rejected", reason: text });
        else {
          await api.financeAction("payments/" + card.receiptId + "/reject", { reason: text });
          onChanged();
        }
      }
      setOpen("");
      setMode("");
    } catch (cause) {
      setLocalError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return <div className="pay-review">
    <div className="pay-review-kpis">
      <article><span>{"\u5f85\u786e\u8ba4\u5230\u8d26"}</span><strong className="pay-num">{pendingCount}</strong></article>
      <article><span>{"\u5df2\u786e\u8ba4\u5b9e\u5230"}</span><strong className="pay-num">{yuan(confirmedCny)}</strong></article>
      <article><span>{"\u7d2f\u8ba1\u7b2c\u4e09\u65b9\u6263\u70b9"}</span><strong className="pay-num">{yuan(feeTotal)}</strong></article>
      <article><span>{"\u6838\u8d26\u9000\u56de"}</span><strong className="pay-num">{rejectedCount}</strong></article>
    </div>
    <div className="pay-review-tabs" role="tablist">
      {([["pending", "\u5f85\u786e\u8ba4\u5230\u8d26"], ["confirmed", "\u5df2\u786e\u8ba4\u5230\u8d26"], ["rejected", "\u6838\u8d26\u9000\u56de"]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} className={tab === id ? "selected" : ""} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {tab === "pending" && <div className="pay-review-channels">
      {([["all", "\u5168\u90e8\u6e20\u9053"], ["cny", "\u4eba\u6c11\u5e01\u76f4\u6536"], ["fx", "\u5916\u5e01\u4e0e\u7b2c\u4e09\u65b9"]] as const).map(([id, label]) => <button type="button" key={id} className={channel === id ? "selected" : ""} onClick={() => setChannel(id)}>{label}</button>)}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {localError && <p className="error" role="alert">{localError}</p>}
    {!payments && !error && <p className="hint">{"\u6b63\u5728\u8bfb\u53d6\u6536\u6b3e\u2026"}</p>}
    {payments && !visible.length && <p className="notice">{"\u8fd9\u4e00\u7c7b\u6682\u65f6\u6ca1\u6709\u6536\u6b3e\u3002"}</p>}
    <div className="pay-review-list">
      {visible.map(card => <article className="pay-review-card" key={card.key}>
        <button type="button" className="pay-proof-shot" disabled={!card.proof} onClick={() => card.proof && setZoom(card.proof)}>{card.proof ? <img src={card.proof} alt="" /> : <span>{"\u5386\u53f2\u65e0\u56fe"}</span>}</button>
        <div className="pay-review-main">
          <strong className="pay-num">{card.amount} {card.currency}</strong>
          <div className="pay-review-pills">
            <span>{card.currency === "CNY" && !card.thirdParty ? "\u4eba\u6c11\u5e01\u76f4\u6536" : "\u5916\u5e01\u4e0e\u7b2c\u4e09\u65b9"}</span>
            <span>{card.charge ? "\u552e\u540e\u6b3e" : (purposeText[card.purpose] || "\u6536\u6b3e")}</span>
          </div>
          <small>{card.date} · {card.channel || "\u8d26\u6237\u5f85\u8865"} · {card.orderRef}</small>
          <small>{card.customer} · {card.operator || "\u5ba2\u670d\u5f85\u8865"}</small>
          {card.status === "confirmed" && <small className="pay-num">{"\u5b9e\u5230 "}{yuan(card.verifiedCny || card.amount)}{" · \u6263\u70b9 "}{yuan(card.feeCny || "0")}{card.verifiedOn ? " · " + card.verifiedOn : ""}</small>}
          {card.status === "rejected" && <small className="pay-reject">{"\u6838\u8d26\u9000\u56de"}{card.reason ? "\uff1a" + card.reason : ""}</small>}
        </div>
        {card.status === "pending" && <div className="pay-review-actions">
          <button type="button" disabled={busy} onClick={() => start(card, "confirm")}>{"\u786e\u8ba4\u5230\u8d26"}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => start(card, "reject")}>{"\u672a\u5230\u8d26 / \u9000\u56de"}</button>
        </div>}
        {open === card.key && mode === "confirm" && <form className="pay-review-form" onSubmit={event => { event.preventDefault(); void submit(card); }}>
          <label>{"\u5b9e\u9645\u5230\u8d26\u4eba\u6c11\u5e01 (\u00a5)"}<input className="pay-num" required inputMode="decimal" value={verifiedCny} onChange={event => setVerifiedCny(event.target.value)} /></label>
          <label>{"\u7b2c\u4e09\u65b9\u6263\u70b9 (\u00a5)"}<input className="pay-num" inputMode="decimal" value={feeCny} onChange={event => setFeeCny(event.target.value)} /></label>
          <label>{"\u5b9e\u9645\u5230\u8d26\u65e5\u671f"}<input className="pay-num" required type="date" max={today} value={verifiedOn} onChange={event => setVerifiedOn(event.target.value)} /></label>
          <div className="pay-review-form-actions"><button disabled={busy}>{busy ? "\u4fdd\u5b58\u4e2d\u2026" : "\u786e\u8ba4\u5df2\u5230\u8d26"}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setOpen(""); setMode(""); }}>取消</button></div>
        </form>}
        {open === card.key && mode === "reject" && <form className="pay-review-form" onSubmit={event => { event.preventDefault(); void submit(card); }}>
          <div className="pay-review-channels">{quickReasons.map(item => <button type="button" key={item} onClick={() => setReason(item)}>{item}</button>)}</div>
          <label>{"\u9000\u56de\u539f\u56e0"}<input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <div className="pay-review-form-actions"><button disabled={busy}>{busy ? "\u4fdd\u5b58\u4e2d\u2026" : "\u9000\u56de\u5ba2\u670d"}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setOpen(""); setMode(""); }}>取消</button></div>
        </form>}
      </article>)}
    </div>
    {zoom && <div className="ship-proof-viewer" role="dialog" onClick={() => setZoom("")}><img src={zoom} alt="" /></div>}
  </div>;
}

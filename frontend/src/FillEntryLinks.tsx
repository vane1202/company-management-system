import { useState } from "react";
import { fillEntries, fillLink, isLocalOnlyOrigin, type FillEntry } from "./fillEntries";

export function FillEntryLinks() {
  const [message, setMessage] = useState("");
  const origin = window.location.origin;
  return <section className="review-card">
    <h3>客服统一填报入口</h3>
    <p className="notice">所有客服使用下面两个固定入口。首次输入登记码后，选择已录入的WhatsApp或Messenger接待账号；后续加粉、线索和订单归属该账号。</p>
    {isLocalOnlyOrigin(origin) && <p className="notice">以下是本机测试链接，外地客服暂时无法打开。国内云服务器和 HTTPS 域名部署完成后，在正式地址打开本页即可复制远程链接。</p>}
    {(Object.keys(fillEntries) as FillEntry[]).map((entry) => <div className="row" key={entry}>
      <label>{fillEntries[entry].title}<input aria-label={`${fillEntries[entry].title}链接`} readOnly value={fillLink(origin, entry)} /></label>
      <div className="actions">
        <a className="btn secondary" href={fillEntries[entry].path}>打开入口</a>
        <button type="button" className="secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(fillLink(origin, entry)); setMessage(`已复制${fillEntries[entry].title}链接`); }
          catch { setMessage("无法自动复制，请在上方输入框中手动复制链接。"); }
        }}>复制链接</button>
      </div>
    </div>)}
    {message && <p role="status" className="ok">{message}</p>}
  </section>;
}

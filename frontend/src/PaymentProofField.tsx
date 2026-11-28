import { useEffect, useState } from "react";
import { resolveImageMime } from "./imageMime";

const MAX_BYTES = 8 * 1024 * 1024;

export function PaymentProofField({ file, remoteUrl, disabled, onChange }: {
  file: File | null;
  remoteUrl?: string;
  disabled?: boolean;
  onChange: (file: File | null) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!file) { setUrl(""); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const preview = url || remoteUrl || "";
  async function pick(next: File | null) {
    setError("");
    if (!next) { onChange(null); return; }
    if (next.size > MAX_BYTES) { setError("\u6bcf\u5f20\u4ed8\u6b3e\u51ed\u8bc1\u6700\u591a 8MB"); return; }
    const mime = await resolveImageMime(next);
    if (!mime) { setError("\u8bf7\u4e0a\u4f20 JPEG\u3001PNG \u6216 WebP \u56fe\u7247"); return; }
    onChange(next);
  }
  return <div className="pay-proof">
    <span className="ship-proof-label">{"\u5ba2\u6237\u4ed8\u6b3e\u51ed\u8bc1\u622a\u56fe\uff08\u5fc5\u586b\uff0cJPEG / PNG / WebP\uff0c\u5355\u5f20\u4e0d\u8d85\u8fc7 8MB\uff09"}</span>
    {preview ? <div className="pay-proof-row">
      <button type="button" className="ship-proof-thumb" onClick={() => setOpen(true)} aria-label={"\u67e5\u770b\u4ed8\u6b3e\u51ed\u8bc1"}><img src={preview} alt="" /></button>
      <span className="ship-proof-actions">
        <label className="text-action">{"\u66ff\u6362"}<input type="file" accept="image/*" disabled={disabled} onChange={event => { const next = event.target.files?.[0] ?? null; event.currentTarget.value = ""; void pick(next); }} /></label>
        <button type="button" className="text-action" disabled={disabled} onClick={() => onChange(null)}>{"\u79fb\u9664"}</button>
      </span>
    </div> : <label className="order-photo-add pay-proof-add">{"\u9009\u62e9\u56fe\u7247"}<input type="file" accept="image/*" disabled={disabled} onChange={event => { const next = event.target.files?.[0] ?? null; event.currentTarget.value = ""; void pick(next); }} /></label>}
    {error && <p className="error" role="alert">{error}</p>}
    {open && preview && <div className="ship-proof-viewer" role="dialog" onClick={() => setOpen(false)}><img src={preview} alt="" /></div>}
  </div>;
}

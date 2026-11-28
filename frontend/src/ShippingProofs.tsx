import { useEffect } from "react";
import { resolveImageMime } from "./imageMime";

export type ShippingShot = { id: string; name: string; src: string; file?: File; remote?: boolean };

const LIMIT = 3;
const MAX_BYTES = 8 * 1024 * 1024;

export function shippingShotId() {
  return "ship-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export async function readShippingFiles(list: FileList | File[]): Promise<{ shots: ShippingShot[]; error: string }> {
  const shots: ShippingShot[] = [];
  for (const file of Array.from(list)) {
    if (file.size > MAX_BYTES) return { shots: [], error: '每张快递截图最多 8MB' };
    const mime = await resolveImageMime(file);
    if (!mime) return { shots: [], error: '请上传 JPEG、PNG 或 WebP 图片' };
    shots.push({ id: shippingShotId(), name: file.name || '快递记录截图', src: URL.createObjectURL(file), file });
  }
  return { shots, error: "" };
}

export function releaseShippingShot(shot: ShippingShot) {
  if (shot.src.startsWith("blob:")) URL.revokeObjectURL(shot.src);
}

export function ShippingProofEditor({ shots, disabled, onAdd, onRemove, onReplace, onOpen }: {
  shots: ShippingShot[];
  disabled?: boolean;
  onAdd: (files: FileList) => void;
  onRemove: (id: string) => void;
  onReplace: (id: string, file: File) => void;
  onOpen: (index: number) => void;
}) {
  return <div className="ship-proofs">
    <span className="ship-proof-label">快递记录截图（选填，最多 3 张，JPEG / PNG / WebP，单张不超过 8MB）</span>
    <div className="ship-proof-grid">
      {shots.map((shot, index) => <div className="ship-proof-item" key={shot.id}>
        <button type="button" className="ship-proof-thumb" onClick={() => onOpen(index)} aria-label={'查看' + shot.name}><img src={shot.src} alt="" /></button>
        <span className="ship-proof-actions">
          <button type="button" className="text-action" disabled={disabled} onClick={() => onRemove(shot.id)}>移除</button>
          <label className="text-action">替换<input type="file" accept="image/*" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) onReplace(shot.id, file); }} /></label>
        </span>
      </div>)}
      {shots.length < LIMIT && <label className="ship-proof-add">选择图片<input type="file" accept="image/*" multiple disabled={disabled} onChange={event => { const files = event.target.files; event.currentTarget.value = ""; if (files?.length) onAdd(files); }} /></label>}
    </div>
  </div>;
}

export function ShippingProofViewer({ shots, index, onClose, onIndex }: {
  shots: ShippingShot[];
  index: number;
  onClose: () => void;
  onIndex: (index: number) => void;
}) {
  useEffect(() => {
    if (index < 0) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose]);
  if (index < 0 || !shots[index]) return null;
  return <div className="ship-proof-view" role="dialog" aria-modal="true" aria-label='快递记录截图'>
    <button type="button" className="ship-proof-backdrop" aria-label='关闭预览' onClick={onClose} />
    <div className="ship-proof-stage">
      <img src={shots[index].src} alt={shots[index].name} />
      <div className="ship-proof-nav">
        {shots.length > 1 && <button type="button" className="secondary" onClick={() => onIndex((index + shots.length - 1) % shots.length)}>上一张</button>}
        <button type="button" onClick={onClose}>关闭</button>
        {shots.length > 1 && <button type="button" className="secondary" onClick={() => onIndex((index + 1) % shots.length)}>下一张</button>}
      </div>
    </div>
  </div>;
}

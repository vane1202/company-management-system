export type DemoShippingShot = { id: string; name: string; url: string };
export type DemoShippingEntry = { shippedOn: string; shots: DemoShippingShot[] };

const KEY = "cms-demo-shipping-proofs-v1";

type ShippingWindow = Window & { CmsShippingProofs?: Record<string, DemoShippingEntry> };

function readStored(): Record<string, DemoShippingEntry> {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) || "{}") as Record<string, DemoShippingEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberShippingProofs(orderId: string, shippedOn: string, shots: DemoShippingShot[]) {
  const page = window as ShippingWindow;
  const next = { ...readStored(), ...(page.CmsShippingProofs || {}), [orderId]: { shippedOn, shots } };
  page.CmsShippingProofs = next;
  const persisted: Record<string, DemoShippingEntry> = {};
  for (const [id, entry] of Object.entries(next)) {
    persisted[id] = { shippedOn: entry.shippedOn, shots: entry.shots.filter(shot => shot.url.startsWith("data:")) };
  }
  try { sessionStorage.setItem(KEY, JSON.stringify(persisted)); } catch { /* ????????? */ }
}

export function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Public reference quotes only; requests never include business amounts or customer data. */
export const FX_REFRESH_MS = 60 * 60 * 1000;
const sourceUrl = "https://api.exchangerate.dev/v1";
const sourceName = "Exchangerate.dev";
const cachePrefix = "cms-demo-reference-fx-v2:";
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + "T00:00:00Z")) && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
const businessDay = (now: number) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export type FxCurrency = "USD" | "TWD";
export type FxQuote = { currency: FxCurrency; date: string; rate: string; updatedAt: string; checkedAt: number; source: string; sourceDate: string; delayed: boolean; stale: boolean };
export type AdFxView = { cny: string | null; usd: string; quotes: FxQuote[]; missingDates: string[]; incomplete: boolean; stale: boolean };
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type FxOptions = { fetcher?: typeof fetch; storage?: StorageLike | null; now?: () => number; currency?: FxCurrency; onQuote?: (quote: FxQuote) => void };

function scaledRate(value: unknown): bigint | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (!Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 1000000) return null;
  const [whole, fraction] = Number(value).toFixed(6).split(".");
  const scaled = BigInt(whole) * 1000000n + BigInt(fraction);
  return scaled > 0n ? scaled : null;
}
function cents(value: string): bigint | null {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
const money = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
const timestampOk = (value: unknown, now: number): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 5 * 60000;

export function createAdFxClient(options: FxOptions = {}) {
  const currency = options.currency ?? "USD";
  const pairPrefix = cachePrefix + currency + ":";
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let storage: StorageLike | null = options.storage ?? null;
  if (options.storage === undefined) { try { storage = window.localStorage; } catch { /* Memory cache still works. */ } }
  const memory = new Map<string, FxQuote>();
  const pending = new Map<string, Promise<FxQuote | null>>();
  const failures = new Map<string, number>();
  let hostFailedAt = -Infinity;
  function read(key: string): FxQuote | null {
    if (memory.has(key)) return memory.get(key)!;
    try {
      const quote = JSON.parse(storage?.getItem(pairPrefix + key) ?? "null") as FxQuote | null;
      if (quote && quote.currency === currency && validDate(quote.date) && quote.date <= businessDay(now()) && validDate(quote.sourceDate) && quote.sourceDate <= quote.date && scaledRate(quote.rate) !== null && timestampOk(quote.updatedAt, now()) && Number.isFinite(quote.checkedAt) && quote.checkedAt <= now() && quote.source === sourceName && typeof quote.delayed === "boolean" && typeof quote.stale === "boolean" && (key === "latest" || quote.date === key)) {
        memory.set(key, quote); return quote;
      }
    } catch { /* Invalid/blocked browser storage cannot affect the display. */ }
    return null;
  }
  function save(key: string, quote: FxQuote) {
    const previous = memory.get(key);
    memory.set(key, quote);
    try { storage?.setItem(pairPrefix + key, JSON.stringify(quote)); } catch { /* Storage can be disabled or full. */ }
    if (!previous || previous.rate !== quote.rate || previous.updatedAt !== quote.updatedAt || previous.stale !== quote.stale) options.onQuote?.(quote);
  }
  async function get(date: string): Promise<FxQuote | null> {
    const clock = now(), today = businessDay(clock);
    if (!validDate(date) || date > today) return null;
    const latest = date === today, key = latest ? "latest" : date;
    const cached = read(key);
    const fallback = () => cached ? { ...cached, date, stale: true } : null;
    if (cached && (!latest || clock - cached.checkedAt < FX_REFRESH_MS && cached.date === today)) return { ...cached, stale: cached.stale || latest && clock - Date.parse(cached.updatedAt) > 2 * FX_REFRESH_MS };
    if (clock - (failures.get(key) ?? -Infinity) < 60000 || clock - hostFailedAt < 60000) return fallback();
    if (pending.has(key)) return pending.get(key)!;
    const work = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetcher(`${sourceUrl}/${latest ? "latest" : date}/${currency}?symbols=CNY`, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) throw Error("Rate unavailable");
        const data = await response.json();
        const scaled = scaledRate(data.rates?.CNY);
        const updatedAt = latest ? data.effective_at?.CNY ?? data.data_updated_at : data.data_updated_at;
        const sourceDate = latest && timestampOk(updatedAt, clock) ? businessDay(Date.parse(updatedAt)) : data.date;
        if (data.result !== "success" || data.base !== currency || scaled === null || !timestampOk(updatedAt, clock) || !validDate(sourceDate) || sourceDate > date || !latest && (!validDate(data.date) || data.date > date)) throw Error("Invalid quote");
        const quote: FxQuote = { currency, date, rate: (Number(scaled) / 1000000).toFixed(6), updatedAt, checkedAt: clock, source: sourceName, sourceDate, delayed: latest && (data.sources?.CNY ?? data.source) === "live", stale: latest && (data.stale === true || data.stale?.CNY === true || clock - Date.parse(updatedAt) > 2 * FX_REFRESH_MS) };
        save(key, quote); failures.delete(key); hostFailedAt = -Infinity; return quote;
      } catch { failures.set(key, clock); hostFailedAt = clock; return fallback(); }
      finally { clearTimeout(timeout); pending.delete(key); }
    })();
    pending.set(key, work);
    return work;
  }
  return { get };
}

const sharedClients = new Map<FxCurrency, ReturnType<typeof createAdFxClient>>();
let quoteRevision = 0, notificationPending = false;
const quoteListeners = new Set<() => void>();
function quoteChanged() {
  if (notificationPending) return;
  notificationPending = true;
  queueMicrotask(() => { notificationPending = false; quoteRevision++; for (const listener of quoteListeners) listener(); });
}
export const referenceQuoteRevision = () => quoteRevision;
export function subscribeReferenceQuotes(listener: () => void) { quoteListeners.add(listener); return () => { quoteListeners.delete(listener); }; }
export function referenceFxClient(currency: FxCurrency) {
  if (!sharedClients.has(currency)) sharedClients.set(currency, createAdFxClient({ currency, onQuote: quoteChanged }));
  return sharedClients.get(currency)!;
}
export const getReferenceQuote = (date: string, currency: FxCurrency) => referenceFxClient(currency).get(date);

export type CustomerPaymentRow = { date: string; amount: string; currency: string };
export type CustomerPaymentFx = Omit<AdFxView, "usd"> & { hasForeign: boolean };
export async function convertCustomerPayments(records: CustomerPaymentRow[], totals: Record<"CNY" | "USD" | "TWD", string | null>, getQuote = getReferenceQuote): Promise<CustomerPaymentFx> {
  const grouped = new Map<string, {date: string; currency: "CNY" | FxCurrency; amount: bigint}>();
  const native = { CNY: 0n, TWD: 0n, USD: 0n };
  let incomplete = false, hasForeign = false;
  for (const row of records) {
    const amount = cents(row.amount);
    if (amount === null || !validDate(row.date) || !["CNY", "USD", "TWD"].includes(row.currency)) { incomplete = true; continue; }
    const currency = row.currency as keyof typeof native;
    native[currency] += amount;
    if (currency !== "CNY" && amount > 0n) hasForeign = true;
    const key = `${row.date}:${currency}`;
    const previous = grouped.get(key);
    grouped.set(key, { date: row.date, currency, amount: (previous?.amount ?? 0n) + amount });
  }
  for (const currency of ["CNY", "TWD", "USD"] as const) {
    if (totals[currency] === null || cents(totals[currency]!) !== native[currency]) incomplete = true;
  }
  let converted = 0n;
  const quotes: FxQuote[] = [], missingDates: string[] = [];
  for (const row of [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency))) {
    if (!row.amount) continue;
    if (row.currency === "CNY") { converted += row.amount; continue; }
    const quote = await getQuote(row.date, row.currency).catch(() => null);
    const rate = quote?.date === row.date && quote.currency === row.currency ? scaledRate(quote.rate) : null;
    if (!quote || rate === null) { missingDates.push(`${row.date} ${row.currency}`); continue; }
    converted += (row.amount * rate + 500000n) / 1000000n;
    quotes.push(quote);
  }
  return { cny: incomplete || missingDates.length ? null : money(converted), quotes, missingDates, incomplete, stale: quotes.some(q => q.stale), hasForeign };
}

export async function convertAdSpend(records: { date: string; amount: string }[], totalUsd: string, getQuote: (date: string) => Promise<FxQuote | null>, unknownCount = 0): Promise<AdFxView> {
  const grouped = new Map<string, bigint>();
  let incomplete = unknownCount > 0;
  for (const row of records) {
    const amount = cents(row.amount);
    if (amount === null || !validDate(row.date)) { incomplete = true; continue; }
    grouped.set(row.date, (grouped.get(row.date) ?? 0n) + amount);
  }
  const expected = cents(totalUsd);
  if (expected === null || [...grouped.values()].reduce((a, b) => a + b, 0n) !== expected) incomplete = true;
  let converted = 0n;
  const quotes: FxQuote[] = [], missingDates: string[] = [];
  // At most one call per nonzero day. Sequential calls avoid bursting provider quotas.
  for (const [date, amount] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    if (amount === 0n) continue;
    const quote = await getQuote(date).catch(() => null);
    const rate = quote?.date === date ? scaledRate(quote.rate) : null;
    if (!quote || rate === null) { missingDates.push(date); continue; }
    converted += (amount * rate + 500000n) / 1000000n;
    quotes.push(quote);
  }
  return { cny: incomplete || missingDates.length ? null : money(converted), usd: totalUsd, quotes, missingDates, incomplete, stale: quotes.some(q => q.stale) };
}

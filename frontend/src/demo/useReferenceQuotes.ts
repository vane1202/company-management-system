import { useSyncExternalStore } from "react";
import { referenceQuoteRevision, subscribeReferenceQuotes } from "./adExchangeRates";

/** Recompute all visible reference amounts after the shared quote snapshot changes. */
export function useReferenceQuotes() {
  return useSyncExternalStore(subscribeReferenceQuotes, referenceQuoteRevision, referenceQuoteRevision);
}

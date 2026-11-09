import { isIsoDate } from "./dates";

export type SessionMeta = {
  today?: string;
  timezone?: string;
  backfillDays?: number;
  disclaimer?: string;
};

export function readSessionMeta(payload: SessionMeta | null | undefined): SessionMeta & { today: string } {
  const today = typeof payload?.today === "string" && isIsoDate(payload.today) ? payload.today : "";
  return {
    today,
    timezone: payload?.timezone,
    backfillDays: typeof payload?.backfillDays === "number" ? payload.backfillDays : undefined,
    disclaimer: typeof payload?.disclaimer === "string" ? payload.disclaimer : ""
  };
}

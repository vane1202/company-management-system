export function toErrorMessage(err: unknown, fallback = "加载失败"): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

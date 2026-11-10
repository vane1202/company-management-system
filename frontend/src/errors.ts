/** 用户可见的失败文案。写操作说明“本次未保存”，读取说明“未能读取”。 */
export const NETWORK_ERROR = "网络中断，本次未保存，请检查网络后重试";
export const SESSION_EXPIRED = "登录已过期，请重新登录；本次内容未保存";
export const SERVER_ERROR = "服务器出错，本次未保存，请稍后重试";
export const NETWORK_ERROR_READ = "网络中断，未能读取数据，请检查网络后重试";
export const SESSION_EXPIRED_READ = "登录已过期，请重新登录";
export const SERVER_ERROR_READ = "服务器出错，未能读取数据，请稍后重试";

/** 后端 500 兜底文案，不含具体原因，与“无文案”同等处理。 */
const GENERIC_SERVER_TEXT = "服务器内部错误";

/**
 * 把 HTTP 失败翻译成可读原因。
 * - 401 且后端只说“未登录”或没有文案 → 登录已过期（“登录名或密码不正确”等具体 401 原样保留）。
 * - 5xx 且没有具体文案 → 服务器出错。
 * - 其余（400/403/409/413 等）用后端中文原文。
 */
export function httpErrorMessage(status: number, backendText: string | undefined, write: boolean): string {
  const text = (backendText ?? "").trim();
  if (status === 401 && (!text || text === "未登录")) return write ? SESSION_EXPIRED : SESSION_EXPIRED_READ;
  if (status >= 500 && (!text || text === GENERIC_SERVER_TEXT)) return write ? SERVER_ERROR : SERVER_ERROR_READ;
  return text || `请求失败（${status}）`;
}

export function networkErrorMessage(write: boolean): string {
  return write ? NETWORK_ERROR : NETWORK_ERROR_READ;
}

/** 浏览器在断网/连接被拒时抛出的 TypeError（Chrome “Failed to fetch”、Safari “Load failed”、Firefox “NetworkError…”）。 */
export function isFetchNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /failed to fetch|load failed|networkerror|network request failed/i.test(err.message);
}

export function toErrorMessage(err: unknown, fallback = "加载失败"): string {
  if (isFetchNetworkError(err)) return NETWORK_ERROR;
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

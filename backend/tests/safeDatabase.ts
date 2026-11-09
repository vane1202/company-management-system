export function inspectDatabaseUrl(url: string): { host: string; port: string; name: string } {
  const normalized = url.trim();
  const withAuth = normalized.match(/^[a-z][a-z0-9+.-]*:\/\/[^@/?#]+@([^/?#]+)\/([^?#]+)/i);
  const withoutAuth = normalized.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)\/([^?#]+)/i);
  const matched = withAuth ?? withoutAuth;
  if (!matched) {
    throw new Error("测试数据库地址无效，拒绝执行会清空数据表的集成测试");
  }
  const hostPort = matched[1];
  const name = decodeURIComponent(matched[2].replace(/\/$/, "").split("/")[0] ?? "");
  const ipv6 = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/);
  const host = ipv6 ? ipv6[1] : hostPort.split(":")[0];
  const port = ipv6 ? ipv6[2] || "5432" : hostPort.includes(":") ? hostPort.slice(hostPort.lastIndexOf(":") + 1) : "5432";
  if (!name) {
    throw new Error("测试数据库地址无效，拒绝执行会清空数据表的集成测试");
  }
  return { host, port, name };
}

export function assertNotDemoDatabase(url: string): { host: string; port: string; name: string } {
  const inspected = inspectDatabaseUrl(url);
  if (inspected.name === "cms_demo" || inspected.port === "15433") {
    throw new Error("拒绝在演示库上运行集成测试（检测到 cms_demo 或端口 15433）");
  }
  return inspected;
}

export function resolveTestDatabaseUrl(): string {
  const url = (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  if (!url) {
    throw new Error("未设置 TEST_DATABASE_URL 或 DATABASE_URL，无法运行集成测试");
  }
  const inspected = assertNotDemoDatabase(url);
  console.info(`集成测试数据库 ${inspected.host}:${inspected.port}/${inspected.name}`);
  return url;
}

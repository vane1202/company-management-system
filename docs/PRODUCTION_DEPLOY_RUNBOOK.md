# 翠管家生产加固、备份与发布回滚手册

本手册对应《正式启用前体检报告》（`PRELAUNCH_HEALTHCHECK_20261117.md`）中的基础设施、运维与安全配置项，配合代码仓库内的预检和备份脚本使用。

## 1. 启用 HTTPS 与安全 Cookie（P0-01）

1. 为正式域名完成解析与证书签发（如 Let's Encrypt 或云厂商证书）。
2. 参考 `deploy/nginx-cuiguanjia.conf.example` 配置 80→443 跳转、TLS 与敏感路径 404。
3. 在服务端 `.env` 更新以下配置并确保权限为 `600`：
   - `NODE_ENV=production`
   - `TRUST_PROXY=1`
   - `COOKIE_SECURE=true`
   - `APP_ORIGIN=https://<你的正式域名>`
4. 执行只读预检确认无告警或错误：
   `npm run preflight -- --env-file .env --check-db`
5. 阿里云安全组放行 `443`，确认浏览器访问 `https://` 登录、刷新、图片上传与退出均正常后，关闭临时 `8888` 公网入口。

## 2. 自动备份、异机副本与恢复演练（P0-02）

1. 阿里云控制台为系统盘与数据盘绑定自动快照策略（确认受保护云盘数从 `0/1` 变为 `1/1`），并开启失败告警。
2. 配置定时数据库备份（例如每日 03:00 执行）：
   - 使用 `scripts/backup.sh` 导出 `pg_dump -Fc` 归档，并自动执行 `pg_restore --list` 目录校验。
   - 将生成的 `.dump` 与 `.sha256` 同步到独立存储（OSS 私有桶或异机备份目录），并保留必要附件与脱敏外置配置清单。
3. 在隔离 PostgreSQL 上定期执行恢复演练：
   `TEST_ADMIN_URL="postgres://postgres@127.0.0.1:16542/postgres" bash scripts/verify-backup-restore.sh /path/to/cms-YYYYMMDD.dump`
   核对 `users`、`orders`、`customer_payments`、`order_expenses`、`warehouse_bills`、`audit_logs` 行数及抽样业务记录。

## 3. 低权限运行账号与配置权限（P1-04）

1. 创建专用低权限系统账号（例如 `cuiguanjia`）运行 PM2 业务进程，不再以 `root` 运行 Node 应用。
2. `.env` 文件与备份目录仅属主可读写：
   - `chmod 600 /opt/cuiguanjia/.env`
   - `chmod 700 /var/backups/cuiguanjia`
3. 上传/附件目录仅对 `cuiguanjia` 账号开放读写，数据库应用账号保持非超级用户。

## 4. SSH 访问收紧（P1-05）

1. 先在控制台确认 VNC/Workbench 应急通道可用，并在服务器配置并验证 SSH 公钥登录。
2. 禁用密码登录或将安全组 TCP `22` 来源从 `0.0.0.0/0` 收窄为固定办公/管理员 IP。
3. 保持 PostgreSQL（`5432`）和 Node 应用（`13080`）仅监听 `127.0.0.1`。

## 5. 可追溯发布与回滚流程（P1-06）

1. 禁止直接在生产运行目录手改源码。每次发布以固定 Git commit 生成发布包并记录 commit SHA、包 SHA-256 与迁移编号。
2. 发布顺序：先执行 `scripts/backup.sh` 完成备份与校验 -> 停止业务进程 -> 切换到新版本目录 -> `npm ci && npm run build` -> `npm run migrate` -> 启动进程并检查 `/api/health`。
3. 回滚区分两类：
   - **代码回滚**（未涉及不可逆数据结构变更）：切回上一已验证发布目录并重启服务。
   - **库与代码联合回滚**（迁移后出现异常）：停服 -> 使用发布前备份 `.dump` 在确认无误后恢复数据库 -> 切回上一版本目录启动并核验健康检查与关键台账。

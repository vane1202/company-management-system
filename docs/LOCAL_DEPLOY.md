# 本地部署准备说明与验收清单

本文是给后续执行人（含 Codex）的**部署准备文档**，不是“已经部署完成”或“已经验收通过”的证明。
当前没有在用户电脑上执行安装，也没有做云上部署。

## 已验证与未验收

- 已在开发箱上为预检逻辑编写并运行单元测试；预检命令本身不启动业务服务。
- Linux / Docker 的步骤来自仓库现有 `Dockerfile`、`docker-compose.yml`、`.env.example` 和本文，**仍须在目标环境实际执行后才能算部署验收**。
- Windows 本机安装**尚未验收**。火绒曾以 `HEUR:TrojanDownloader/PS.NetLoader.ae` 删除 `Start-Cms.ps1`。相关步骤须安全厂商复核后再由执行人决定是否继续。
- 换一条启动命令、增加另一个启动器，或重新打包，**都不能**当作告警已经解决。

## 安装前提

- Node.js 20 或更高（`package.json` 的 `engines.node` 为 `>=20`）
- PostgreSQL 16 或更高（Compose 示例镜像为 `postgres:16-alpine`）
- 正式或可复现安装优先使用锁定文件：`npm ci`（仓库含 `package-lock.json`）
- 复制 `.env.example` 为 `.env` 后填写真实值，不要提交 `.env`
- 内测默认把应用和数据库绑在 `127.0.0.1`，不要对公网开放
- 生产或经 HTTPS 的内测：足够长的随机 `SESSION_SECRET`，并设 `COOKIE_SECURE=true`
- `TRUST_PROXY` 仅在确认前面有反向代理时开启
- 生产不要设置 `SEED_DEMO=1`

## 启动前只读预检

```bash
# 默认不读取 .env，只检查当前进程环境和 Node / lockfile
npm run preflight

# 显式检查某个环境文件（可以是你刚写好的 .env，或仓库里的 .env.example）
npm run preflight -- --env-file .env.example
npm run preflight -- --env-file .env

# 额外做数据库只读连通：只执行 SELECT version / current_database
npm run preflight -- --env-file .env --check-db
```

预检会检查：

- Node 主版本是否满足 20+
- 是否存在 `package-lock.json`
- 必需变量 `DATABASE_URL`、`SESSION_SECRET` 是否缺失
- 是否仍在使用示例占位符（不输出具体值）
- 主机、端口、`APP_ORIGIN`、数据库地址格式
- 是否误指向演示库（库名 `cms_demo` 或端口 `15433`）

预检**不会**：自动安装软件、下载代码、读取未指定的 `.env`、修改数据库、运行迁移、启动 Web 服务，或代替任何启动脚本。

用 `.env.example` 跑预检预期会失败，因为它里面的秘密是占位符。这可以用来确认检查本身有效。

## Linux / Docker 本地步骤（准备稿，执行后才算部署）

1. 复制并编辑环境文件：`cp .env.example .env`，填写 `DATABASE_URL`、`SESSION_SECRET`、`POSTGRES_PASSWORD`。
2. `npm run preflight -- --env-file .env`
3. 启动仅数据库：`docker compose up -d db`，或把 `DATABASE_URL` 指到已有 PostgreSQL（示例宿主机端口 `15432`）。
4. `npm run preflight -- --env-file .env --check-db`
5. 可复现安装：`npm ci`（开发也可 `npm install`，上线前应能用 `npm ci` 成功）。
6. `npm run migrate`
7. `npm run init-admin`（不要把管理员口令写入仓库）。
8. 开发：`npm run dev`，浏览器打开 `http://127.0.0.1:15173`。
9. 或生产式本地预览：`npm run build` 后 `SERVE_STATIC=true npm run dev:backend`，访问 `http://127.0.0.1:13080`。
10. Compose 一键应用+数据库：在填好 `.env` 后执行 `docker compose up -d --build`。这会启动业务容器，只有在目标环境明确授权时才做。

演示数据默认不写入。若需要虚构账号：`SEED_DEMO=1 npm run seed-demo`。生产不要这样做。

## 回滚

- 应用容器：`docker compose down`（默认不删数据卷）。若只想停应用、保留数据库，停 `app` 服务即可。
- 开发进程：停掉 `npm run dev` / `npm run dev:backend`。
- 代码：回到上一个已知 Git 提交后再安装依赖并启动。不要在回滚时改写或替换被安全软件拦截过的脚本。
- 数据：只有在已经做过备份、并且确认目标库不是演示库 `cms_demo` / 端口 `15433` 时，才考虑用备份恢复。恢复会覆盖数据，必须先核对库名和端口。

## 数据库备份与恢复验收清单

当前 `scripts/backup.sh` 只做明文 `pg_dump` 并 gzip。**不能声称已经具备加密备份或自动上传 OSS。**

备份前：

- [ ] `DATABASE_URL` 指向预期库，且不是 `cms_demo` 或端口 `15433`
- [ ] 有可写的备份目录，备份文件不会被提交到 Git
- [ ] 执行人理解产物是未加密 SQL

备份：

```bash
# 使用当前环境中的 DATABASE_URL，不会打印连接串里的口令
./scripts/backup.sh ./backups
```

恢复验收（在隔离库或明确授权的库上进行，不要对用户电脑或演示库操作）：

- [ ] 新建或指定一个空的恢复目标库，再次确认主机、端口、库名
- [ ] 先恢复到该隔离库，而不是直接覆盖正在使用的库
- [ ] 恢复后抽查：用户表有预期管理员或测试账号结构、迁移表完整、登录与一条只读汇总可用
- [ ] 记录备份文件名、时间、源库名和目标库名（不要记录口令）
- [ ] 若恢复失败，保留原备份，停止继续覆盖

## Windows 步骤（暂停，待厂商复核）

仓库仍保留 `scripts/windows/` 下的原有脚本，包括 `Start-Cms.ps1`。这是为了记录当时的安装设计，**不是授权现在去执行它们**。

已知事实：

- 火绒曾报 `HEUR:TrojanDownloader/PS.NetLoader.ae` 并删除 `Start-Cms.ps1`
- 当时不知情恢复该脚本属于错误；当前停止等待复核
- 禁止恢复、改名、绕过、关闭防护
- 禁止增加另一个 PowerShell、bat 或 Node 启动器来替代被拦截的启动操作
- 禁止把“换一条命令”写成告警解决方案
- 旧的 `ee3ed03` Windows 发布包缺少后续业务修复，且命中防护，不能当推荐可运行交付物
- 当时尝试中本机 PostgreSQL 端口 `15434` 已停，Web `13082` 未成功启动

`scripts/package-windows-release.sh` 仍然存在，并包含打包时排除 `.env` / `.git` / `node_modules` / 凭据文件的检查。在告警复核完成前，**不要重新执行它来生成新的可运行 Windows 安装包**。

厂商复核并得到明确执行授权之前，Windows 相关条目一律视为未验收。

## 本地部署验收清单（执行后勾选）

以下全部完成前，不得声称“本地部署已验收”。

- [ ] 目标机器已安装 Node.js 20+ 与 PostgreSQL 16+
- [ ] 已用 `npm ci` 或文档允许的方式装好依赖，且未提交 `node_modules` 或 `.env`
- [ ] 已显式运行 `npm run preflight -- --env-file <实际环境文件>`，必需变量通过且无占位秘密
- [ ] 如需连通性，已运行 `npm run preflight -- --env-file <实际环境文件> --check-db`，且目标不是演示库
- [ ] 已在该环境执行迁移并创建管理员（口令未写入仓库或聊天）
- [ ] 能用浏览器打开绑定在 `127.0.0.1` 的页面并完成一次登录
- [ ] 已按角色抽查填报或只读汇总（视授权范围）
- [ ] 已演练一次备份；恢复如要做，只在隔离库进行
- [ ] 已记录如何停止服务与如何回滚到上一提交
- [ ] Windows 若在范围内：须先完成安全厂商复核，不能用替代启动器跳过
- [ ] 生产关闭 `SEED_DEMO`，HTTPS 场景开启 `COOKIE_SECURE`

本仓库的单元测试或开发箱测试通过，只能证明检查逻辑和业务代码在当时环境可用，不能替代上述目标环境验收。

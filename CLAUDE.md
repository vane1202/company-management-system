# 翠管家 · 公司内部管理系统

TypeScript + Express + PostgreSQL（后端）、React + Vite（前端，npm workspaces：`backend`、`frontend`）。界面与文档均为中文。

## 常用命令

- 安装：`npm ci`；开发：`npm run dev:backend`、`npm run dev:frontend`
- 前端测试：`npm test -w frontend`；演示测试：`node --test demo/*.test.cjs`
- 后端非数据库测试：`npm test -w backend`（数据库套件在没有测试库时会失败或跳过）
- 后端数据库集成测试：`PGUSER=<user> bash scripts/test-backend-db.sh`，需要本机 `127.0.0.1:16542` 的一次性 PostgreSQL，脚本为每个套件建立各自的隔离库
- 构建：`npm run build`；独立演示：`npm run build -w frontend -- --mode demo --outDir dist-demo`，再 `node scripts/package-role-demo.cjs --boss-p0`（输出在被忽略的 `artifacts/role-demo-site`）

## 必须遵守的边界

- 集成测试会 TRUNCATE 数据表。**绝不**把 `TEST_DATABASE_URL`/`DATABASE_URL` 指向业务库或演示库；测试代码本身也会拒绝 `cms_demo` 与 15433 端口。
- 不提交凭据、`.env`、业务数据库、客户凭证、备份、`artifacts/`、`dist-demo/`。
- 公开演示只使用虚构数据且拒绝写入；已授权客服名册仅在本地用 `--service-directory` 打包，不进 Git。
- 不恢复或执行历史 `Start-Cms.ps1` 与 `scripts/windows/`（曾触发安全软件告警）。
- 推送 GitHub 不会部署演示站，也不会更新 Windows 本地后台；部署需用户明确确认。
- 数据库迁移前先备份；迁移文件只增不改（当前 001–015）。

## 业务口径

以 `docs/` 中最新文档与代码为准，旧文档是历史记录。入口：`docs/GITHUB_SYNC_20261116.md`（最新状态）、`docs/LIVE_TURNOVER_REQUIREMENTS.md`（营业额口径）、`docs/PRODUCTION_CASHFLOW.md`（收费、成本、付款）、`docs/SERVICE_ACCOUNTS.md`（接待账号）、`docs/FAN_LEAD_CONVERSION.md`（线索考核）。

## 前端样式

主题层在 `frontend/src/theme.css`（最后加载），约定见 `docs/UI_THEME_20261117.md`。新组件用其中的 CSS 变量，规则以 `:root` 开头；不加入场动画。

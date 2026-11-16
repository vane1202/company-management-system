# GitHub 最新源码同步（2026-11-16）

同步目标：`vane1202/company-management-system` 的 `main`。基线提交 `d5d2c8b0ecfbe935c55ad88d62cd587f96d99139`。

本次收录累计开发的业务源码、单元测试、迁移与登录准备脚本、演示打包工具及交付记录。最新演示部署版本为 `7cc61dcc-1d7e-422a-bb33-5e5fe95c404f`，包括财务独立入口、收支首页、菜单去重、客服换料定金转单和各端图表切换菜单统一。

其他累计变更包括客服客资与无效复核、账号新增与交接、运营人员与多账号分析、反馈、主管咨询成本、拍剪历史、库房待结账、费用报销、净利润提成和 BOSS 首页及移动端优化。各主题文档保留当时的发布状态；最新同步状态以本文及仓库提交为准。

## 验证

- 前端37个测试文件／223项全部通过。
- 演示模块85项测试全部通过。
- 前端演示构建、后端 TypeScript 构建通过。
- 后端非数据库测试66项通过；10个数据库集成测试套件因未配置独立测试数据库而初始化失败，其中113项未执行。不据此声明数据库集成验证通过，未使用本地业务数据库运行清表测试。
- 最近演示发布已逐页完成图表菜单及375px移动端核验，详见 `CHART_STYLE_CONTROLS_20261116.md`。

## 重建演示

```powershell
npm.cmd ci
npm.cmd run build -w frontend -- --mode demo --outDir dist-demo
node scripts/package-role-demo.cjs --boss-p0
npx.cmd wrangler deploy --config wrangler-demo.json
```

仓库默认使用虚构名册。实际演示站使用的已授权客服名册原始 JSON、生成名册资产与哈希清单位于本地忽略目录 `artifacts/`，不推送到 GitHub。需要加入名册时按 `REGISTERED_SERVICE_DIRECTORY.md` 的显式 `--service-directory` 参数在本地打包。

Windows 安装的本地后台不更新。未执行数据库迁移或启用个人密码登录。临时生成脚本、口令目录、环境文件、数据库文件与构建产物均不收录。

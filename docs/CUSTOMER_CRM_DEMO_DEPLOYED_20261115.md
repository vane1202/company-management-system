# 客服工作台演示发布（2026-11-15）

- 目标：既有 Cloudflare Worker `cuiguanjia-preview`，域名 https://demo.nanzhaoarts.com/ 。
- 当前版本：`40408400`（控制台显示 100% 就绪）。
- 上传完整静态包 52 个文件；点击部署前已确认未找到处理为 `single-page-application`。
- 51 个公开应用资源 HTTP 200 且 SHA256 与本次构建一致；`_headers` 由平台作为响应头配置处理，不作为普通文件比对。
- `/fill`、`/fill/fans`、`/fill/orders`、`/fill/after-sales`、`/fill/performance`、`/fill/attendance`、`/fill/editor` 均 HTTP 200 并返回应用 HTML。
- 浏览器核验：客服首页三大模块、客服姓名与名下账号联动、主管无效客资复核页正常显示。
- 构建与 TypeScript 检查通过；演示 API 33 项测试通过。本次沿用上一轮已通过的前端业务测试结果。
- 客服个人密码登录仍未启用；业务演练仅在浏览器标签页存储。未更新 Windows 本地后台，未同步 GitHub。
- 部署包：`artifacts/role-demo-customer-crm-20261115.zip`；资源及直链核验记录：`artifacts/customer-crm-release-20261115.json`。

## 客服首页布局更新

2026-11-15 已发布版本 `b64a3575`，上一版本 `40408400`。客服身份选择区压缩为两行，登录说明折叠，选定账号后收起为摘要；首页三个业务入口改为独立卡片。上传前已确认 `single-page-application`；51 个公开资源均 HTTP 200 且摘要匹配，6 个填报直链正常。线上浏览器已核验账号联动、自动收起及手机布局。部署包 `artifacts/role-demo-customer-home-layout-20261115.zip`；核验记录 `artifacts/customer-home-layout-release-20261115.json`；截图 `artifacts/customer-home-layout-online-20261115.jpg`。本地后台未更新。

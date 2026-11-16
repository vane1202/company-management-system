# 角色演示站同步上线记录（2026-11-16）

> 本文记录当时的发布。后续最新演示版本与源码同步说明见 [GITHUB_SYNC_20261116.md](GITHUB_SYNC_20261116.md)。

- 目标平台：Cloudflare Worker `cuiguanjia-preview`
- 正式域名：<https://demo.nanzhaoarts.com/>
- 备用域名：<https://cuiguanjia-preview.zhaochangvane.workers.dev/>
- 部署版本：`b4fed339`（完整版本号：`b4fed339-8e6b-47cc-984a-b20a1c04455a`）
- 部署时间：2026-11-16 17:55:20 CST
- 核心构建包：`/assets/index-C1wXT4na.js` + `/assets/index-DpfqUIU4.css`
- 静态资源清单：61 个文件（本次新上传 26 个，复用 34 个，1 个平台规则文件）
- 部署配置：`company-management-system/artifacts/wrangler.demo.jsonc`（启用 SPA 单页应用回退路由 `single-page-application`）

## 线上核验结果

1. **公开资源与哈希校验**：
   - 60 个公开静态前端资源（JS、CSS、SVG、数据脚本）线上请求 HTTP 状态码均为 `200`，且 SHA-256 摘要与构建清单 `role-demo-manifest.json` 100% 一致。
   - `_headers` 文件由 Cloudflare 平台自动加载为响应头策略，不直接作为静态下载资源提供。
   - 详细校验清单记录于 `artifacts/role-demo-release-20261116.json`。

2. **直链与单页路由（SPA Fallback）验证**：
   - 首页：<https://demo.nanzhaoarts.com/> (HTTP 200)
   - BOSS 首页与总览：<https://demo.nanzhaoarts.com/?role=boss>、<https://demo.nanzhaoarts.com/?role=boss&page=dashboard> (HTTP 200)
   - 客服主管与账号管理：<https://demo.nanzhaoarts.com/?role=cs_supervisor>、<https://demo.nanzhaoarts.com/?role=cs_supervisor&page=csAccounts> (HTTP 200)
   - 库房工作台：<https://demo.nanzhaoarts.com/?role=warehouse> (HTTP 200)
   - 财务工作台：<https://demo.nanzhaoarts.com/?role=finance> (HTTP 200)
   - 运营工作台：<https://demo.nanzhaoarts.com/?role=ops> (HTTP 200)
   - 管理员后台：<https://demo.nanzhaoarts.com/?role=admin> (HTTP 200)
   - 移动端/客服填报直链：`/fill`、`/fill/fans`、`/fill/orders`、`/fill/after-sales`、`/fill/performance`、`/fill/attendance`、`/fill/editor` 均正常返回 HTTP 200 并加载最新前端应用包。

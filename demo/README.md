# 独立三端只读演示

用户授权只用独立虚构数据展示后台管理员、BOSS 和客服主管界面。本目录不用于正式身份验证或数据服务。

`readonly-api.js` 在仅供预览的静态站内提供虚构响应，复用当前前端编译产物。演示角色可以公开切换，所有数据均可公开；界面所示小组范围用于说明产品行为，不是面向真实数据的安全边界。正式后端仍由服务器认证与角色/小组校验，不能使用此演示脚本替换。

- 顶部切换后台管理员、BOSS、客服主管。
- BOSS 显示全局虚构汇总、日期/状态/微信筛选；月累计按最后快照展示。
- 主管只展示演示一组的视图和虚构记录。
- 管理员展示员工、小组、微信及配置界面，不显示业务数据。
- 操作保存被禁用或拒绝，没有数据库或持久写入。演示登录仅在本页运行，不认证正式账号。
- 如需查看登录页，退出演示后使用 demo_admin / demo_boss / demo_supervisor，公开演示密码统一为 Demo2026View。这些凭据不能用于正式系统。

构建：先构建正式前端，再执行 `node scripts/package-role-demo.cjs`。输出在忽略提交的 artifacts/role-demo-site，只包含编译后前端、独立演示脚本及静态头/路由文件；不包含 .env、数据库、生产凭据、后端依赖或源码映射。

单测：`node --test demo/readonly-api.test.cjs`，7 项（含工资单虚构接口）覆盖三视图、组内过滤、金额与月累计、写入拒绝、虚构 CSV 导出。预览检查已确认三角色切换、管理员保存按钮禁用、主管消费仅一组。

上传到 Cloudflare 静态 Worker 时将 `not_found_handling` 设为 `single-page-application`，保持 assets 根目录为 `/`，不再加入 `_redirects` 规则以免与 HTML canonicalization 冲突。生成 ZIP 时条目使用 `/` 路径分隔符。页面和静态响应包含 noindex 标记，但此标记不提供保密或访问控制。

主官网及旧 cms-fictional-readonly-demo 不作为本演示发布目标。最终成功发布服务名称 cuiguanjia-preview，子域名 https://demo.nanzhaoarts.com/。构建阶段曾尝试名称 cuiguanjia-role-demo，最终状态与验证见 docs/ROLE_DEMO_DEPLOYED.md。

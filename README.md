# 公司内部管理系统

运营、拍剪、客服各自登录填报，客服主管查看负责小组的加粉汇总，Boss / 行政查看全局经营估算与详情。界面为中文，适配手机和电脑。

本仓库是可运行的第一版，用于受控内网或限定 IP 内测。尚未购买或连接云服务器，也没有真实客户数据。

## 已实现

- 账号密码登录、角色权限、会话 Cookie、CSRF 与 Origin 校验、登录限速、密码哈希
- 不开放注册；管理员通过页面或 `npm run init-admin` 创建账号，无默认生产密码
- 客服加粉：同一 H5 入口；默认东八区业务日；员工+日期唯一；重报覆盖并留痕；`0` 与未报区分；默认近 3 个业务日可补报（服务端强制，可在后台设置）
- 成员小组归属按生效区间记录，调组不改写历史日报
- 客服主管只看授权小组的加粉总数、应报/已报/未报、逐人明细和导出；不能看工资、订单、消费和成本
- 运营日报（推广费、推广视频数）、拍剪日报（拍摄/成片/已发布/囤量快照）
- 客服订单：业务日、订单标识去重、金额与成本明细；不采集手机号等联系方式字段
- 岗位月基本工资按生效区间维护，按当月天数分摊，不需要每天录入
- Boss 日/周/月经营估算：收入 − 退款 − 推广费 − 工资分摊 − 定制成本 − 工费 − 运费（明确标注不是会计净利润）
- 后端强制数据范围，导出跟随同一权限
- 审计日志不记录密码

## 未实现 / 明确不做

- 未购买、未部署阿里云服务器；本仓库只提供 Docker Compose 与部署说明
- 未配置国内 OSS 加密备份，因此**不能声称已经具备加密备份**。`scripts/backup.sh` 仅做本地明文 `pg_dump`
- Cloudflare 境外备份默认禁用，代码中没有向境外同步的实现
- 不读取微信群消息，不自动往群里发链接；群公告需人工首次粘贴同一地址
- 不对接钉钉登录、支付平台或真实客户资料导入
- Boss 批注目前仅本人/行政可见完整列表，尚未做成「对应端口自动可见」的通知

## 本地启动

需要 Node.js 20+ 和 PostgreSQL 16+（推荐 Docker Compose）。

```bash
cp .env.example .env
# 编辑 .env：填写 DATABASE_URL、SESSION_SECRET、POSTGRES_PASSWORD
# 不要把填好的 .env 提交到 Git

docker compose up -d db
# 或使用已有 PostgreSQL，并把 DATABASE_URL 指过去（本项目示例端口 15432）

npm install
npm run migrate
npm run init-admin
# 交互输入管理员账号，或设置：
# INIT_ADMIN_USERNAME=... INIT_ADMIN_PASSWORD=... INIT_ADMIN_NAME=... npm run init-admin

# 开发：后端 http://127.0.0.1:13080 ，前端 http://127.0.0.1:15173
npm run dev
```

浏览器打开 [http://127.0.0.1:15173](http://127.0.0.1:15173)。前端开发服务器会把 `/api` 代理到后端。

生产式本地预览（前端打包后由后端一起提供）：

```bash
npm run build
SERVE_STATIC=true npm run dev:backend
# 然后访问 http://127.0.0.1:13080
```

演示数据默认不写入。若需要虚构账号，显式执行：

```bash
SEED_DEMO=1 npm run seed-demo
```

脚本把虚构账号写入 `SEED_DEMO_CREDENTIALS_FILE` 指定的本地文件（未设置时为 `data/demo-credentials.txt`），终端只显示用户名和角色，不打印密码。这些账号不是真实员工。


## Windows 本机内测包

`scripts/windows/` 提供不依赖 Docker、也不需要开发仓库 checkout 的本机安装脚本。`scripts/package-windows-release.sh` 在 Linux 打包机上构建前端 `dist`、编译后端 JS，并生成 zip（含 `package-lock.json`，不含 `node_modules`、`.git`、已填写的 `.env` 或任何真实口令）。

目标机器需要已安装的 Node.js 22 与本机 PostgreSQL。安装脚本在 Windows 上执行 `npm ci --omit=dev --ignore-scripts`，依赖均为纯 JavaScript（含 bcryptjs），无需编译原生模块。默认绑定 `127.0.0.1`。这不是生产安装，演示数据为虚构，备份不加密，也没有 Cloudflare 同步。

打包机上的测试结果不能当作已在 Windows 上验收。解压后请阅读包内 `安装说明.txt`。

## 测试

```bash
# 先有可用的 PostgreSQL，并导出 DATABASE_URL、SESSION_SECRET、APP_ORIGIN
npm test
```

集成测试覆盖：未登录不能创建账号、客服不能看汇总、主管不能跨组/不能看工资和订单、加粉 0 与未报、重报去重留痕、补报窗口、调组不改历史、金额校验、订单标识防重、退款不计收入、囤量不按快照求和、未改密不能填报。

## 权限摘要

| 角色 | 可写 | 可读 |
| --- | --- | --- |
| 运营 | 本人推广日报 | 本人推广数据 |
| 拍剪 | 本人拍摄/成片/囤量 | 本人拍剪数据 |
| 客服 | 本人加粉、本人订单 | 本人加粉和订单 |
| 客服主管 | 本人加粉；可在授权组内代为更正加粉并留痕 | 授权组加粉汇总，不能看工资/订单/成本 |
| Boss / 行政 | 编制、工资、设置；可查看并维护全局业务数据 | 全局汇总与详情 |

篡改 URL 中的 `userId` / `teamId` 会被后端拒绝。

## 安全注意

- 生产环境必须使用足够长的随机 `SESSION_SECRET`，并通过 HTTPS 将 `COOKIE_SECURE=true`
- 内测若只在 HTTP 上访问，不要录入真实客户或真实工资数据
- `TRUST_PROXY` 仅在前面确有反向代理时开启
- 登录有频率限制；首次由行政创建的账号会要求修改密码

## 备份说明

`scripts/backup.sh` 会按 `DATABASE_URL` 导出压缩 SQL。当前**没有**密钥管理、没有落加密盘、也没有自动上传阿里云 OSS。若以后要做国内加密备份，需要单独配置密钥与存储，并做恢复演练。

## 阿里云部署边界（尚未执行）

1. 在大陆地域准备 ECS / 轻量服务器，安全组先只开放办公出口或 VPN
2. 安装 Docker，复制本仓库，创建服务器上的 `.env`（不要提交）
3. `docker compose up -d --build`，用 `npm run init-admin` 或一次性环境变量创建管理员
4. 通过内网或限定 IP 做功能验证
5. ICP 备案完成后再绑定正式域名和证书，不要在未备案域名上对公网提供网站服务
6. Cloudflare 同步默认不要打开

## 技术栈

TypeScript + Express + PostgreSQL + React（Vite）。Docker Compose 将应用与数据库的宿主机端口绑在 `127.0.0.1`，避免误暴露。

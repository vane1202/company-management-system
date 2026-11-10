2026-11-10 最新更新：WhatsApp/Messenger客服接待账号、预录名单及登记码选择流程已部署，本地与虚构演示版本 fd47e43d 已核验。人设/主页仅为引流来源，客户按实际承接小组归属，小组固定对应直播间，具体名单等待主管。详见 [SERVICE_ACCOUNTS.md](SERVICE_ACCOUNTS.md)，下方旧固定微信方案及旧部署状态为历史记录。

2026-11-10 更新：客服微信号线索考核已部署本地与独立演示（版本 b0b9e0c0）。新增客户明细、同批当日/7日转化率、分类筛选及完整性核对；日报沟通为当日汇报，与新增客户转化分开。详见 [FAN_LEAD_CONVERSION.md](FAN_LEAD_CONVERSION.md)。以下旧版本记录保留。

# Windows 本地后台部署记录

## 当前更新：BOSS首页经营优先已部署（2026-11-10）

首页优先显示直播间业绩、直播间费用和运营成本；运营成本仅广告消耗，不含工资或充值实付。新增成交、追加收费、业务费用按各自发生日期统计；支持直播间/主播/人设/客服筛选及收支下钻。加粉、拍剪及填报进度置后。相关后端61、前端50、演示14项通过，本地于11月9日备份更新，11月10日复查96份安装文件摘要一致、双入口健康。域名演示版本 `b5402096` 已发布，5份公开资源摘要一致，手机首屏三项完整可见。本轮无数据库迁移、业务数据修改或Git推送。当前展示与日期口径见 [BOSS_BUSINESS_HOME.md](BOSS_BUSINESS_HOME.md)，下方旧首页描述是历史记录。

## 当前更新：拍剪分类及订单收支已部署（2026-11-09）

支持魏磊、尚杰、十七跨多个人设分类，历史归类不重复计数；新增广告预存/消耗台账、客户追加收费、公司成本应付和财务分次付款，订单补齐人设/直播间/主播/客户/客服关联字段。客户欠款与第三方结算、公司付款分别计算。已验证备份并执行008增量迁移，原有业务字段值保持，新表没有演示数据；本机和局域网服务正常。相关后端70项、前端48项、只读演示12项通过。演示版本 `f767a69a`，公开资源摘要一致。使用规则、日期口径、权限及证据见 [PRODUCTION_CASHFLOW.md](PRODUCTION_CASHFLOW.md)。下方旧状态均为历史记录；本轮未提交或推送Git。

## 当前更新：返回导航已部署（2026-11-09）

六个首页入口进入后均有返回，订单详情先返回列表再回首页；桌面增加可点击面包屑，手机使用固定返回栏。同次登录浏览保留已访问页面的筛选和搜索，支持浏览器前进后退与直接打开详情。前端46项、演示10项测试通过，生产构建及浏览器验收通过。本地前端已备份更新且健康正常，独立演示版本 `64937f02` 的5份公开资源摘要一致。仅更新前端，未修改数据库或权限，未提交或推送Git。详见 [WORKSPACE_NAVIGATION.md](WORKSPACE_NAVIGATION.md)。下方旧部署/交接状态均为历史记录。

部署日期：2026-11-08，Asia/Taipei。状态：**已部署，当前运行中**。

最新访问范围：本机 127.0.0.1:13080 继续可用，另允许同局域网通过 192.168.1.58:13080 访问，应用限制在 192.168.1.0/24；数据库仍仅本机，未向 VPN 网卡监听。详见 [LAN_ACCESS.md](LAN_ACCESS.md)。以下“尚未开放局域网”均为初次部署历史描述，已由本条覆盖。

三角色账号已更新：local_boss 保留为全局只读；local_admin 管理系统、不读写业务；local_supervisor 暂不分组。新账号初始凭据仅在 private/three-role-accounts.txt，首次登录须改密；权限、备份及验收见 [THREE_ROLE_ACCESS.md](THREE_ROLE_ACCESS.md)。以下首次部署时 Boss 能切换模块的描述已被新权限覆盖，现仅后台管理员可配置。

## 使用入口

- 地址：http://127.0.0.1:13080
- 登录名：local_boss
- 初始密码只在本机文件：C:/Users/Administrator/AppData/Local/Cuiguanjia/private/initial-administrator.txt
- 首次登录强制修改密码。修改完成后请删除初始登录文件，不要将它发送到聊天或提交到仓库。
- 角色为 Boss，登录后可在「模块管理」启停现有业务模块。
- 当前只允许本机访问，没有开放局域网、手机或公网；未更改防火墙。

## 实际安装位置

安装目录：C:/Users/Administrator/AppData/Local/Cuiguanjia

| 目录 | 用途 |
| --- | --- |
| app | 部署的编译后应用和锁定的生产依赖；独立于开发工作区 |
| runtime | 专用 Node 22.23.4 和 PostgreSQL 16.15，不修改全局 PATH |
| database/data | 正式本地数据库文件；不能当作测试库清空 |
| private | 数据库配置、随机口令、初始管理员信息；不要分享或提交 |
| backups | 数据库本地备份和恢复验证记录 |
| logs | PostgreSQL 日志及首次手动启动时的应用日志 |

安装根目录及子文件仅当前 Windows 用户、SYSTEM 和本机管理员可访问。
Node ZIP 与官方 SHA256 清单一致，node.exe 数字签名为 Valid，签名主体 OpenJS Foundation；没有替换宿主机已有 Node。
PostgreSQL 来源与未签名的限制详见 SECURITY_REVIEW.md。本轮未执行旧 Windows 脚本，不代表原火绒告警已被定性为误报。

业务数据库：127.0.0.1:16543/cuiguanjia_local，SCRAM 认证。应用使用独立非超级用户 cuiguanjia_app。已执行迁移 001/002/003/004，未装入演示数据。客服微信登记更新、备份与验收见 [CS_WECHAT_ACCOUNTS.md](CS_WECHAT_ACCOUNTS.md)。

## 自动启动和停止

Windows 任务计划程序中任务名：Cuiguanjia Local Backend。

- 当前用户登录时，依次直接启动 pg_ctl 和 Node 后端。
- 使用当前用户 S4U、有限权限，不保存 Windows 登录密码。
- 单实例，运行时间不限，异常退出后每分钟重试，最多三次。
- 已实际停止本轮应用和新数据库，再手动触发此任务验证恢复；健康接口返回 status=ok、db=ok，任务为 Running。
- 没有实际重启 Windows，因此“机器重启后的验证”仍未执行。需登录当前用户后才会触发。

启动（PowerShell，或在任务计划程序中点击「运行」）：

```powershell
Start-ScheduledTask -TaskName 'Cuiguanjia Local Backend'
```

停止（先在任务计划程序结束后台，再停止其专用数据库）：

```powershell
Stop-ScheduledTask -TaskName 'Cuiguanjia Local Backend'
& "$env:LOCALAPPDATA\Cuiguanjia\runtime\pgsql\bin\pg_ctl.exe" `
  -D "$env:LOCALAPPDATA\Cuiguanjia\database\data" -m fast -w stop
```

这些操作针对本轮创建的任务和数据目录，不使用旧 Stop-Cms.ps1 或未经核对的 PID 文件。
任务启动后的应用异常可通过任务运行状态和健康接口排查；首次手动启动的 stdout/stderr 文件不代表任务阶段持续日志。

## 备份和恢复

首次备份：backups/cuiguanjia-initial-2026-11-08T06-04-30-432Z.dump。

- 44265 bytes，SHA256 c4ad28bd06e14b866642c72e70e1c2cb1fae5b02c59ebcebe897cf4ce7d02166。
- 自定义格式 pg_dump，无 owner/privileges；本地备份未加密，依赖目录 ACL 保护，不是异地或加密备份。
- 已恢复到本轮随机创建的独立验证数据库，核实迁移记录 3、管理员 1、订单 0；验证库已删除，正式库未覆盖。
- 尚未配置自动周期备份。使用真实数据后需补充日常备份和异机保存。
- 数据库备份不包含 PostgreSQL 角色和 private/app.env；跨机器恢复还需另外维护相应运行配置。

## 验收结果与边界

- 浏览器真实打开登录页，页面可显示；已保留为用户可访问的标签页。
- 使用本轮生成的临时验收账号验证真实 API 登录、auth/me、模块管理、人员管理、经营汇总及退出。结束后移除验收账号，审计记录保留并清除其 actor 外键。
- 验收后正式库只有 local_boss 一个用户；客服、运营、拍剪、订单记录均为 0。
- 所有业务模块默认启用；用户实际首次改密和登录后页面操作尚待本人完成，未读取/导入初始管理员密码到浏览器。
- 后端/数据库实际监听仅 127.0.0.1:13080 和 127.0.0.1:16543。
- 未完成手机或局域网访问验收，未做云部署，未推送或合并。

开发工作区仍在 D:/Codex/翠管家/company-management-system。后续修改需要构建、验证、备份，再更新 app 下的部署副本；编辑工作区不会自动改动当前运行版本。

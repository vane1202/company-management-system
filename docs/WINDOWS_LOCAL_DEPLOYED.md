# Windows 本地后台部署记录

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

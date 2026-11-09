# Windows 本地部署前置状态

更新：用户决定暂不上报火绒继续开发；已审查现有启动链及依赖，修复发现的问题，并在官方 EDB PostgreSQL 临时实例上完成全部隔离库回归，实例已停止。厂商复核不再是继续开发的唯一条件。不能据此认定原告警误报，正式后台仍未部署。最新证据见 SECURITY_REVIEW.md；下文保留初次审查时的记录。

2026-11-08 用户确认：后台部署在当前 Windows 电脑；先提供模块开关，再逐步扩展页面、字段和流程。

目前功能代码已构建，后台**尚未安装运行**。本机 PATH 未发现 PostgreSQL、Docker、WSL 或 Podman；C:/Program Files/PostgreSQL 不存在。这不是全盘扫描结论，不排除其他位置的便携安装。

交接记载原 Start-Cms.ps1 曾被火绒以 HEUR:TrojanDownloader/PS.NetLoader.ae 删除，尚无厂商复核结论。本轮只读取原始源码并计算哈希，没有执行、修改或替换该启动链，没有关闭防护。

下列哈希属于本交接源码归档中的文件，不能证明与当时被拦截的旧 Windows 包文件相同；送检时应由安全厂商核对实际命中样本。

| 文件 | SHA256 |
| --- | --- |
| scripts/windows/Start-Cms.ps1 | 8F59C784298D8C4EAC025674CD59A522B2B247C916D3E36EC4F6F18B66FEF6E3 |
| scripts/windows/CmsCommon.ps1 | 6492053EEF05A79DDD78A7398FF189ED37366FD0FB17EF992DB8BEF2D3F45A1F |
| scripts/windows/Install-Cms.ps1 | E5D85A6D27DD165268580D7C301F2ECD21B183FD4C725877FA199063DEB48622 |

静态观察：Start-Cms.ps1 引入本地 CmsCommon.ps1、导入本地环境配置、启动 node 后端并请求回环健康检查；Install-Cms.ps1 调用 npm ci 安装生产依赖。这些观察不能代替安全厂商复核，不能据此判定告警为误报。

后续需先取得安全厂商复核结论，再确定当前电脑上的 PostgreSQL 安装、隔离库测试和目标环境验收安排。本轮没有发送任何外部送检消息，没有提供替代启动命令。

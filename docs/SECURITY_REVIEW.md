# 安全审查与数据库回归（2026-11-08，Asia/Taipei）

## 结论及限制

审查当前 Windows 脚本、Node 启动入口、运行配置、前后端源码中的网络/进程/动态执行调用和 npm 依赖后，未发现明显的恶意下载执行、窃密外传、计划任务持久化或关闭防护逻辑。

这是静态检查与已知依赖漏洞检查，**不是原告警文件的病毒鉴定**。未取得当时被删除文件的样本及哈希，不能确认它与当前 Start-Cms.ps1 相同，不能据此认定火绒误报。没有执行旧 Windows 安装/启动脚本，没有修改安全软件或添加排除项、替代启动器。

用户已选择暂不上报火绒继续开发；厂商复核不是代码维护和隔离测试的唯一条件。实际部署仍应使用检查过的代码与来源可核验的运行依赖，不能把换命令当作告警已解决。

## 检查内容

- 完整读取 Start-Cms、CmsCommon、Install-Cms、New-CmsEnv、Initialize-CmsAdmin、Initialize-CmsDemo、Stop-Cms 和原打包脚本；检查 Node 启动、迁移、数据库连接、管理员初始化、演示 seed。
- 前端 fetch 指向应用 API；后端按配置连接 PostgreSQL；健康检查访问本机；npm 安装访问包仓库。源码未发现第三方遥测或数据上传接口。
- 未打开真实 .env、历史数据库口令文件或历史演示凭据。
- 锁文件远程包均来自 https://registry.npmjs.org，均具 integrity 字段；这不能证明包内容不存在恶意代码。
- 安装禁用依赖生命周期脚本；已安装依赖中的 esbuild postinstall=node install.js 未执行，构建使用随包的平台二进制。

## 已修复

1. npm audit 最初报告 6 个受影响依赖条目（含传递依赖），涉及 high/critical；与火绒告警是否相关没有证据。
2. 升级 Vite 7.3.7、React 插件 4.7.0、前后端 Vitest 4.1.12；删除未使用的 Zod。更新锁文件后 audit 报告 0 项已知漏洞，npm ci --ignore-scripts 重装成功。
3. 管理员初始化原先直接使用 readline.question 读取密码，提示“不回显”但终端可能显示输入。新增隔离输出的密码提示函数，不回显、保留原字符、支持 Ctrl+C；两项测试通过。
4. Docker 构建使用 npm ci 并禁用安装脚本，基础镜像改为 Node 22，排除临时缓存、数据库目录和凭据文件。Docker 未在本机实际构建验收。
5. 项目声明 Node 22/24/26 兼容范围；正式部署使用所选 LTS 的最新安全补丁。当前测试运行时为已有 Node 22.14.0，未修改宿主机 Node 安装。

## PostgreSQL 来源及隔离

来源：[PostgreSQL 官方 Windows 下载页](https://www.postgresql.org/download/windows/) → [EDB 归档](https://www.enterprisedb.com/download-postgresql-binaries)。

实际下载：https://get.enterprisedb.com/postgresql/postgresql-16.15-5-windows-x64-binaries.zip

下载长度 373254386 bytes，SHA256 为 43BB45F173A6F08CF1D29A97A6D8DEB119E8E8093A24C00D2D1001A0CCAA8281。该哈希仅为本轮记录，没有上游独立校验值可比对。

postgres.exe、initdb.exe、pg_ctl.exe、psql.exe 的 Authenticode 状态均为 NotSigned，不能写成已通过数字签名验证。只提取 bin/lib/share，不运行 pgAdmin/StackBuilder，不注册服务，不改 PATH 或防火墙。

中文项目路径导致 PostgreSQL bootstrap 编码错误；改在用户临时目录 cms-pg-audit-20261108 初始化成功。工具副本及测试数据保留于该目录，原始下载位于项目 .tmp。

实例只监听 127.0.0.1:16542，SCRAM 认证，口令本轮随机生成且不输出。专用库：cms_daily_detail_test、cms_roleflow_test、cms_review_test、cms_daily_migration_test。未连接 cms_demo、15433 或旧业务库，测试顺序执行。

测试结束已经停止该实例并确认 16542 无监听。临时数据库不属于正式部署。

## 实测结果

| 验证 | 结果 |
| --- | --- |
| 前后端构建 | 通过 |
| 后端无需数据库的测试 | 40 通过 |
| 日报及模块 API 集成 | 4 通过 |
| 历史权限及财务集成 | 26 通过 |
| 助理审核集成 | 5 通过 |
| 001/002 → 003 历史数据迁移 | 1 通过 |
| 后端合计，分套件顺序执行 | 76 通过 |
| 前端 | 11 通过 |
| 新增测试 TypeScript 检查、git diff --check | 通过 |

迁移测试使用独立库中新随机 schema，结束仅清理该 schema。已证实旧加粉保留且不编造渠道、旧运营多平台行保留且不转美元、旧 published 不解释成发给运营、新唯一键支持多主页/人设、迁移不重复执行。

历史集成初次因缺少 SESSION_SECRET 在 beforeAll 失败（26 项未执行），补充仅用于测试的配置后完整通过；未将跳过结果算作通过。

## 尚未完成及部署前事项

- 未对原命中样本做杀毒扫描或厂商复核。当前环境未找到 Defender 命令行入口，不能声称已扫描或系统防护已开启。
- 旧 Stop-Cms.ps1 只按 PID 文件结束进程，未校验进程路径，PID 复用可能误停其他进程；未执行，采用前必须修正。
- scripts/windows 的根目录逻辑适配原包 scripts/ 扁平目录，不应直接作为源码目录安装流程使用。
- 正式业务数据库、业务管理员、备份恢复、应用入口及浏览器/手机验收尚未完成。
- 未启动正式应用，无可交付服务地址；未推送、合并或发布。

参考：[Node 发布状态](https://nodejs.org/en/about/previous-releases)、[Tinypool 上游公告](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr)。

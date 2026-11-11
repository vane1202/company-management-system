# 翠管家 · 公司内部管理系统

中文管理系统，使用 TypeScript、Express、PostgreSQL、React 和 Vite，适配电脑和手机。

## 当前功能（2026-11-11）

- 后台管理员管理账号、小组、授权、模块及系统设置，不接触业务数据；BOSS只读查看全局数据；主管查看、维护授权小组的数据与接待账号。
- BOSS首页优先展示直播间业绩、业务费用与广告消耗，其次展示加粉、拍剪数据；支持日期筛选、明细跳转及返回。
- 开单营业额按料价＋代购费统计，财务核定已付款业绩与售后收款分别统计；跑单回冲原日，售后业务可关联收款与成本计算毛利。客服日报填报进度仅在主管首页展示。参见[业务口径](docs/LIVE_TURNOVER_REQUIREMENTS.md)。
- 直播间长列表与逐笔收支进入“直播间经营”下级页面，成交和追加收费统一归入收入明细；参见[分层导航说明](docs/BOSS_BUSINESS_NAVIGATION.md)。
- 固定接待账号使用WhatsApp或Messenger，由管理员或主管预录。客服凭一次性登记码选择授权账号，设备保留登录；历史微信账号保留兼容。
- 客户线索明细支持承接量、首回复、明确需求及跟进统计，按接待账号、小组、引流来源等筛选。日报沟通情况与当日新客转化分别统计；月累计为汇报快照。
- 拍剪日报按拍剪师、人设及日期分类；库存取各拍剪师和人设末次快照，不按天累加。
- 订单支持多件商品、10%代购费、追加应收、分次付款及凭证。客户付款与第三方结汇分开，公司的扣费与汇差不改变客户欠款。
- 客户收费与公司成本分别登记，包含原石、加工、配货及发货支出；客服登记业务明细，财务登记实际付款。广告预存与广告消耗分开。
- 财务维护基本工资及工资项，BOSS查看工资汇总与明细。财务往期格式和提成、奖金、扣款规则仍待用户复核，暂不继续调整填报格式。
- 保存后直接进入汇总，不再经助理审核；保留后端权限、版本校验与审计。
- 整合远程UX P0的轻提示、局部错误反馈、加载占位与工资输入校验。

## 独立演示与部署范围

2026-11-11用户确认：最新经营总览与运营分析改版仅部署到独立演示站；本次同步GitHub，不更新Windows本地运行后台。

- 独立演示经营总览显示开单营业额、客户已收款、可见成本、毛利（估）/实际毛利及收款/广告消耗；缺少财务专项核算时实际毛利待核算，参考汇率不代替实际结汇。
- 独立演示运营分析支持日期、主页、平台、广告户筛选和分类排序；咨询成本按总消耗/总咨询量计算，余额按账户末次快照去重，原始日报折叠保留。
- 这两项界面仅在Vite的`demo`模式启用。标准`npm run build`仍构建原界面；正式后端、数据库迁移及本地安装副本未因本次改版更新。
- 公开演示继续使用虚构数据。用户提供的三个人设主页另存为[资料对照](docs/PERSONA_PAGE_DIRECTORY.md)，不进入演示包；广告账户及共用关系待补。

构建独立演示：`npm run build -w frontend -- --mode demo --outDir dist-demo`，然后执行`node scripts/package-role-demo.cjs --boss-p0`。只发布生成的`artifacts/role-demo-site`静态文件，不发布源码目录、真实数据或环境配置。GitHub同步不会自动部署本地后台。

## 维护文档

| 内容 | 文档 |
| --- | --- |
| 本次同步与验证 | [SOURCE_SYNC_20261111.md](docs/SOURCE_SYNC_20261111.md)；[上次记录](docs/SOURCE_SYNC_20261110.md) |
| 接待账号 | [SERVICE_ACCOUNTS.md](docs/SERVICE_ACCOUNTS.md) |
| 线索考核 | [FAN_LEAD_CONVERSION.md](docs/FAN_LEAD_CONVERSION.md) |
| BOSS首页 | [BOSS_BUSINESS_HOME.md](docs/BOSS_BUSINESS_HOME.md) |
| 独立演示经营总览 | [BOSS_OVERVIEW_P0_CONTRACT.md](docs/BOSS_OVERVIEW_P0_CONTRACT.md) |
| 独立演示运营分析 | [OPS_ANALYSIS_DEMO.md](docs/OPS_ANALYSIS_DEMO.md) |
| 人设与主页对照 | [PERSONA_PAGE_DIRECTORY.md](docs/PERSONA_PAGE_DIRECTORY.md) |
| 收费、成本与付款 | [PRODUCTION_CASHFLOW.md](docs/PRODUCTION_CASHFLOW.md) |
| 已确认基础资料 | [CONFIRMED_BUSINESS_DIRECTORY.md](docs/CONFIRMED_BUSINESS_DIRECTORY.md) |
| 非财务资料收集 | [REAL_DATA_COLLECTION.md](docs/REAL_DATA_COLLECTION.md)、[打印及填写模板](docs/templates/) |
| 本地部署历史 | [WINDOWS_LOCAL_DEPLOYED.md](docs/WINDOWS_LOCAL_DEPLOYED.md) |

人设/主页只记录引流来源，与直播间没有固定搭配；客户归属实际承接咨询的小组，小组与直播间有固定搭配。正式小组、账号名单待主管提供，不使用演示资料替代。

较早的微信登记、助理审核及部署文档属于历史记录；与当前说明不一致时，以最新业务文档及代码为准。文档中的本地artifacts证据及备份路径不随Git分发。

## 开发与升级

需要符合package.json engines的Node.js（本机已用22.23.4验证）及PostgreSQL。

1. 执行npm ci，复制.env.example为.env并填写独立配置和密钥；示例只有占位值。
2. 执行npm run preflight -- --env-file .env，确认配置后执行npm run migrate和npm run init-admin。
3. 开发时分别运行npm run dev:backend与npm run dev:frontend；Windows终端使用npm.cmd。
4. 前端默认http://127.0.0.1:15173，后端默认http://127.0.0.1:13080。
5. 生产构建执行npm run build；按部署环境设置SERVE_STATIC=true后，使用npm run start -w backend启动。

升级数据库前先备份再迁移；当前迁移为001–012。本次演示改版没有新增迁移。推送GitHub不会自动更新本机安装副本或公开演示。

## 验证与边界

- 前端测试：npm test -w frontend；演示测试：node --test demo/readonly-api.test.cjs；构建：npm run build。
- 后端集成测试会重建隔离测试库，必须使用测试文件允许的独立TEST_DATABASE_URL，不可指向业务库。服务账号测试还限制本机16542端口的cms_commerce_test。
- 无默认生产密码；凭据、业务数据库、客户凭证、备份和运行产物不提交Git。
- 公开演示仅使用虚构数据、拒绝写入，不连接真实后台。
- 尚未完成正式云部署、自动异机备份或全部手机真机验收；本地备份不等于加密异地备份。
- 历史Start-Cms.ps1曾触发安全软件告警；该脚本及scripts/windows/不纳入本次同步，未恢复执行。旧包文档不能作为安全复核结论。

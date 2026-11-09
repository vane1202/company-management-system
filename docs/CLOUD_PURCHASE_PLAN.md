# 阿里云采购与域名规划（2026-11-08）

> 后续状态更新：公开只读的虚构三端演示已发布到 https://demo.nanzhaoarts.com/（Cloudflare 静态 Worker），见 ROLE_DEMO_DEPLOYED.md。它不承接真实业务，与本机数据隔离。正式内管的国内云服务和 cms 子域名仍未上线；以下采购与正式部署规划保持为待执行方案。

## 已确认需求及当前状态

- 用户已有官网域名 nanzhaoarts.com，正在选择阿里云服务器；没有云端部署凭据，也没有执行购买或修改 DNS。
- 客服从不同网络使用两条统一链接；本人登录后填报和查看自己的数据。管理端展示自动加粉汇总与订单汇总。
- 本地已部署 /fill/fans、/fill/orders；管理员首页可复制，已明确标注回环链接不能供外地客服访问。
- 未来 NFC 作品页面以港澳台、东南亚、欧美客户为主；本轮只规划，不开发 NFC 系统。
- 当前官网的托管位置、DNS 和备案状态没有核实，不假设已有备案。

## 推荐起步采购

假设初期为数十名员工、以表单/订单录入和汇总查询为主；尚未做真实并发压测，容量不是承诺。

| 产品 | 起步配置 | 用途 |
| --- | --- | --- |
| 阿里云 ECS | 华南1深圳，通用算力型 u1，4 vCPU/8 GiB，ecs.u1-c1m2.xlarge；按所在地域实际库存选择 | 内部管理应用与起步 PostgreSQL |
| 操作系统 | Ubuntu 24.04 LTS，x86_64 | 运行现有 Linux/Docker 部署，不把 Windows 本机包当作云安装包 |
| 云盘 | 80 GiB ESSD 起步，监控容量后扩展 | 应用、数据库和有限日志，作品图片/视频不放此盘 |
| 公网带宽 | 5 Mbps 起步 | 填报及管理页面；公开媒体由 OSS/CDN 提供 |
| 数据备份 | 国内独立私有 OSS Bucket，数据库定期备份及磁盘快照 | 不与公开作品存储混用；恢复演练必须完成 |
| 作品素材 | 中国香港地域 OSS，标准存储，先按量付费 | 原始素材与公开发布素材分 Bucket 或严格隔离权限 |
| 公开分发 | 阿里云 CDN，区域选“全球（不包含中国内地）” | 港澳台和海外客户访问作品页、图片、视频 |

官网不迁移，仅新增用途明确的子域名；首次只需购买内管 ECS，作品 OSS/CDN 可在 NFC 开发阶段开通。无需因为未来要放视频而现在购买 GPU、高规格计算实例或 TB 级 ECS 磁盘。

此起步方案并非高可用：应用与数据库在同一台实例，实例故障可能暂停填报。如果不能接受停机，应另行选择托管高可用 PostgreSQL，不能把本地备份当成实时高可用。

## 域名建议（尚未配置）

- 官网：nanzhaoarts.com 与现有 www 保持现状。
- 内管：cms.nanzhaoarts.com。
- 客服加粉：https://cms.nanzhaoarts.com/fill/fans。
- 客服订单：https://cms.nanzhaoarts.com/fill/orders。
- 作品页：works.nanzhaoarts.com。
- 媒体：media.nanzhaoarts.com。

以上 HTTPS 链接仅为目标地址，服务器、解析和证书配置验收后才能使用。不得将目标地址冒充已上线入口。

内部管理数据库、工资和客户订单只在国内系统；香港公开站仅获得明确发布的作品介绍与媒体，不复制内管数据库。

## NFC 后续设计边界

每件作品一个长期固定 URL，例如 https://works.nanzhaoarts.com/p/公开作品编号。标签写入这个自有域名页面地址，不写 OSS 文件地址或短期签名 URL。后续更换视频或存储供应商时仍可保留标签地址。

初期作品页可按发布时生成静态页面/JSON，经香港 OSS 与 CDN 提供；不必先新增第二台 ECS。客户扫码页面不依赖每次跨境访问国内员工后台。若以后增加登录、所有权转移或私密鉴权，再评估香港动态服务。

原始素材默认私有，展示页只引用审核后发布的文件。NFC 链接本身不等同于防伪技术认证，本轮未实现标签或发布功能。

## 容量与费用

示例仅用于估算：1000 件作品，每件 10 张图片、每张 3 MB，加 2 条展示视频、每条 50 MB，发布素材约 130 GB。原始拍摄素材、历史版本、备份需另算。

存储容量与访问流量是两回事：单条 50 MB 视频完整播放 10000 次，约有 500 GB 下行数据。实际还受码率、是否完整播放、缓存命中等影响。开通费用告警，并根据实际账单再买匹配地域的资源包。

OSS 收存储、请求和相关流量费；经 CDN 时还分别产生 CDN 下行流量和 OSS 回源流量费用。不能认为买了服务器带宽或存储容量包就包含所有视频播放流量。

本轮没有验证用户账号的新购优惠、续费价或结算总价，不引用第三方活动价作为采购承诺。下单前核对地域、CPU 内存、磁盘、带宽、优惠资格和续费总价。

## 备案及上线前核对

国内服务器通过域名提供 Web 服务需按阿里云要求完成备案；若域名在其他服务商备案，通常还需办理阿里云接入备案。当前域名备案状态尚未核实。香港/海外 CDN 选择“全球（不包含中国内地）”时，按官方 CDN 文档不要求域名 ICP 备案；这不改变国内内管服务的要求。

国内服务器采购前确认公司主体、域名实名/备案状态、ECS 可备案资格。官方接入备案文档列出国内实例包月累计三个月及以上等条件，须以账号当时可备案实例要求为准。

云端正式入口启用 HTTPS、Secure Cookie、精确 APP_ORIGIN；数据库不开放公网。Windows 本地实例与未来云端实例不会自动同步，迁移时需指定唯一业务主库，避免员工在两个库分别填报。

## 官方核对来源

- [u1 实例规格，包含 4 vCPU/8 GiB](https://help.aliyun.com/zh/ecs/user-guide/general-work-force)
- [OSS 香港地域与 Endpoint](https://help.aliyun.com/zh/oss/user-guide/regions-and-endpoints)
- [CDN 加速区域及备案要求](https://help.aliyun.com/zh/cdn/user-guide/change-the-accelerated-region/)
- [OSS 静态网站托管](https://help.aliyun.com/zh/oss/user-guide/static-website-hosting/)
- [OSS/CDN 分别计费](https://help.aliyun.com/zh/cdn/product-overview/billing-of-oss-content-acceleration)
- [域名接入阿里云备案](https://help.aliyun.com/zh/ecs/user-guide/how-to-connect-a-registered-domain-name-to-alibaba-cloud)
- [阿里云价格计算器](https://www.aliyun.com/price/product)

# 阿里云采购与域名规划（2026-11-08）

> 后续状态更新：公开只读的虚构三端演示已发布到 https://demo.nanzhaoarts.com/（Cloudflare 静态 Worker），见 ROLE_DEMO_DEPLOYED.md。它不承接真实业务，与本机数据隔离。正式内管的国内云服务和 cms 子域名仍未上线；以下采购与正式部署规划保持为待执行方案。

## 已确认需求及当前状态

- 用户已有官网域名 nanzhaoarts.com，正在选择阿里云服务器；没有云端部署凭据，也没有执行购买或修改 DNS。
- 客服从不同网络使用两条统一链接；本人登录后填报和查看自己的数据。管理端展示自动加粉汇总与订单汇总。
- 本地已部署 /fill/fans、/fill/orders；管理员首页可复制，已明确标注回环链接不能供外地客服访问。
- 2026-11-14：NFC 标签目前只跳转到现有官网 nanzhaoarts.com。以后公开展示的图片、视频以上传第三方视频平台为主，不在阿里云 OSS 或这台 ECS 上存放和分发。每件作品独立页面、香港 OSS、海外 CDN 暂不采购、不开发。
- 客服订单里的商品快照和成本留底仍是内部业务资料，跟 NFC 公开展示分开，继续放在管理系统里。
- 当前官网的托管位置、DNS 和备案状态没有核实，不假设已有备案。

## 推荐起步采购

假设初期为数十名员工、以表单/订单录入和汇总查询为主；尚未做真实并发压测，容量不是承诺。

| 产品 | 起步配置 | 用途 |
| --- | --- | --- |
| 阿里云 ECS | 华南1深圳，通用算力型 u2i，ecs.u2i-c1m2.large，2 vCPU/4 GiB | 内部管理应用与 PostgreSQL |
| 操作系统 | Ubuntu 24.04 LTS，x86_64 | 运行现有 Linux/Docker 部署，不把 Windows 本机包当作云安装包 |
| 云盘 | 系统盘 40 GiB ESSD PL0，数据盘 40 GiB ESSD PL1 | 系统与 Docker；数据库、订单快照和有限日志。公开展示视频不放此盘 |
| 公网带宽 | 3 Mbps 固定带宽 | 员工填报和管理页面，不承担作品视频播放 |
| 数据备份 | 国内独立私有 OSS Bucket，数据库定期备份及磁盘快照 | 只备份内部管理系统，不存放对外展示视频 |

2026-11-14 购买页已改选入门配置、尚未下单：华南1（深圳），通用算力型 u2i，ecs.u2i-c1m2.large，2 vCPU/4 GiB，Ubuntu 24.04，系统盘 40 GiB ESSD PL0，数据盘 40 GiB ESSD PL1，固定带宽 3 Mbps，一年合计 2719.57 元。规格和价格以购买页为准。不再为 NFC 单独购买香港 OSS 或阿里云 CDN。官网不迁移。无需因为展示视频购买 GPU、高规格计算实例或 TB 级 ECS 磁盘。

此起步方案并非高可用：应用与数据库在同一台实例，实例故障可能暂停填报。如果不能接受停机，应另行选择托管高可用 PostgreSQL，不能把本地备份当成实时高可用。

## 域名建议（尚未配置）

- 官网：nanzhaoarts.com 与现有 www 保持现状。
- 内管：cms.nanzhaoarts.com。
- 客服加粉：https://cms.nanzhaoarts.com/fill/fans。
- 客服订单：https://cms.nanzhaoarts.com/fill/orders。

以上 HTTPS 链接仅为目标地址，服务器、解析和证书配置验收后才能使用。不得将目标地址冒充已上线入口。

内部管理数据库、工资和客户订单只在国内系统。公开展示不从这台服务器向外复制。

## NFC 与展示素材（2026-11-14）

NFC 标签目前只写入现有官网地址 nanzhaoarts.com，不写入单件作品页，也不写入文件地址。标签本身不是防伪认证。

以后对外的图片和视频以上传第三方视频平台为主。播放流量和存储由该平台承担，官网需要展示时嵌入平台播放页或链接。管理系统不保存这些展示文件，也不为此开通香港 OSS 或阿里云 CDN。

若以后改成每件作品一个固定页面，再单独决定页面放在现有官网还是新地址。在那之前不采购作品存储。

## 容量与费用

这台 ECS 的 40 GiB 数据盘只服务内部系统：数据库、订单商品快照、成本留底和日志。快照变多后再扩容。展示视频变多时，不因此加大这台机器的磁盘或带宽。

数据库备份若使用国内 OSS，只按备份体积计费，与第三方平台上的展示视频无关。

2026-11-14 购买页一年合计为 2719.57 元，含当时的年付折扣和 100 元优惠券。下单前再看一次购买页合计。

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

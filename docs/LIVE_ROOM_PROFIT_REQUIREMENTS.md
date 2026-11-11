# 直播间毛利口径与数据字段（演示先行）

2026-11-11 用户确认的直播间经营口径。本阶段只在演示构建（`demo` mode）实现列表展示，**不修改正式后端，不新增迁移，不部署**。经营总览「毛利（估）」不扣本页这些项；「实际毛利」仍待财务专项核算。

## 口径

| 指标 | 定义 | 来源 |
| --- | --- | --- |
| 收入 / 营业额 | 开单卡成交价＋10% 代购费；按开单日；追加收费排除；跑单回冲原开单日 | 已有开单营业额口径，不变 |
| 料子本钱 | 开单时登记的翡翠料子本钱 | 复用已有字段，见下表，不新编金额 |
| 主播提成 | 财务录入的金额，不是按成交额比例估算 | **正式库尚无按直播间/日的表** |
| 主播助理提成 | 财务录入的金额；明确录入 0 视为已录入 | **正式库尚无按直播间/日的表** |
| 货主演员费用 | 按次（场次）登记的金额 | **正式库尚无场次费用表** |
| 直播间毛利 | 营业额－料子本钱－主播提成－助理提成－货主演员费用 | 提成未录入时显示「待核算」，不作估算 |
| 底薪 | 走工资单，**不计入**本页人员费用或直播间毛利 | 已有 `salaries` / `payroll_months` |

主播或助理提成在所选区间尚未录入时，对应项显示「待财务录入」，直播间毛利显示「待核算」。货主演员无场次记录时按 0 汇总，不阻塞核算。

本页「直播间毛利」与经营总览「毛利（估）」（客户已收款参考折算－可见成本，未扣料本、提成、代收手续费）相互独立，不得互相改写。

## 已有字段（可复用）

| 用途 | 现有位置 | 说明 |
| --- | --- | --- |
| 营业额 | `order_items.price_cny + buying_fee_cny`（历史简版单用 `orders.amount`），按 `orders.business_date` | 已由 `summarizeLiveBusiness` 计算为 `performanceCny` |
| 料子本钱（明细单） | `order_expenses.category IN ('goods','sourcing')` 的 `amount_cny`，按费用发生日 | 页面类别为「原石 / 商品供货款」「市场配货采购款」。演示今日 LIVE-01＝900＋150＋250＝1300.00，与经营总览「账内已登记料成本」同一批记录 |
| 料子本钱（历史简版单） | `orders.custom_product_cost`，按开单日 | **不要**把 `legacy_cost`（商品成本＋工费＋运费）整包当作料本 |
| 费用下钻（保留） | 全部 `order_expenses`（含设计、运费等） | 「查看收入 / 费用」仍展示原费用明细；本页列表的「料子本钱」只取上述料本，不再用整包「费用」列代替 |
| 月度工资提成 | `payroll_items.kind='commission'`，按员工、自然月 | 财务手填，**不能**当作直播间主播/助理提成（粒度与对象都不同） |
| 已付款业绩 | `live_paid_performance` | 财务按开单日、直播间、主播核定的业绩参考，**系统不据此计算提成** |
| 底薪 | `salaries`、`payroll_months` | 不计入直播间毛利 |

开单卡当前没有单独的「料子本钱」录入项；现代明细单的料本是事后在费用里登记的供货款/配货款。演示复用这些已有金额，不新造料本数字。

## 缺失字段（本阶段不建表）

正式库截至迁移 `012` **没有**：

- 按统计日、直播间区分的主播提成、主播助理提成（可录入 0，与未录入不同）
- 货主演员按次（场次）费用
- 将工资单提成拆到直播间或场次的关联

因此生产接口与生产构建仍显示原列表（营业额 / 费用 / 有效开单），不假装已能核算直播间毛利。

## 建议迁移 013 草稿（未落地）

以下仅为后续正式实现的字段提案，**本仓库不新增 `backend/migrations/013_*.sql`，也未对隔离库或生产库执行任何迁移**。粒度（按日还是按所选区间一条）仍待财务确认。

```sql
-- 013_live_room_staff_costs.sql（提案，未创建、未执行）
-- 财务按统计日、直播间录入主播/助理提成。系统不按营业额比例计算。
-- 明确录入 0 为有效；无有效行视为未录入。

CREATE TABLE live_room_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date DATE NOT NULL,
  live_room_code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('host_commission','assistant_commission')),
  amount_cny NUMERIC(14,2) NOT NULL CHECK (amount_cny >= 0),
  host_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  request_key UUID NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX live_room_commissions_active
  ON live_room_commissions(business_date, live_room_code, kind)
  WHERE voided_at IS NULL;
CREATE INDEX live_room_commissions_room
  ON live_room_commissions(live_room_code, business_date);

-- 货主演员费用按场次录入。

CREATE TABLE live_room_actor_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date DATE NOT NULL,
  live_room_code TEXT NOT NULL,
  session_label TEXT NOT NULL DEFAULT '',
  amount_cny NUMERIC(14,2) NOT NULL CHECK (amount_cny >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  request_key UUID NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL
);
CREATE INDEX live_room_actor_fees_room
  ON live_room_actor_fees(live_room_code, session_date)
  WHERE voided_at IS NULL;
```

权限建议与已付款业绩一致：仅财务写入，BOSS 只读；支持幂等提交、作废重录与审计。不把工资底薪写入这两张表。

## 演示数据（全部虚构）

默认今日：

| 直播间 | 营业额 | 料子本钱 | 主播提成 | 助理提成 | 货主演员 | 直播间毛利 |
| --- | --- | --- | --- | --- | --- | --- |
| DEMO-LIVE-01 | 1770.50 | 1300.00（已有供货/配货款） | 120.00 已录入 | 40.00 已录入 | 80.00（上午场次） | 230.50 |
| DEMO-LIVE-02 | 0.00（开单在昨日） | 0.00 | 待财务录入 | 待财务录入 | 60.00（晚场） | 待核算 |
| 未归属直播间 | 0.00（退款标记源单已排除） | 0.00 | 待财务录入 | 待财务录入 | 0.00 | 待核算 |

本周/本月视图按所选区间汇总已落入区间的录入行；区间内缺主播或助理提成则整段待核算。演示未补齐历史各日提成。

## 待确认问题

1. 提成覆盖粒度：按每个统计日都必须有记录（与「实际毛利」一致），还是所选区间有一条即可？
2. 跑单/历史退款标记源单已发生的料本是否仍计入该直播间？演示按与营业额一致排除。
3. 「未归属直播间」是否也必须录入提成才核算毛利？演示与有编码直播间同一规则。
4. 料子本钱的归属日：费用发生日，还是开单日？演示中明细单按费用发生日，历史简版单按开单日。
5. 货主演员「当日无场次」是否需要财务明确录入 0，还是默认 0？演示默认 0。
6. 开单卡是否应新增独立的「料子本钱」录入项，而不只依赖事后供货款费用？
7. 主播薪酬（底薪）是否计入原直播间费用仍待确认；与本页「提成计入、底薪不计入」是不同问题。

## 实现范围

- 演示：`demo/readonly-api.js` 为 `/api/dashboard/live-business` 增加可选 `rooms[].profit` 与 `profitMethod`；前端在 `demo` 模式下列表改为营业额、料子本钱、可展开人员费用、直播间毛利；保留查看收入/费用、排序、客户收款与公司到账折叠、未归属直播间。
- 正式后端、迁移、生产构建的列表布局不因本项改变。

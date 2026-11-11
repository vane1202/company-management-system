# 直播间毛利口径与数据字段（演示先行）

2026-11-11 用户确认的直播间经营口径。本阶段只在演示构建（`demo` mode）实现列表展示，**不修改正式后端，不新增迁移，不部署**。经营总览「毛利（估）」不扣本页这些项；「实际毛利」仍待财务专项核算。

## 口径

| 指标 | 定义 | 来源 |
| --- | --- | --- |
| 收入 / 营业额 | 开单卡成交价＋10% 代购费；按开单日；追加收费排除；跑单回冲原开单日 | 已有开单营业额口径，不变 |
| 料子本钱 | 优先开单卡「料子本钱」；仅当该单没有此字段时回退供货款/配货款。跑单订单的料子本钱不计入成本。币种固定人民币（¥ / CNY），开单时照原石标签录入 | 演示已有开单卡字段；正式库待迁移 013 的 `orders.material_cost_cny`。主播、客服、主管均可查看，不做按角色隐藏 |
| 料号 | 开单卡可选文本，填写原石标签上的编号（如演示编号 D367-32），可空 | 演示已有；正式库待迁移 013 的 `orders.material_lot_no` |
| 服务费（代购费） | 开单卡「服务费」即 10% 代购费。原石默认按谈成价的 10% 自动计算（四舍五入到分）；可手动修改。手动改过后再改谈成价不会覆盖已填值，可用「恢复按 10% 计算」。成品不加服务费 | 演示开单卡可编辑；生产表单仍只读自动计算，因现有 `order_items` CHECK 要求代购费必须等于 10%。若正式落库允许手工覆盖，013 草案需同时放松该约束（见下，仍不创建迁移文件） |
| 主播提成 | 财务录入的金额，不是按成交额比例估算 | **正式库尚无按直播间/日的表** |
| 主播助理提成 | 财务录入的金额；明确录入 0 视为已录入 | **正式库尚无按直播间/日的表** |
| 货主演员费用 | 按次（场次）登记的金额 | **正式库尚无场次费用表** |
| 直播间毛利 | 营业额－料子本钱－主播提成－助理提成－货主演员费用 | 提成未录入时显示「待核算」，不作估算 |
| 底薪 | 走工资单，**不计入**本页人员费用或直播间毛利 | 已有 `salaries` / `payroll_months` |

主播或助理提成在所选区间尚未录入时，对应项显示「待财务录入」，直播间毛利显示「待核算」。货主演员当日无场次时默认为 0，不显示待录入，不阻塞核算。跑单订单的营业额与料子本钱均不计入。

本页「直播间毛利」与经营总览「毛利（估）」（客户已收款参考折算－可见成本，未扣料本、提成、代收手续费）相互独立，不得互相改写。

## 已有字段（可复用）

| 用途 | 现有位置 | 说明 |
| --- | --- | --- |
| 营业额 | `order_items.price_cny + buying_fee_cny`（历史简版单用 `orders.amount`），按 `orders.business_date` | 已由 `summarizeLiveBusiness` 计算为 `performanceCny` |
| 料子本钱（开单卡，优先） | 演示字段 `orders.material_cost_cny`（正式库尚未建列，见迁移 013 草稿） | 按开单日。币种固定人民币（CNY），不开第二币种列。NULL＝未在开单卡登记；0＝已登记为零。跑单订单即使已填也不计入。主播、客服、主管均可查看 |
| 料号（开单卡，可选） | 演示字段 `orders.material_lot_no`（正式库尚未建列，见迁移 013 草稿） | 原石标签编号，text，可空。与件次「料子编号」`order_items.material_ref` 不是同一字段。演示示例必须虚构 |
| 服务费（代购费） | 已有 `order_items.buying_fee_cny` | 即开单卡「服务费」。默认 `round(price_cny*0.1, 2)`；演示允许手工覆盖并锁定，提供「恢复按 10% 计算」。生产 CHECK 仍强制 10%，故生产表单暂不开放编辑 |
| 料子本钱（回退） | 仅当该单**没有**开单卡料子本钱字段时，取 `order_expenses.category IN ('goods','sourcing')`，按费用发生日 | 不得与开单卡字段加总以免重复。演示今日 LIVE-01＝开单卡 900.00（DEMO-A-001）＋回退供货/配货 400.00（DEMO-A-002）＝1300.00 |
| 历史 `custom_product_cost` / `legacy_cost` | 旧商品成本或「商品成本＋工费＋运费」整包 | **不再**作为直播间料子本钱的回退来源 |
| 费用下钻（保留） | 全部 `order_expenses`（含设计、运费等） | 「查看收入 / 费用」仍展示原费用明细；本页列表的「料子本钱」只取上述料本，不再用整包「费用」列代替 |
| 月度工资提成 | `payroll_items.kind='commission'`，按员工、自然月 | 财务手填，**不能**当作直播间主播/助理提成（粒度与对象都不同） |
| 已付款业绩 | `live_paid_performance` | 财务按开单日、直播间、主播核定的业绩参考，**系统不据此计算提成** |
| 底薪 | `salaries`、`payroll_months` | 不计入直播间毛利 |

演示开单卡已增加「料子本钱 · 人民币（¥）」与旁边的可选「料号」录入/展示，并在订单列表、开单卡明细中同步展示（只读演示，修改不保存）。正式后端尚未建列，生产表单不展示这两项。直播间毛利优先用开单卡本钱字段，缺省才回退供货款/配货款。本钱与料号对主播、客服、主管均可见，不做按角色隐藏。

## 缺失字段（本阶段不建表）

正式库截至迁移 `012` **没有**：

- 开单卡 `orders.material_cost_cny`（料子本钱，币种固定 CNY）列
- 开单卡 `orders.material_lot_no`（料号，text，可空）列
- 若正式环境允许手工改服务费，还需放松 `order_items.buying_fee_cny` 必须等于 10% 的 CHECK
- 按统计日、直播间区分的主播提成、主播助理提成（可录入 0，与未录入不同）
- 货主演员按次（场次）费用
- 将工资单提成拆到直播间或场次的关联

因此生产接口与生产构建仍显示原列表（营业额 / 费用 / 有效开单），不假装已能核算直播间毛利。

## 建议迁移 013 草稿（未落地）

以下仅为后续正式实现的字段提案，**本仓库不新增 `backend/migrations/013_*.sql`，也未对隔离库或生产库执行任何迁移**。粒度（按日还是按所选区间一条）仍待财务确认。

```sql
-- 013_live_room_staff_costs.sql（提案，未创建、未执行）

-- 开单卡料子本钱。币种固定为人民币（CNY），不开第二币种列。
-- NULL=未在开单卡登记（直播间毛利可回退该单 goods/sourcing）；
-- 0=已登记为零。跑单订单的料子本钱不计入直播间毛利成本。
-- 主播、客服、主管均可查看本钱与料号，不做按角色隐藏。
ALTER TABLE orders
  ADD COLUMN material_cost_cny NUMERIC(14,2)
  CHECK (material_cost_cny IS NULL OR material_cost_cny >= 0),
  ADD COLUMN material_lot_no TEXT;

-- 开单卡「服务费」即 10% 代购费（order_items.buying_fee_cny）。
-- 默认按谈成价 10% 四舍五入到分自动计算，允许手工修改。
-- 手工改过后再改谈成价不得覆盖已填服务费；界面提供「恢复按 10% 计算」。
-- 现有 CHECK（006）要求 buying_fee_cny 必须等于 material 的 10% 或成品的 0。
-- 若正式落库要保存手工服务费，需将约束改为允许 material 的 buying_fee_cny >= 0
--（成品仍为 0），并在应用层保留默认 10% 与恢复入口。在约束未改前，
-- 仅演示构建开放服务费编辑，生产表单仍只读自动计算。
-- ALTER TABLE order_items DROP CONSTRAINT <既有 buying_fee 约束名>;
-- ALTER TABLE order_items ADD CHECK (
--   buying_fee_cny >= 0 AND (kind <> 'finished' OR buying_fee_cny = 0)
-- );

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
| DEMO-LIVE-01 | 1770.50 | 1300.00（开单卡 900.00＋回退供货款 400.00） | 120.00 已录入 | 40.00 已录入 | 80.00（上午场次） | 230.50 |
| DEMO-LIVE-02 | 0.00（开单在昨日） | 0.00 | 待财务录入 | 待财务录入 | 60.00（晚场） | 待核算 |
| 未归属直播间 | 0.00（退款标记源单已排除） | 0.00 | 待财务录入 | 待财务录入 | 0.00 | 待核算 |

另：昨日跑单单 DEMO-A-003 开单卡料子本钱 200.00、虚构料号 D218-07，按规则不计入 LIVE-01 成本。DEMO-A-001 开单卡料子本钱 900.00，虚构料号 D367-32。本周/本月视图按所选区间汇总已落入区间的录入行；区间内缺主播或助理提成则整段待核算。演示未补齐历史各日提成。料号示例全部虚构，不是真实库存编号。

## 待确认问题

1. 提成覆盖粒度：按每个统计日都必须有记录（与「实际毛利」一致），还是所选区间有一条即可？
2. **已确认**：跑单订单的料子本钱不计入成本（与营业额排除一致）。历史退款标记源单同样排除。
3. 「未归属直播间」是否也必须录入提成才核算毛利？演示与有编码直播间同一规则。
4. **部分确认**：开单卡料子本钱按开单日；仅回退的供货款/配货款按费用发生日。
5. **已确认**：货主演员当日无场次时默认为 0，不显示待录入。
6. **已确认**：开单卡增设独立「料子本钱」字段；直播间毛利优先用该字段，缺省才回退供货款/配货款。正式列待迁移 013，本阶段不建表、不跑迁移。
7. 主播薪酬（底薪）是否计入原直播间费用仍待确认；与本页「提成计入、底薪不计入」是不同问题。
8. **已确认**：原石标签上的料子本钱一律是人民币，开单时照标签录入；标签上的「料号」（如 367-32，演示用虚构编号）作为开单卡可选文本，写在本钱旁边。
9. **已确认**：料子本钱主播、客服、主管都能看到，不做按角色隐藏。
10. **已确认**：开单卡「服务费」就是 10% 代购费。默认按谈成价 10% 自动计算（四舍五入到分），允许手动修改。手动改过以后再改谈成价，不得覆盖已填的服务费；提供「恢复按 10% 计算」以解除锁定并按当前谈成价重算。

## 实现范围

- 演示：`demo/readonly-api.js` 为 `/api/dashboard/live-business` 增加可选 `rooms[].profit` 与 `profitMethod`；开单卡在演示模式展示并（客服填报表单中）可编辑「料子本钱 · 人民币（¥）」与可选「料号」，订单列表与开单卡明细同步展示，修改仍不保存。直播间列表优先用该字段，缺省回退供货款/配货款，并标注来源。演示开单卡服务费默认为 10% 代购费且可手工改，改价不覆盖手工值，可「恢复按 10% 计算」。
- 正式后端、迁移、生产构建的列表布局不因本项改变。生产开单卡不展示料子本钱/料号，服务费仍只读按 10% 自动计算（受现有 CHECK 限制）。

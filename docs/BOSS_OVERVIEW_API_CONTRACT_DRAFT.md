# BOSS「经营总览」指标 API 契约草案（P0 首屏结论条）

> **这是草案，不是已生效契约。**
>
> - 本文件由 Grok Bot 根据《「经营总览」整改任务书》与 2026-11-11 已确认口径起草，供 **Codex 确认后定稿**。
> - **契约所有权在 Codex。** 在 Codex 确认前，前端按本草案对接演示数据；Codex 定稿后若字段有调整，前端再跟随，双方不得各自改契约。需修改时必须在任务记录中说明原因。
> - 本草案 **不包含** 指标计算的后端实现。真实库表、折算、对账与单元测试由 Codex 负责。
> - 金额计算、汇率折算、净贡献与 ROI 一律由后端（或本仓库中的演示只读 API 作为占位）给出；前端只展示，不得自行估算、不得用 5.2 一类经验值、不得用预估净贡献代替最终净贡献。

`contract_version`：`0.1-draft`

建议接口：`GET /api/dashboard/boss-overview`

权限：仅 BOSS 只读。其他角色返回 403。正式后端尚未实现本接口时，应继续返回现有的 `{ "error": "接口不存在" }`（HTTP 404）；前端将此视为「数据待接入」，不得把 404 当作经营失败。

查询参数：

| 参数 | 说明 |
|---|---|
| `preset` | `day` / `week` / `month`。与现有经营总览分段一致。 |
| `from`, `to` | 可选，ISO 日期 `YYYY-MM-DD`。同时提供时表示自定义区间，忽略 preset 的默认起止（preset 仍可用于判断是否展示「vs 月目标」：仅 `preset=month` 且未自定义区间时展示）。 |
| 筛选 | P0 首屏结论条为全公司口径，不随直播间筛选缩小。广告消耗同样保持全公司、按所选日期范围。直播间筛选仍只作用于下方现有明细。 |

非法日期或 `from > to` 时返回 400，文案与现有经营接口一致（如「日期范围无效」）。

---

## 1. 通用结构

### 1.1 原币种 + 人民币合计（所有金额字段共用）

```json
{
  "original": [
    { "currency": "CNY", "amount": "1290.50" },
    { "currency": "TWD", "amount": "1200.00" },
    { "currency": "USD", "amount": "140.00" }
  ],
  "cny_total": "2560.50",
  "fx": [
    { "currency": "USD", "quote_currency": "CNY", "rate": "7.100000", "effective_on": "2026-11-01", "source": "config" },
    { "currency": "TWD", "quote_currency": "CNY", "rate": "0.230000", "effective_on": "2026-11-01", "source": "config" }
  ],
  "status": "ok"
}
```

约定：

- `original`：该指标涉及的原币种金额，币种按 `CNY`、`TWD`、`USD` 顺序。金额为字符串，精确到分，可带负号。没有该币种时不要补 `0.00`。
- `cny_total`：按汇率配置表折算后的人民币合计。缺任一所需汇率时必须为 `null`，并 `status: "missing_fx"`，同时在响应级 `fx.prompt` 给出可见提示。**禁止**用估算汇率填这个字段。
- `fx`：本字段实际用到的汇率及生效日，供页面展示。人民币本身可不列或列为 `1.000000`。
- 汇率来自带生效日期的配置表（`fx_rates`），取「不晚于区间结束日（或业务约定的折算日）的最近一条」。具体取数日规则由 Codex 定稿时写明。
- `status`：`ok` | `missing_fx` | `caliber_pending` | `pending_finance` | `not_available`。

### 1.2 对比字段

每个金额指标、比率指标带：

```json
{
  "vs_yesterday": {
    "amount_cny": "370.50",
    "ratio": "0.2646",
    "baseline_cny": "1400.00",
    "period": { "from": "2026-11-10", "to": "2026-11-10" },
    "unavailable_reason": null
  },
  "vs_same_weekday_last_week": {
    "amount_cny": null,
    "ratio": null,
    "baseline_cny": null,
    "period": { "from": "2026-11-04", "to": "2026-11-04" },
    "unavailable_reason": "no_baseline"
  },
  "vs_month_target": null
}
```

- `ratio` 为小数（`0.2646` 表示 +26.46%），不是百分数字符串。基线为 0 且当期不为 0 时，`ratio` 为 `null`，但 `amount_cny` 仍应给出；`unavailable_reason` 可用 `zero_baseline`。
- `vs_month_target`：仅月视图（`preset=month` 且非自定义区间）出现；未配置月目标时整个字段为 `null`，前端 **隐藏**「vs 目标」，不要显示 0 或「—」。
- `unavailable_reason`：`null` | `missing_fx` | `no_baseline` | `no_target` | `zero_baseline`。

**对比窗口（草案假设，请 Codex 与业务确认）**：

| 对比 | 日视图 | 周 / 月 / 自定义区间（草案） |
|---|---|---|
| vs 昨日 | 上一自然日 | 等长的前一区间（紧挨当前 `from` 之前）。响应里带 `period`。 |
| vs 上周同期 | 七天前同一日 | 起止均前移 7 天的等长区间。响应里带 `period`。 |
| vs 月目标 | 不展示 | 仅月视图；目标缺失则隐藏 |

周、月视图下「vs 昨日」是否应改为「截至昨日的本区间累计」，尚未确认，故标为待确认，不写死在前端。

### 1.3 数据源更新时间

响应根级 `updated_at`，ISO 8601，带时区（建议 `+08:00` / `Asia/Shanghai`）。没有该源的更新时间时用 `null`，页面写「更新时间待接入」，不要编造。

建议键：`customer_payments`、`paid_performance`、`live_expenses`、`ads`、`finance_costing`、`fx_rates`。

---

## 2. P0 响应形状

```json
{
  "contract_version": "0.1-draft",
  "disclaimer": "……虚构 / 正式环境说明……",
  "period": { "from": "2026-11-11", "to": "2026-11-11", "preset": "day", "label": "今日" },
  "fx": {
    "status": "ok",
    "missing_currencies": [],
    "rates_used": [ { "currency": "USD", "quote_currency": "CNY", "rate": "7.100000", "effective_on": "2026-11-01", "source": "config" } ],
    "prompt": null
  },
  "updated_at": {
    "customer_payments": "2026-11-11T06:00:00+08:00",
    "paid_performance": "2026-11-11T04:00:00+08:00",
    "live_expenses": "2026-11-11T03:00:00+08:00",
    "ads": "2026-11-11T11:20:00+08:00",
    "finance_costing": null,
    "fx_rates": "2026-11-01T00:00:00+08:00"
  },
  "flags": {
    "pending_finance": true,
    "caliber_pending": [],
    "missing_month_target": true,
    "live_entry_pending": true
  },
  "turnover": { },
  "collections": { },
  "visible_cost": { },
  "net_contribution": { },
  "roi": { }
}
```

`label` 建议：`今日` / `本周` / `本月` / `自定义区间`。

`flags.caliber_pending`：仍待业务确认、因而页面需标「口径待定」的键。不要为了画面完整而删掉这些标记。

### 2.1 营业额 `turnover`

开单口径，与现有 BOSS / 主管首页及 `live-business` 的 `performanceCny` 一致：

- 只计开单卡的料价 + 代购费，按开单卡日期归属。
- 跑单从 **原开单日** 营业额中扣回，原始记录保留。
- 设计、雕刻等追加收费按发生日单列，**不计入** 营业额。
- 客户延后付款不影响原日营业额；收款不重复计入营业额。
- 现有系统中该指标以人民币记账，`original` 通常只有 `CNY`。若后续出现原币种开单，再按第 1.1 节展开。

形状：第 1.1 节金额结构 + `comparison`（第 1.2 节）。可附加只读说明字段，例如 `new_order_count`、`cancelled_sales_cny`（与明细页对账，不作为另一套营业额）。

### 2.2 已收款 `collections`

按 2026-11-11 决定：**两个来源都展示，并标出差额**。不要合并成一个「已收款」瞒过差异。

```json
{
  "customer_payments": { "original": [], "cny_total": "2560.50", "fx": [], "status": "ok", "comparison": {} },
  "finance_paid_performance": { "original": [{ "currency": "CNY", "amount": "1290.50" }], "cny_total": "1290.50", "fx": [], "status": "ok", "comparison": {} },
  "difference": {
    "original": [],
    "cny_total": "1270.00",
    "fx": [],
    "status": "ok",
    "direction": "customer_payments_higher",
    "formula": "customer_payments.cny_total - finance_paid_performance.cny_total"
  }
}
```

- `customer_payments`：客服登记的客户收款流水（现有 `customer_payments` / 经营明细里的「客户实际付款」）。按 **付款日** 落入所选区间，保留原币种再折算。
- `finance_paid_performance`：财务核定「已付款业绩」（migration 012，按日 / 直播间 / 主播一条）。现有字段为人民币 `amount_cny`。尚未录入时 `cny_total` 为 `null` 或 0 需由 Codex 在定稿时区分「未录入」与「已录入为 0」；草案建议未录入用 `status: "not_available"` 且 `cny_total: null`，已录入 0 用 `"0.00"`。
- `difference.cny_total` = 客服登记折算合计 − 财务核定折算合计。任一侧缺汇率或未录入时，差额为 `null`，不得估算。
- `direction`：`customer_payments_higher` | `finance_higher` | `equal` | `unknown`。

**已确认（2026-11-11）**：预估净贡献与 ROI 的「已收款」**按两个来源分别计算并并列展示**（客服登记收款流水 / 财务核定已付款业绩），不合并、不二选一。不要再为这一点标注「口径待定」，也不要把其中一个来源当成唯一结论。

### 2.3 可见成本 `visible_cost`

`可见成本 = 直播间费用 + 广告消耗`，均折算人民币。

```json
{
  "total": { "original": [], "cny_total": "1622.32", "fx": [], "status": "ok", "comparison": {} },
  "live_expenses": { "original": [{ "currency": "CNY", "amount": "1415.00" }], "cny_total": "1415.00", "fx": [], "status": "ok" },
  "ads": { "original": [{ "currency": "USD", "amount": "29.20" }], "cny_total": "207.32", "fx": [], "status": "ok" }
}
```

- 直播间当日费用：任务书第 5 节第 1 条未最终拆分。P0 **只展示现有字段**（费用发生日口径的业务费用，对应现有 `expenseCny`），不额外拆出主播薪酬、提成、料成本。ⓘ 须写明：「可能与财务录入的料成本、提成有重叠，待确认」。实际付款（`supplierPaidCny`）可作旁注，不计入可见成本，除非 Codex 定稿时另有说明。
- 广告消耗：现有日报为美元；缺 USD 汇率时 `ads.cny_total` 与 `total.cny_total` 均为 `null`，页面提示缺汇率。广告范围：全公司所选日期，不随直播间筛选缩小（与现有经营总览一致）。
- 公司付款、工资、料成本、提成、代收手续费 **不计入** 可见成本。

### 2.4 净贡献 `net_contribution`（两层，不得混用标签）

已确认：

- **预估净贡献** = 已收款 − 可见成本，系统自动算，必须标注「未扣料成本、提成、代收手续费」。
- **最终净贡献** = 预估净贡献 − 料成本 − 提成 − 代收手续费。这三项由财务经录入接口提交；财务未录入的日期，最终净贡献显示「待财务核算」，**不得用预估值代替或自行估算**。

已确认形状（两个已收款来源并列）：

```json
{
  "estimated_note": "未扣料成本、提成、代收手续费",
  "collection_source_used": "both",
  "estimated_by_source": {
    "customer_payments": { "original": [], "cny_total": "938.18", "fx": [], "status": "ok", "comparison": {} },
    "finance_paid_performance": { "original": [], "cny_total": "-331.82", "fx": [], "status": "ok", "comparison": {} }
  },
  "final": {
    "status": "pending_finance",
    "label": "待财务核算",
    "value": null,
    "components": {
      "material_cost": null,
      "commission": null,
      "collection_fee": null,
      "granularity": "pending"
    }
  }
}
```

- `collection_source_used`：已确认为 `both`（按客服登记、财务核定分别给出预估净贡献）。保留 `customer_payments` / `finance_paid_performance` 仅供兼容，P0 不应再使用 `pending`，也不要把两个来源收成一个 `estimated`。
- `final.value` 在 `pending_finance` 时必须为 `null`。`final.label` 固定为「待财务核算」直到财务录入。
- 财务录入接口的粒度（按日 / 按单）仍待与财务确认，`components.granularity` 用 `pending` | `daily` | `per_order`。P0 不发明提成比例或税率。
- 预估与最终 **不得** 使用同一标签、同一字段。

### 2.5 ROI `roi`

任务书第 5 节第 3 条：默认分子为已收款，页面可切换为开单营业额。公式：分子 ÷ 分母（广告消耗，折算 CNY）。

```json
{
  "default_basis": "collections",
  "available_bases": ["collections", "turnover"],
  "collection_source_used": "both",
  "values": {
    "collections_by_source": {
      "customer_payments": { "value": "1235.05", "unit": "percent", "numerator_cny": "2560.50", "denominator_cny": "207.32", "comparison": {}, "status": "ok" },
      "finance_paid_performance": { "value": "622.47", "unit": "percent", "numerator_cny": "1290.50", "denominator_cny": "207.32", "comparison": {}, "status": "ok" }
    },
    "turnover": { "value": "853.99", "unit": "percent", "numerator_cny": "1770.50", "denominator_cny": "207.32", "comparison": {}, "status": "ok" }
  }
}
```

- **已确认（2026-11-11）**：`unit` 固定为 `percent`。`value` 是百分数（分子 ÷ 广告消耗 × 100），保留两位小数，例如财务核定来源 `622.47` 展示为 `622.47%`。**不是**倍数（不要展示「6.2247 倍」）。广告消耗为 0 或缺汇率时 `value` 为 `null`。
- **已确认（2026-11-11）**：已收款分子按两个来源分别计算并并列；切换到营业额时只展示一个百分数。页面不再为已收款来源标注「口径待定」。

---

## 3. P1–P3 接口草图（非本阶段实现范围）

以下仅作交接，**本分支不实现这些接口的前端主流程**。字段名同样待 Codex 定稿。

| 阶段 | 建议路径 | 要点 |
|---|---|---|
| P1 资金区 | `GET /api/dashboard/boss-overview/capital` | 应收未收尾款（总额、笔数，账龄 0–7 / 8–15 / 15+ 天）、在制订单金额与笔数（定制 15–30 天，临近超期标记）、已收款按币种拆分 + 折算合计。售后收款无数据时由前端折叠。 |
| P1 漏斗 | `GET /api/dashboard/boss-overview/funnel` | 广告花费 → 加粉 → 有效粉 → 进直播间 → 成交。每步人数、转化率、单步成本。加粉成本 = 广告花费 ÷ 加粉数；有效粉成本 = 广告花费 ÷ 有效粉数。「有效粉」「今日有效」「初步转化率」展示原字段，不二次计算。 |
| P1 进直播间占位 | 预留写入/导入：`live_entry(date, live_room_id, persona_id?, agent_id?, entered_count)` | 数据负责人尚未对接。接入前该环节展示「数据待接入」，「有效粉 → 进直播间 → 成交」两步转化率为 `null`（页面显示「—」），不得编造。粒度待负责人确认。`flags.live_entry_pending` 已在 P0 根级预留。 |
| P2 视频人设表 | `GET /api/dashboard/boss-overview/personas` | 4 个人设：花费、加粉、有效率、成交额、ROI、排名。成交额与 ROI 依赖销售侧 `source_persona_id`；字段上线前这两列 `status: "pending_attribution"`，页面「待归因字段」。对照表 `persona_map`（视频人设 ↔ 主页全名）。主播「甜甜」等不得进入 `persona_map`。缺失项在页面提示。 |
| P2 直播间/主播表 | `GET /api/dashboard/boss-overview/rooms` | 按 `host_id`：营业额、成交单数、客单价、费用、预估净贡献。对照表 `host_map`。 |
| P2 客服组表 | `GET /api/dashboard/boss-overview/groups` | 6 组：加粉量、有效率、成交单数、成交额。`agent_group_map`。 |
| P2 共同 | 查询参数支持 `preset=day\|week\|month`（及自定义区间），可排序。归因只到人设 / 主播 / 客服组，不到视频与拍剪师。 |
| P3 预警 | `GET /api/dashboard/boss-overview/alerts` | 阈值走配置，不写死。建议：人设 ROI 低于阈值、有效率连续下降、尾款逾期、在制临近超期、客服组零成交、汇率缺失。 |
| P3 待办 | `GET /api/dashboard/boss-overview/todos` | 待审核订单、逾期尾款、异常填报。 |
| P3 复购 | `GET /api/dashboard/boss-overview/repurchase` | 依赖销售日报「新客 / 老客」字段。上线前模块 `status: "data_pending"`，页面「数据待补」，不得用 4–6 成估计值冒充。 |
| P3 趋势 | `GET /api/dashboard/boss-overview/trends` | 近 7 天与 30 天。默认视图建议「本月累计 + 近 7 天」。 |
| 配置 | `fx_rates`、月目标、预警阈值、`persona_map`、`host_map` | 维护者与录入入口待确认。缺失汇率必须提示；缺失月目标隐藏「vs 目标」。 |
| 财务录入 | 料成本、提成、代收手续费 | 粒度（按日/按单）待确认。不在前端发明提成比例或税率。 |

页面刷新时间保留，并分别标注各数据源更新时间（P0 已在根级预留 `updated_at`）。

---

## 4. 前端降级约定

| 情况 | 前端行为 |
|---|---|
| 接口 404（含「接口不存在」） | 结论条展示「数据待接入」，不影响加粉、拍剪和现有直播间明细。 |
| 401 / 5xx / 网络失败 | 结论条内显示失败原因与重试，不中断整页其他模块。 |
| 400 | 展示后端文案。 |
| `fx.status = missing_fx` | 顶部可见提示，相关 `cny_total` 显示为「缺汇率，未折算」，只保留原币种。 |
| `final.status = pending_finance` | 最终净贡献只显示「待财务核算」。 |
| `caliber_pending` | 在对应指标旁标注「口径待定」，并列展示已给出的多来源结果。 |
| `vs_month_target == null` | 隐藏「vs 目标」。 |
| 演示环境 | 全部为虚构数据，不连接正式后台。 |

---

## 5. 与现有系统的已知对齐 / 冲突（供 Codex 复核）

1. 现有 `GET /api/dashboard/live-business` 已提供开单营业额、客户分币种收款、财务核定已付款业绩、直播间费用、美元广告消耗。P0 结论条是 **新的汇总契约**，其中营业额、费用、收款应与明细页对账，但折算、对比、净贡献、ROI 是新字段。
2. 美元与人民币须同时保留原币种；另加折算人民币合计。不得只出人民币。
3. 「已收款」两个来源可能对不上，这是要展示的差异，不是错误。
4. 订单已有独立字段 `persona_code`（视频人设）、`host_name`（主播）、`live_room_code`（直播间）（migration 008）。P0 不重建这张表。4 个视频人设的主页全名对照仍缺，属 P2，缺的在人设表提示。
5. 财务核定目前按日、按直播间、按主播一条，不按人设/客服拆分（11-10 已确认暂维持）。
6. 演示只读 API 可按本草案返回虚构响应，便于前端先行；正式计算以 Codex 实现为准。演示汇率必须来自「演示配置表」，页面展示所用汇率与生效日，不得使用 5.2。

---

## 6. 口径确认与仍待 Codex / 业务确认的问题

**已确认（2026-11-11），前端不再为这两点标注「口径待定」：**

1. 预估净贡献、ROI 的「已收款」按客服登记流水与财务核定**分别计算、并列展示**，不二选一、不合并。
2. ROI 对外展示单位为**百分比**（例如 `622.47%`）。契约字段 `roi.values.*.unit` 为 `percent`，`value` 为百分数（分子 ÷ 广告消耗 × 100，保留两位小数）。

**仍待确认（未确认前前端按本草案降级展示，相关 ⓘ 可保留「口径待定 / 待确认」）：**

1. 周 / 月 / 自定义区间下「vs 昨日」「vs 上周同期」的窗口定义。
2. 财务未录入核定与「已核定为 0」的区分。
3. 汇率生效日相对「付款日 / 开单日 / 区间结束日」如何选取；谁来维护配置表。
4. 月目标的录入入口与权限。
5. 可见成本是否永远排除实际付款、工资；直播间费用与财务料成本/提成重叠问题（第 5 节第 1 条）。
6. 财务三项成本录入的粒度（按日 / 按单）。

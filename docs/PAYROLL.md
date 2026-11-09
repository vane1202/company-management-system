# 月度工资单（提成 / 奖金 / 扣款）

日期：2026-11-09（Asia/Taipei）。本页说明 007 迁移引入的工资单模型与接口。未部署、未发布演示。

## 已确认规则（用户 2026-11-09）

- 提成、奖金、扣款全部由**财务按员工、按月手工录入**，系统**不自动计算**任何比例、个税、社保。
- 自然月出工资单；底薪沿用原 `salaries` 工资标准与 `allocateSalaries`（BigInt 分、自然日分摊，未改动）。
- 每个员工每月可录多条项目，每条有金额（正数）和必填备注。
- 实发 = 底薪 + 提成 + 奖金 − 扣款，精确到分，不四舍五入到元。
- BOSS 只读；财务读写；管理员、主管、客服、助理看不到工资。助理审核保持取消。

## 数据（007_payroll_items.sql）

- `payroll_items`：员工、月份（`YYYY-MM`）、类型 `commission|bonus|deduction`、正数金额 NUMERIC(14,2)、备注、提交标识 `request_key`（防重复提交）、创建人/时间、作废人/时间/原因、`corrects_id`（更正来源，唯一）、`version`。不提供删除。
- `payroll_months`：员工+月份的状态 `draft|locked`、版本、锁定时快照（底薪/提成/奖金/扣款/实发）、锁定人/时间。
- 若存在数据库角色 `cuiguanjia_app`，迁移只授予两表 SELECT/INSERT/UPDATE（不授予 DELETE）；其他环境自动跳过。

## 接口（均在 `/api/salaries/payroll` 下，财务写、BOSS 只读，private,no-store）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/?month=YYYY-MM[&userId=]` | 工资单：全体合计、岗位合计、每人底薪/提成/奖金/扣款/实发、负数标记、状态、底薪来源与项目明细（含已作废） |
| GET | `/items?month=&userId=` | 项目列表（含已作废） |
| GET | `/items/:id/history` | 项目审计轨迹 |
| POST | `/items` | 新增项目 `{userId,month,kind,amount,note,requestKey}`；新建 201，同标识同内容重试 200，同标识不同内容 409 |
| POST | `/items/:id/void` | 作废 `{version,reason}` |
| POST | `/items/:id/correct` | 更正 `{version,reason,kind,amount,note,requestKey}`：作废原项目并新增更正项目（同员工同月），同一事务、两条审计 |
| POST | `/months/lock` | 锁定 `{userId,month,version}`（version 为当前 statusVersion，未建状态时为 0），保存金额快照 |
| POST | `/months/unlock` | 解锁 `{userId,month,version,reason}` |
| GET | `/months/history?userId=&month=` | 锁定/解锁轨迹 |

并发：所有写操作先锁员工行（`users ... FOR UPDATE`），再检查锁定状态与版本，审计与业务写入同一事务。

## 锁定与负数

- 锁定后该员工该月不能新增、作废、更正项目（409），需财务填写原因解锁。其他月份不受影响。
- 锁定显示锁定时快照。若锁定后财务调整了工资标准导致底薪变化，工资单仍显示快照，并标记 `changedAfterLock`，同时给出现行计算值，供财务决定是否解锁重锁。工资标准本身不因锁定而被禁止修改。
- 实发为负数时原样显示并标记 `netNegative`，合计中统计 `negativeCount`；不截断为 0。
- 系统只记录核算，不执行付款，没有“已发放”状态。

## 经营估算兼容口径

经营估算（`/api/dashboard/summary`）**继续只扣底薪分摊**，不计入提成、奖金、扣款，响应中 `overallSalary.payrollItemsIncluded=false` 并在 note 说明。原因：估算区间可以是任意天数，月度手工项目没有可靠的按天拆分依据；只用底薪可确保不会与工资单重复扣除。完整应发/实发以工资页为准。

## 前端

`SalaryWorkspace` 默认显示“月度工资单”，另有“底薪分摊”（原区间核算）和“工资标准”。工资单页本月/上月/月份选择、员工筛选，合计卡片、岗位合计、员工可展开卡片（底薪来源、项目明细、已作废留痕）；财务可录入、更正、作废、锁定/解锁，BOSS 无任何编辑控件。手机 360px 无横向溢出。

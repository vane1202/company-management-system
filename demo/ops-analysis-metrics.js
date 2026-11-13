/* Static-demo read model. A single calculation feeds cards, groups and detail. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./boss-overview-metrics.js'));
  else root.CmsOpsAnalysis = factory(root.CmsBossOverview);
})(typeof window === 'object' ? window : globalThis, function (core) {
  'use strict';
  const { cents, money, convert, periodOf, comparisonPeriods } = core;
  const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const dimensions = { persona: 'personaName', platform: 'platform', account: 'adAccountRef' };
  function integer(value) { return value != null && Number.isSafeInteger(value) && value >= 0; }
  function sumMoney(rows, key) { return rows.length && rows.every(r => r[key] != null) ? money(rows.reduce((n, r) => n + cents(r[key]), 0n)) : null; }
  function sumCount(rows, key) { return rows.length && rows.every(r => integer(r[key])) ? rows.reduce((n, r) => n + r[key], 0) : null; }
  function totals(rows, rates) {
    const spendUsd = sumMoney(rows, 'spendUsd'), consultCount = sumCount(rows, 'consultCount'), clickCount = sumCount(rows, 'clickCount');
    const converted = rows.map(r => r.spendUsd == null ? null : convert({ amount: r.spendUsd, currency: 'USD', date: r.businessDate }, rates));
    const spendCny = converted.length && converted.every(r => r && r.cny !== null) ? money(converted.reduce((n, r) => n + cents(r.cny), 0n)) : null;
    const costStatus = !rows.length ? 'empty' : spendUsd == null || consultCount == null ? 'incomplete' : consultCount === 0 ? (spendUsd === '0.00' ? 'no_spend' : 'no_consultation') : 'ready';
    const consultationCostUsd = costStatus === 'ready' ? money((cents(spendUsd) + BigInt(consultCount) / 2n) / BigInt(consultCount)) : null;
    return { spendUsd, spendCny, consultCount, clickCount, consultationCostUsd, costStatus, recordCount: rows.length,
      missingSpendCount: rows.filter(r => r.spendUsd == null).length,
      missingConsultCount: rows.filter(r => !integer(r.consultCount)).length,
      missingClickCount: rows.filter(r => !integer(r.clickCount)).length,
      reportedDays: new Set(rows.map(r => r.businessDate)).size };
  }
  function balances(allRows, selectedRows, to) {
    const accounts = [...new Set(selectedRows.map(r => r.adAccountRef).filter(Boolean))];
    return accounts.sort().map(account => {
      // Search all personas/platforms for the account's most recent snapshot;
      // filtering a persona does not make a fraction of the account balance.
      const candidates = allRows.filter(r => !r.voided && r.adAccountRef === account && r.businessDate <= to && r.balanceUsd != null)
        .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      const last = candidates[0];
      if (!last) return { account, amountUsd: null, date: null, status: 'missing', shared: true };
      const sameTime = candidates.filter(r => r.businessDate === last.businessDate && r.updatedAt === last.updatedAt);
      const conflict = new Set(sameTime.map(r => r.balanceUsd)).size > 1;
      return { account, amountUsd: conflict ? null : last.balanceUsd, date: last.businessDate, status: conflict ? 'conflict' : 'ready', shared: new Set(allRows.filter(r => r.adAccountRef === account).map(r => r.personaName)).size > 1 };
    });
  }
  function build(dataset, query, clock) {
    const period = periodOf(query, clock.today), dimension = query.dimension || 'persona';
    if (!Object.hasOwn(dimensions, dimension)) throw Error('分类维度无效');
    const selected = { persona: query.persona || '', platform: query.platform || '', account: query.account || '' };
    const active = dataset.rows.filter(r => !r.voided);
    const scope = rows => rows.filter(r => Object.entries(selected).every(([key, value]) => !value || (r[dimensions[key]] || '__unassigned__') === value));
    const between = (rows, from, to) => rows.filter(r => r.businessDate >= from && r.businessDate <= to);
    const scoped = scope(active), records = between(scoped, period.from, period.to).sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.id.localeCompare(b.id));
    const summary = totals(records, dataset.rates);
    const groups = [...new Set(records.map(r => r[dimensions[dimension]] || '__unassigned__'))].map(key => ({
      key, name: key === '__unassigned__' ? '未关联' : key, ...totals(records.filter(r => (r[dimensions[dimension]] || '__unassigned__') === key), dataset.rates)
    }));
    const base = comparisonPeriods(period)[0], previous = totals(between(scoped, base.from, base.to), dataset.rates);
    const baselineLabel = !period.custom && period.preset === 'day' ? '昨日已报' : !period.custom && period.preset === 'week' ? '上周同期已报' : !period.custom && period.preset === 'month' ? '上月同期已报' : '上期已报';
    const trendFrom = shift(period.to, -6);
    const trend = Array.from({ length: 7 }, (_, i) => { const date = shift(trendFrom, i); return { date, partial: date === clock.today, ...totals(scoped.filter(r => r.businessDate === date), dataset.rates) }; });
    const accountBalances = balances(active, records, period.to);
    const fxUsed = records.filter(r => r.spendUsd != null).map(r => convert({ amount: r.spendUsd, currency: 'USD', date: r.businessDate }, dataset.rates));
    return {
      version: 'ops-analysis/v1', demo: true, period: { ...period, today: clock.today, timezone: 'Asia/Shanghai', partial: period.to === clock.today },
      selected, dimension, summary, groups, records,
      comparison: { label: baselineLabel, from: base.from, to: base.to, totals: previous, records: between(scoped, base.from, base.to), method: 'reported_daily_totals', percentage: null },
      trend: { from: trendFrom, to: period.to, days: trend },
      balances: { accounts: accountBalances, totalUsd: accountBalances.length && accountBalances.every(r => r.amountUsd != null) ? money(accountBalances.reduce((n, r) => n + cents(r.amountUsd), 0n)) : null, scope: 'whole_account' },
      options: Object.fromEntries(Object.entries(dimensions).map(([key, field]) => [key, [...new Set(active.map(r => r[field] || '__unassigned__'))].sort()])),
      fx: { ratesUsed: [...new Map(fxUsed.filter(r => r.rate).map(r => [r.rate + r.rateDate, { cnyPerUnit: r.rate, effectiveFrom: r.rateDate }])).values()], missing: [...new Set(fxUsed.filter(r => !r.rate).map(r => r.date))], referenceOnly: true },
      updatedAt: records.map(r => r.updatedAt).filter(Boolean).sort().at(-1) || null,
      definitions: {
        spend: '广告实际消耗按日报业务日累计，单位USD；充值不是消耗。人民币是按发生日参考汇率逐笔四舍五入到分的分析折算，不是实际结汇。',
        consultations: '咨询量是运营日报上报计数相加，不作为跨日报去重客户人数；不等于客服加粉、有效线索或成交。',
        cost: '综合咨询成本＝所选日报总广告消耗÷所选日报总咨询量，单位USD/咨询。不平均各日报成本；手填咨询成本保留在原始日报。零咨询不计算，缺报不当作0。',
        clicks: '所选日报点击量相加，不作为独立客户人数。缺少曝光量，汇总点击率不计算；各日报原点击率保留。',
        comparison: '基准为运营已报的历史日汇总；今天尚未结束，且没有小时级数据，所以只列基准数，不声称同一时刻同比，不计算增长率。缺报日期不当作0。',
        balance: '每个相关广告账户取截止日最近一次余额快照，跨人设去重。筛选人设/平台后仍显示完整账户余额，不是该人设分配余额；余额冲突或缺失显示待核对。'
      }
    };
  }
  return { build, totals, balances };
});

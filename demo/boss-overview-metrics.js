/* Pure demo service: CommonJS for node:test; browser global for the static API.
 * Integer cents / six-decimal FX. No storage, database, network or write API. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CmsBossOverview = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const DAY = 86400000;
  const included = new Set(['design', 'labor', 'accessory', 'certificate', 'box', 'shipping']);
  const excluded = new Set(['goods', 'material', 'sourcing', 'commission', 'collection_fee']);
  function dateOk(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
  function shift(s, n) { return new Date(Date.parse(s + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
  function cents(s) {
    if (!/^-?\d{1,12}(?:\.\d{1,2})?$/.test(String(s))) throw Error('金额格式无效');
    const negative = String(s).startsWith('-'), [a, b = ''] = String(s).replace('-', '').split('.');
    return (negative ? -1n : 1n) * (BigInt(a) * 100n + BigInt(b.padEnd(2, '0')));
  }
  function money(n) { const sign = n < 0n ? '-' : '', x = n < 0n ? -n : n; return sign + x / 100n + '.' + String(x % 100n).padStart(2, '0'); }
  function rounded(n, d) { return n < 0n ? -((-n + d / 2n) / d) : (n + d / 2n) / d; }
  function fxFor(currency, day, rates) {
    if (currency === 'CNY') return { currency, cnyPerUnit: '1.000000', effectiveFrom: '恒定', source: '人民币本币' };
    return rates.filter(r => r.currency === currency && r.effectiveFrom <= day && (!r.effectiveTo || r.effectiveTo >= day))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || null;
  }
  function convert(row, rates) {
    const rate = fxFor(row.currency, row.date, rates);
    if (!rate) return { ...row, cny: null, rate: null, rateDate: null };
    if (!/^\d{1,6}(?:\.\d{1,6})?$/.test(rate.cnyPerUnit)) throw Error('参考汇率格式无效');
    const [a, b = ''] = rate.cnyPerUnit.split('.'), scale = BigInt(a) * 1000000n + BigInt(b.padEnd(6, '0'));
    if (scale <= 0n) throw Error('参考汇率必须大于0');
    return { ...row, cny: money(rounded(cents(row.amount) * scale, 1000000n)), rate: rate.cnyPerUnit, rateDate: rate.effectiveFrom };
  }
  function periodOf(query, today) {
    if (!dateOk(today)) throw Error('业务日期无效');
    const preset = query.preset || 'day';
    if (!['day', 'week', 'month'].includes(preset)) throw Error('日期预设无效');
    const weekday = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7;
    if (!!query.from !== !!query.to) throw Error('请同时提供开始和结束日期');
    const from = query.from || (preset === 'month' ? today.slice(0, 8) + '01' : preset === 'week' ? shift(today, -weekday) : today), to = query.to || today;
    if (![from, to].every(dateOk) || from > to || to > today || (Date.parse(to) - Date.parse(from)) / DAY > 365) throw Error('日期范围无效');
    return { from, to, preset, custom: !!query.from };
  }
  function comparisonPeriods(period) {
    const move = (n, label) => ({ from: shift(period.from, n), to: shift(period.to, n), label });
    if (period.custom) return [move(-((Date.parse(period.to) - Date.parse(period.from)) / DAY + 1), '上期同期')];
    if (period.preset === 'day') return [move(-1, '昨日同期'), move(-7, '上周同期')];
    if (period.preset === 'week') return [move(-7, '上周同期')];
    const first = new Date(period.from + 'T00:00:00Z'); first.setUTCMonth(first.getUTCMonth() - 1);
    const from = first.toISOString().slice(0, 10), last = shift(period.from, -1);
    return [{ from, to: from.slice(0, 8) + String(Math.min(Number(period.to.slice(-2)), Number(last.slice(-2)))).padStart(2, '0'), label: '上月同期' }];
  }
  const definitions = {
    turnover: ['开单卡料价＋代购费，按原开单日；排除跑单和历史退款标记源单，不含追加收费。', '开单卡及跑单记录'],
    receipts: ['有效客户付款按付款日汇总并参考折算；与公司实际到账、财务核定已付款业绩分开。', '客户付款流水'],
    visibleCost: ['明确分类的设计、加工、配件、证书、包装、运费＋实际广告消耗；排除商品/料成本（含配货采购）、提成、代收手续费。充值不算广告消耗。主播薪酬是否计入原直播间费用：待确认。', '费用明细及广告消耗日报'],
    estimatedContribution: ['客户已收款参考折算－可见成本。未扣料成本、提成、代收手续费；混合收款日与费用发生日，不代表订单利润或公司净利润。账内已登记料成本仅作参考提示，不替代财务专项核算，也不并入本项。', '客户付款、分类费用及广告消耗'],
    roi: ['分子：客户已收款参考折算；分母：广告消耗参考折算。并非利润率，不代表同批获客或广告因果归因。收款与广告花费不同期（今天成交可能来自上月投流），日 ROI 仅供参考，本月累计更有参考价值。广告消耗为0时不计算。', '客户付款及广告消耗日报']
  };
  function calculate(dataset, period, cutoffTime, partialEnd) {
    const inside = r => !r.voided && r.date >= period.from && r.date <= period.to && (!partialEnd || r.date !== period.to || (r.localTime && r.localTime <= cutoffTime));
    const rows = dataset.rows.filter(inside).map(r => {
      let reason = '', bucket = r.kind;
      if (r.kind === 'booking' && r.excluded) { bucket = 'excludedBooking'; reason = r.excluded; }
      if (r.kind === 'cost') {
        if (excluded.has(r.category)) { bucket = 'excludedCost'; reason = '财务专项核算，避免重复扣除'; }
        else if (!included.has(r.category)) { bucket = 'unclassifiedCost'; reason = '费用类别待确认'; }
      }
      return convert({ ...r, bucket, reason }, dataset.rates);
    });
    const sum = records => {
      const nativeTotals = {};
      for (const r of records) nativeTotals[r.currency] = money(cents(nativeTotals[r.currency] || '0.00') + cents(r.amount));
      const missing = records.some(r => r.cny === null);
      return { value: missing ? null : money(records.reduce((n, r) => n + cents(r.cny), 0n)), nativeTotals, status: missing ? 'missing_rate' : 'ready' };
    };
    const totals = {
      turnover: sum(rows.filter(r => r.bucket === 'booking')),
      receipts: sum(rows.filter(r => r.bucket === 'payment')),
      visibleCost: sum(rows.filter(r => ['cost', 'ad'].includes(r.bucket))),
      adSpend: sum(rows.filter(r => r.bucket === 'ad'))
    };
    if (rows.some(r => r.bucket === 'unclassifiedCost')) { totals.visibleCost.value = null; totals.visibleCost.status = 'unclassified_cost'; }
    const ready = totals.receipts.value !== null && totals.visibleCost.value !== null;
    totals.estimatedContribution = { value: ready ? money(cents(totals.receipts.value) - cents(totals.visibleCost.value)) : null, nativeTotals: {}, status: ready ? 'ready' : totals.visibleCost.status !== 'ready' ? totals.visibleCost.status : 'missing_rate' };
    const noAds = totals.adSpend.value === '0.00';
    totals.roi = { value: totals.receipts.value !== null && totals.adSpend.value !== null && !noAds ? money(rounded(cents(totals.receipts.value) * 100n, cents(totals.adSpend.value))) : null, nativeTotals: {}, status: noAds ? 'no_spend' : totals.adSpend.value === null || totals.receipts.value === null ? 'missing_rate' : 'ready' };
    const days = Array.from({ length: (Date.parse(period.to) - Date.parse(period.from)) / DAY + 1 }, (_, i) => shift(period.from, i));
    const financeRows = days.map(date => dataset.finance.find(r => r.date === date && !r.voided));
    const missingDays = days.filter((_, i) => !financeRows[i] || ['materialCost', 'commission', 'collectionFee'].some(k => financeRows[i][k] == null));
    const deductions = Object.fromEntries(['materialCost', 'commission', 'collectionFee'].map(k => [k, missingDays.length ? null : money(financeRows.reduce((n, r) => n + cents(r[k]), 0n))]));
    const finalContribution = { value: missingDays.length || !ready ? null : money(cents(totals.estimatedContribution.value) - Object.values(deductions).reduce((n, v) => n + cents(v), 0n)), status: missingDays.length ? 'pending_finance' : ready ? 'ready' : totals.estimatedContribution.status, missingDays, deductions, records: financeRows.filter(Boolean) };
    const missingTime = dataset.rows.some(r => !r.voided && r.date >= period.from && r.date <= period.to && partialEnd && r.date === period.to && !r.localTime);
    const covered = dataset.coverage.from <= period.from && dataset.coverage.to >= period.to && !missingTime;
    if (!covered) {
      for (const t of Object.values(totals)) { t.value = null; t.status = 'incomplete'; }
      finalContribution.value = null; finalContribution.status = 'incomplete';
    }
    return { totals, rows, finalContribution, covered };
  }
  function bookingDateOf(row, rows) {
    if (row.bookingDate) return row.bookingDate;
    const booking = rows.find(r => r.kind === 'booking' && row.orderId && r.orderId === row.orderId);
    return booking ? booking.date : null;
  }
  function sliceOf(current, predicate) {
    return current.rows.filter(predicate);
  }
  function build(dataset, query, clock) {
    const period = periodOf(query, clock.today), partialEnd = period.to === clock.today;
    const current = calculate(dataset, period, clock.localTime, partialEnd);
    const comparisons = comparisonPeriods(period).map(p => ({ period: p, result: calculate(dataset, p, clock.localTime, partialEnd) }));
    const metrics = {};
    for (const [key, [definition, source]] of Object.entries(definitions)) {
      const total = current.totals[key];
      metrics[key] = { ...total, unit: key === 'roi' ? '倍' : 'CNY', definition, source, comparisons: comparisons.map(({ period: p, result }) => {
        const prior = result.totals[key], ready = total.value !== null && prior.value !== null;
        const absolute = ready ? money(cents(total.value) - cents(prior.value)) : null;
        return { ...p, baseValue: prior.value, baseStatus: prior.status, absolute, percent: ready && cents(prior.value) > 0n ? money(rounded((cents(total.value) - cents(prior.value)) * 10000n, cents(prior.value))) : null, status: !ready ? 'unavailable' : cents(prior.value) <= 0n ? 'nonpositive_base' : 'ready' };
      }) };
    }
    const sum = records => {
      const nativeTotals = {};
      for (const r of records) nativeTotals[r.currency] = money(cents(nativeTotals[r.currency] || '0.00') + cents(r.amount));
      const missing = records.some(r => r.cny === null);
      return { value: missing ? null : money(records.reduce((n, r) => n + cents(r.cny), 0n)), nativeTotals, status: missing ? 'missing_rate' : 'ready' };
    };
    const paymentRows = sliceOf(current, r => r.bucket === 'payment');
    const currentBookings = [], historicalOrders = [], unscheduled = [];
    for (const r of paymentRows) {
      const booked = bookingDateOf(r, current.rows);
      if (!booked) unscheduled.push(r);
      else if (booked >= period.from && booked <= period.to) currentBookings.push(r);
      else historicalOrders.push(r);
    }
    const receiptSplit = {
      currentBookings: sum(currentBookings),
      historicalOrders: sum(historicalOrders),
      unscheduled: sum(unscheduled)
    };
    const materialCategories = new Set(['goods', 'material', 'sourcing']);
    const costBreakdown = {
      visibleBusiness: sum(sliceOf(current, r => r.bucket === 'cost')),
      advertising: current.totals.adSpend,
      excludedMaterial: sum(sliceOf(current, r => r.bucket === 'excludedCost' && materialCategories.has(r.category)))
    };
    const paidRows = dataset.paidPerformance.filter(r => r.date >= period.from && r.date <= period.to);
    const paidTotal = paidRows.length ? money(paidRows.reduce((n, r) => n + cents(r.amount), 0n)) : null;
    const receiptsValue = current.totals.receipts.value;
    const collectionGap = {
      receipts: receiptsValue,
      paidPerformance: paidTotal,
      difference: receiptsValue != null && paidTotal != null ? money(cents(receiptsValue) - cents(paidTotal)) : null,
      status: receiptsValue != null && paidTotal != null ? 'ready' : paidTotal == null ? 'no_paid_performance' : current.totals.receipts.status
    };
    let monthToDateRoi = null;
    if (period.preset !== 'month' || period.custom) {
      const monthPeriod = periodOf({ preset: 'month' }, clock.today);
      const monthResult = calculate(dataset, monthPeriod, clock.localTime, monthPeriod.to === clock.today);
      monthToDateRoi = { ...monthResult.totals.roi, unit: '倍', period: { from: monthPeriod.from, to: monthPeriod.to } };
    }
    const references = {
      registeredMaterialCost: { ...costBreakdown.excludedMaterial, hintOnly: true },
      monthToDateRoi
    };
    if (!current.covered) {
      for (const block of [costBreakdown.visibleBusiness, costBreakdown.excludedMaterial, receiptSplit.currentBookings, receiptSplit.historicalOrders, receiptSplit.unscheduled, references.registeredMaterialCost]) {
        block.value = null;
        block.status = 'incomplete';
      }
      collectionGap.difference = null;
      collectionGap.status = 'incomplete';
    }

    const fx = { referenceOnly: true, ratesUsed: [...new Map(current.rows.filter(r => r.rate).map(r => [r.currency + r.rate + r.rateDate, { currency: r.currency, cnyPerUnit: r.rate, effectiveFrom: r.rateDate }])).values()], missing: [...new Set(current.rows.filter(r => r.rate === null).map(r => r.currency + ' / ' + r.date))] };
    const monthTarget = !period.custom && period.preset === 'month' ? dataset.targets?.find(t => t.month === period.from.slice(0, 7)) : null;
    return { version: 'boss-overview-p0/v1', demo: true, scope: 'company', period: { ...period, timezone: 'Asia/Shanghai', asOf: clock.asOf, cutoff: partialEnd ? clock.localTime : '23:59:59' }, metrics, finalContribution: current.finalContribution, ledger: current.rows, fx, sources: dataset.sources, paidPerformance: paidRows, target: monthTarget || null, costBreakdown, receiptSplit, collectionGap, references };
  }
  return { build, convert, cents, money, periodOf, comparisonPeriods };
});

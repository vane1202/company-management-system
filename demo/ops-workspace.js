(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CmsOpsWorkspace = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const people = [{ id: 'demo-ops', name: '子恒', code: 'ZH' }, { id: 'demo-ops-xiaopu', name: '小蒲', code: 'XP' }, { id: 'demo-ops-agency-a', name: '代运营A', code: 'DA' }, { id: 'demo-ops-agency-b', name: '代运营B', code: 'DB' }];
  function rowsFor(person, original) {
    if (person.id === people[0].id) return original;
    return original.map(row => ({ ...row, id: person.id + '-' + row.id, userId: person.id, adAccountRef: row.adAccountRef.replace('DEMO-ADS', 'DEMO-' + person.code + '-ADS') }));
  }
  function accountsOf(rows) {
    return [...new Set(rows.map(row => row.adAccountRef))].map(id => ({ id, label: id, platform: rows.find(row => row.adAccountRef === id).platform, personas: [...new Set(rows.filter(row => row.adAccountRef === id).map(row => row.personaName))] }));
  }
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  function validateFeedback(input, accounts, today) {
    const text = (key, limit, required = false) => {
      const value = String(input[key] || '').trim();
      if (value.length > limit || required && !value) throw Error('请填写完整反馈，且不要超过字段字数限制');
      return value;
    };
    const account = text('account', 100), persona = text('persona', 100);
    if (!account && !persona) throw Error('至少关联一个广告账户或人设主页');
    if (account && !accounts.some(item => item.id === account)) throw Error('只能反馈本人负责的广告账户');
    if (persona && !accounts.some(item => (!account || item.id === account) && item.personas.includes(persona))) throw Error('所选人设不在本人负责范围或与账户不匹配');
    const from = text('from', 10), to = text('to', 10), date = text('date', 10);
    if (![from, to, date].every(validDate) || from > to || to > today || date > today) throw Error('请填写有效观察周期和反馈日期，不能晚于今天');
    const category = text('category', 30);
    if (!['lead_quality', 'creative', 'strategy', 'page', 'other'].includes(category)) throw Error('请选择反馈类型');
    const attachments = input.attachments || [];
    if (!Array.isArray(attachments) || attachments.length > 3 || attachments.some(file => typeof file.name !== 'string' || file.name.length > 120 || typeof file.data !== 'string' || file.data.length > 420000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(file.data))) throw Error('最多3张PNG、JPEG或WebP截图，每张不超过300KB');
    return { account, persona, from, to, date, category, problem: text('problem', 1500, true), suggestion: text('suggestion', 1500, true), attachments };
  }
  return { people, rowsFor, accountsOf, validateFeedback };
});

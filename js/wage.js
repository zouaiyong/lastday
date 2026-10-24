/*
 * 工资流水粘贴解析：每行一条记录，自动提取金额并按关键词归类。
 * 银行流水是税后到手，解析结果仅作参考，需用工资条/个税APP应发数据校准。
 */
var WageParser = (function () {

  var CATS = [
    { key: 'fixed',  label: '固定工资' },
    { key: 'perf',   label: '绩效·奖金' },
    { key: 'allow',  label: '津贴补贴' },
    { key: 'ot',     label: '加班费' },
    { key: 'bonus',  label: '年终奖' },
    { key: 'other',  label: '其他收入' },
    { key: 'skip',   label: '不计入' }
  ];

  function categorize(label) {
    var t = label || '';
    if (/报销/.test(t)) return 'skip';
    if (/年终|十三薪|14薪|十四薪|年度奖/.test(t)) return 'bonus';
    if (/加班/.test(t)) return 'ot';
    if (/补贴|津贴|餐|交通|住房|通讯|高温|车贴|车补|房贴|房补|话补/.test(t)) return 'allow';
    if (/绩效|奖金|提成|季度|月度奖|分红|项目奖|达标奖/.test(t)) return 'perf';
    if (/工资|薪|代发|base|月薪/.test(t)) return 'fixed';
    return 'other';
  }

  /* 解析一行：去掉日期，取剩余最大的数字（≥100）作为金额，其余文字作为标签 */
  function parseLine(line) {
    var s = String(line)
      .replace(/\d{4}[-/.年]\s?\d{1,2}[-/.月]\s?\d{1,2}日?/g, ' ')   // 2026-09-15 / 2026年9月15日
      .replace(/\b\d{1,2}月\d{1,2}日\b/g, ' ');                        // 9月15日
    var tokens = s.match(/\d[\d,]*(?:\.\d+)?/g) || [];
    var nums = tokens
      .map(function (t) { return parseFloat(t.replace(/,/g, '')); })
      .filter(function (v) { return v >= 100; });
    if (!nums.length) return null;
    var amount = Math.max.apply(null, nums);
    var label = s
      .replace(/[\d,]+(?:\.\d+)?/g, ' ')
      .replace(/[￥¥元RMB手需实发实收入出支摘要备注打款转代::::，,。;；\-—–/\\|()\[\]（）【】\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label) label = String(line).trim();
    return { label: label, amount: amount, category: categorize(label) };
  }

  function parse(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .map(parseLine)
      .filter(Boolean);
  }

  /* 按分类汇总并折成月均值：月度项 = 合计 ÷ months；年终奖保留总额（由基数计算再摊分） */
  function summarize(lines, months) {
    months = Math.max(1, Math.min(12, months || 12));
    var sums = { fixed: 0, perf: 0, allow: 0, ot: 0, other: 0, bonus: 0, skip: 0 };
    lines.forEach(function (l) {
      if (sums.hasOwnProperty(l.category)) sums[l.category] += l.amount;
    });
    return {
      months: months,
      fixed: sums.fixed / months,
      perf: sums.perf / months,
      allow: sums.allow / months,
      ot: sums.ot / months,
      otTotal: sums.ot,           // 加班费总额（页面输入口径）
      other: sums.other / months,
      bonus: sums.bonus,          // 总额，进入基数时会 ÷months
      skipped: sums.skip
    };
  }

  return { CATS: CATS, parse: parse, categorize: categorize, summarize: summarize };
})();

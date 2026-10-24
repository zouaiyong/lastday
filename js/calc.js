/*
 * 补偿计算引擎：工龄折算、月均基数、N/N+1/2N、年假与年终奖折算、差额、话术生成。
 * 纯函数，不依赖 DOM。
 */
var LayoffCalc = (function () {

  function fmt(n) { return Math.round(n).toLocaleString('zh-CN'); }
  function money(n) { return '¥' + fmt(n); }

  /* 工龄折算：每满1年=1个月；余≥6个月按1年；<6个月算半个月（第47条） */
  function tenure(startStr, endStr) {
    if (!startStr || !endStr) return null;
    var start = new Date(startStr + 'T00:00:00');
    var end = new Date(endStr + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null;
    var m = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    var anchor = new Date(start.getFullYear(), start.getMonth() + m, start.getDate());
    if (anchor > end) {
      m -= 1;
      anchor = new Date(start.getFullYear(), start.getMonth() + m, start.getDate());
    }
    var y = Math.floor(m / 12), r = m % 12;
    var remDays = Math.floor((end - anchor) / 86400000);
    var nMonths = y + (r >= 6 ? 1 : (r > 0 || remDays > 0 ? 0.5 : 0));
    var rule;
    if (r >= 6) rule = '余' + r + '个月 ≥ 6个月，按' + (y + 1) + '年计';
    else if (r > 0 || remDays > 0) rule = '余' + r + '个月 &lt; 6个月，折算半个月';
    else rule = '工龄整年，无余月';
    return {
      months: m, years: y, remMonths: r, remDays: remDays, nMonths: nMonths,
      text: y + '年' + r + '个月' + (remDays > 0 ? remDays + '天' : ''),
      rule: rule
    };
  }

  /* 月均工资基数：各构成求和；年终奖与加班费（总额）按月数摊分 */
  function computeBase(w) {
    var months = Math.max(1, Math.min(12, Number(w.months) || 12));
    var bonusMonthly = (Number(w.bonus) || 0) / months;
    var otMonthly = (Number(w.ot) || 0) / months;
    var parts = [
      { key: 'fixed', label: '固定工资', note: '基本＋岗位工资', val: Number(w.fixed) || 0 },
      { key: 'perf', label: '绩效·奖金', note: '季度奖÷3、提成等摊到月', val: Number(w.perf) || 0 },
      { key: 'allow', label: '津贴补贴', note: '餐补/交通/住房/通讯/高温等', val: Number(w.allow) || 0 },
      { key: 'ot', label: '加班费', note: fmt(w.ot || 0) + ' ÷ ' + months + ' 个月', val: otMonthly },
      { key: 'other', label: '其他货币性收入', note: '提成、固定现金补贴等', val: Number(w.other) || 0 },
      { key: 'bonus', label: '年终奖摊分', note: fmt(w.bonus || 0) + ' ÷ ' + months + ' 个月', val: bonusMonthly }
    ];
    var base = parts.reduce(function (s, p) { return s + p.val; }, 0);
    return { base: base, months: months, parts: parts.filter(function (p) { return p.val > 0; }) };
  }

  /*
   * input = {
   *   scenario, notice('yes'|'no'), start, end,
   *   wage:{fixed,perf,allow,ot,other,bonus,months},
   *   social, lastmonth, annualDays, bonusStd(上年度年终奖水平，用于今年折算), offer
   * }
   */
  function compute(input, cfg) {
    var t = tenure(input.start, input.end);
    var b = computeBase(input.wage || {});
    if (!t) return { ok: false, reason: '请先在第 2 步填写入职、离职日期（离职日期需晚于入职日期）。' };
    if (b.base <= 0) return { ok: false, reason: '请先在第 2 步填写工资构成，算出月均工资基数。' };

    var eff = b.base, capped = false, nMonths = t.nMonths, notes = [];
    if ((Number(input.social) || 0) > 0 && b.base > input.social * 3) {
      eff = input.social * 3;
      capped = true;
      nMonths = Math.min(nMonths, 12);
      notes.push('月均工资超过当地社平工资3倍，按 ' + money(eff) + ' 计算且补偿年限封顶12年（第47条第2款）。');
    }

    var comp = 0, add1 = 0, compLabel = '经济补偿金（N）';
    if (input.scenario === 'resign') {
      compLabel = '经济补偿金';
    } else if (input.scenario === 'illegal') {
      comp = nMonths * 2 * eff;
      compLabel = '违法解除赔偿金（2N）';
    } else {
      comp = nMonths * eff;
      if (input.scenario === 'nofault' && input.notice === 'no') {
        add1 = (Number(input.lastmonth) || 0) > 0 ? Number(input.lastmonth) : b.base;
        if (!(Number(input.lastmonth) > 0)) {
          notes.push('代通知金默认按月均基数估算，准确值应按离职上一个月的工资标准（《实施条例》第20条）。');
        }
      }
    }

    var annualDays = Math.max(0, Math.min(15, Number(input.annualDays) || 0));
    /* 年假折算的日工资按剔除加班费后的月平均工资计算（带薪年休假实施办法第11条） */
    var otMonthly = (Number((input.wage || {}).ot) || 0) / b.months;
    var daily = (b.base - otMonthly) / 21.75;
    var annFull = daily * annualDays * 2;             /* 法定：正常工资外另付200% */
    var annualPaid = Math.max(0, Number(input.annualPaid) || 0);
    var annAmt = Math.max(0, annFull - annualPaid);   /* 扣除公司已按1倍折算支付的部分 */
    if (annAmt > 0 && otMonthly > 0) {
      notes.push('未休年假折算的日工资按剔除加班费后的月平均工资 ÷ 21.75 计算（《企业职工带薪年休假实施办法》第11条），与经济补偿基数口径不同。');
    }
    if (annualDays > 0 && annualPaid > 0) {
      notes.push('未休年假法定为日工资300%（其中100%已含在正常工资内），公司已折算支付 ' + money(annualPaid) + '，本结果为应补足的差额。');
    }

    var endDate = new Date(input.end + 'T00:00:00');
    var doy = Math.floor((endDate - new Date(endDate.getFullYear(), 0, 1)) / 86400000) + 1;
    var bonusAmt = (Number(input.bonusStd) || 0) * doy / 365;
    if (bonusAmt > 0) {
      notes.push('年终奖折算为估算主张：依据裁判口径（单位原因离职＋发放惯例），无直接法条强制折算；请准备合同/制度条款及历年发放记录作为证据，此项在谈判中可作弹性项。');
    }

    var total = comp + add1 + annAmt + bonusAmt;
    var offer = Number(input.offer) || 0;
    var diff = offer > 0 ? total - offer : null;

    var rows = [];
    if (input.scenario === 'resign') {
      rows.push({ label: compLabel, calc: '主动辞职，无法定经济补偿', amt: null });
    } else if (input.scenario === 'illegal') {
      rows.push({ label: compLabel, calc: nMonths + '个月 × 2 × ' + fmt(eff), amt: comp });
    } else {
      rows.push({ label: compLabel, calc: nMonths + '个月 × ' + fmt(eff), amt: comp });
      if (add1 > 0) rows.push({ label: '代通知金（+1）', calc: '按离职上一个月工资标准', amt: add1 });
    }
    if (annFull > 0) rows.push({ label: '未休年假折算（额外200%，扣已折算）', calc: annualDays + '天 × ' + fmt(daily) + '元/日 × 2' + (annualPaid > 0 ? ' − 已折算 ' + fmt(annualPaid) : ''), amt: annAmt });
    if (bonusAmt > 0) rows.push({ label: '年终奖按在职天数折算', calc: fmt(input.bonusStd) + ' × ' + doy + '/365', amt: bonusAmt });

    return {
      ok: true, base: b.base, baseParts: b.parts, months: b.months,
      capped: capped, eff: eff, tenure: t, nMonths: nMonths,
      comp: comp, compLabel: compLabel, add1: add1,
      annualDays: annualDays, daily: daily, annAmt: annAmt,
      doy: doy, bonusAmt: bonusAmt,
      total: total, offer: offer, diff: diff,
      rows: rows, notes: notes
    };
  }

  /* 谈判话术 / 异议函 */
  function statement(input, res, cfg) {
    var lines = [];
    lines.push('致：【公司名称】人力资源部 / 管理层');
    lines.push('');
    lines.push('本人【姓名】，于 ' + input.start + ' 入职，' + input.end + ' 离职，在本单位工作 ' + res.tenure.text + '，依据《劳动合同法》第47条折算经济补偿基数为 ' + res.nMonths + ' 个月。');
    lines.push('');
    lines.push('一、关于解除定性。本次离职属于「' + cfg.label + '」，依据' + cfg.laws.map(function (id) { return LayoffRules.LAWS[id].cite; }).join('、') + '，应适用 ' + cfg.std + ' 标准。');
    var wageParts = res.baseParts.map(function (p) { return p.label + ' ' + fmt(p.val); }).join(' + ');
    lines.push('二、关于工资基数。本人离职前月均税前应发工资为 ' + money(res.base) + '（构成：' + (wageParts || '见明细') + '）。依据《劳动合同法实施条例》第27条，经济补偿的月工资按应得工资计算，包括奖金、津贴和补贴等全部货币性收入，而非仅固定工资。');
    var items = [res.compLabel + ' ' + money(res.comp)];
    if (res.add1 > 0) items.push('代通知金 ' + money(res.add1));
    if (res.annAmt > 0) items.push('未休年假 ' + res.annualDays + ' 天折算差额 ' + money(res.annAmt));
    if (res.bonusAmt > 0) items.push('本年度年终奖折算 ' + money(res.bonusAmt));
    lines.push('三、法定应得合计 ' + money(res.total) + '（' + items.join('；') + '）。' + (res.offer > 0 ? '贵司方案为 ' + money(res.offer) + '，与法定标准差额 ' + money(res.total - res.offer) + '，请说明计算口径并提供书面明细。' : '请提供补偿方案的书面计算明细。'));
    lines.push('');
    lines.push('如无法在【日期】前达成一致，本人将依法向劳动争议仲裁委员会申请仲裁（《劳动争议调解仲裁法》第27条，时效一年），并保留主张违法解除赔偿金（2N）及其他款项的权利。');
    lines.push('');
    lines.push('此致');
    lines.push('【姓名】');
    lines.push('【日期】');
    return lines.join('\n');
  }

  return { fmt: fmt, money: money, tenure: tenure, computeBase: computeBase, compute: compute, statement: statement };
})();

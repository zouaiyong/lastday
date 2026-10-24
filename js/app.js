/* LastDay 应用编排：导航、向导、问答定性、基数与流水解析、结果渲染、本地持久化 */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var STORE_KEY = 'lastday:v1';

  var state = { scenario: null, notice: 'no', note: '' };
  var quizStack = ['q1'];
  var parsedLines = [];

  /* ---------------- 向导问答定义 ---------------- */
  var QUIZ = {
    q1: {
      q: '这次离职是怎么发生的？',
      opts: [
        { t: '公司提出要解除 / 终止合同（劝退、裁员、辞退）', next: 'q2' },
        { t: '合同到期，公司不续签或降低条件续签', set: { scenario: 'expire' } },
        { t: '合同到期，公司维持或提高条件，但我不想续签', set: { scenario: 'resign', note: '单位维持或提高条件而你不同意续签的，无法定经济补偿（第46条第5项）。' } },
        { t: '我自己主动辞职', next: 'q3' }
      ]
    },
    q2: {
      q: '公司给出的说法 / 理由是？',
      opts: [
        { t: '与我协商一致，让我签《协商解除协议》', set: { scenario: 'negotiate' } },
        { t: '医疗期满 / 不能胜任工作 / 部门岗位撤销（客观情况变化）', next: 'q2b' },
        { t: '公司经营困难，批量裁员', set: { scenario: 'layoff' } },
        { t: '直接辞退 / 开除，没走程序或理由站不住', set: { scenario: 'illegal' } },
        { t: '我因为公司拖欠工资 / 不缴社保等问题主动提的离职', set: { scenario: 'forced' } }
      ]
    },
    q2b: {
      q: '公司是否提前30日书面通知，或愿意额外支付1个月工资？',
      opts: [
        { t: '都没有', set: { scenario: 'nofault', notice: 'no' } },
        { t: '有（任一）', set: { scenario: 'nofault', notice: 'yes' } }
      ]
    },
    q3: {
      q: '辞职的原因是？',
      opts: [
        { t: '个人原因 / 职业发展', set: { scenario: 'resign', note: '若公司存在拖欠工资、未缴社保等过错，请勿以“个人原因”辞职——改为依第38条解除可主张 N。' } },
        { t: '公司拖欠工资、未缴社保、未提供劳动条件等', set: { scenario: 'forced' } }
      ]
    }
  };

  function num(id) {
    var v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? 0 : v;
  }

  /* ---------------- 导航 ---------------- */
  function initNav() {
    document.querySelectorAll('#main-nav .nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#main-nav .nav-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.page').forEach(function (p) {
          var on = p.id === 'page-' + btn.dataset.page;
          p.classList.toggle('active', on);
          p.hidden = !on;
        });
        window.scrollTo({ top: 0 });
      });
    });
  }

  /* ---------------- 步骤 ---------------- */
  function gotoStep(n) {
    [1, 2, 3].forEach(function (i) {
      document.getElementById('step-' + i).hidden = (i !== n);
      var li = document.querySelector('.step[data-step="' + i + '"]');
      li.classList.toggle('active', i === n);
      li.classList.toggle('done', i < n);
    });
    if (n === 3) renderResult();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function initSteps() {
    document.getElementById('next-1').addEventListener('click', function () {
      if (!state.scenario) {
        showStepWarn(1, '请先回答上面的问题完成定性（或用“高级”手动选择情形），再进入下一步。');
        return;
      }
      gotoStep(2);
    });
    document.getElementById('next-2').addEventListener('click', function () { gotoStep(3); });
    document.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { gotoStep(parseInt(b.dataset.goto, 10)); });
    });
  }

  function showStepWarn(n, msg) {
    var panel = document.getElementById('step-' + n);
    var old = panel.querySelector('.result-warn');
    if (old) old.remove();
    var div = document.createElement('div');
    div.className = 'result-warn';
    div.setAttribute('role', 'alert');
    div.textContent = msg;
    panel.insertBefore(div, panel.firstChild);
  }

  /* ---------------- 定性问答 ---------------- */
  function renderQuiz() {
    var key = quizStack[quizStack.length - 1];
    var node = QUIZ[key];
    var html = '<div class="quiz-q">' + node.q + '</div><div class="quiz-opts">';
    node.opts.forEach(function (opt, i) {
      html += '<button type="button" class="quiz-opt" data-i="' + i + '">' + opt.t + '</button>';
    });
    html += '</div>';
    if (quizStack.length > 1) {
      html += '<button type="button" class="btn ghost quiz-back">← 上一题</button>';
    }
    var quiz = document.getElementById('quiz');
    quiz.innerHTML = html;
    quiz.querySelectorAll('.quiz-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var opt = node.opts[parseInt(btn.dataset.i, 10)];
        if (opt.next) { quizStack.push(opt.next); renderQuiz(); }
        else setScenario(opt.set || {});
      });
    });
    var back = quiz.querySelector('.quiz-back');
    if (back) back.addEventListener('click', function () { quizStack.pop(); renderQuiz(); });
  }

  function setScenario(set) {
    state.scenario = set.scenario;
    if (set.notice) state.notice = set.notice;
    state.note = set.note || '';
    document.getElementById('manual-scenario').value = state.scenario;
    renderQualResult();
    saveStore();
  }

  function renderQualResult() {
    var box = document.getElementById('qual-result');
    if (!state.scenario) { box.hidden = true; return; }
    var cfg = LayoffRules.SCN[state.scenario];
    var cites = cfg.laws.map(function (id) { return LayoffRules.LAWS[id].cite; }).join('、');
    var html = '<div>初步定性：<strong>' + cfg.label + '</strong><span class="std-badge">' + cfg.std + '</span></div>' +
      '<p class="qual-brief">' + cfg.brief + (state.note ? '<br>' + state.note : '') + '</p>' +
      '<p class="qual-laws">依据：' + cites + '</p>';
    if (state.scenario === 'nofault') {
      html += '<div class="field" style="max-width:420px"><label>是否提前30日书面通知，或额外支付1个月工资？</label>' +
        '<div>' +
        '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;cursor:pointer;font-size:14px"><input type="radio" name="qual-notice" value="no"' + (state.notice === 'no' ? ' checked' : '') + '> 没有（N+1）</label>' +
        '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:14px"><input type="radio" name="qual-notice" value="yes"' + (state.notice === 'yes' ? ' checked' : '') + '> 有（N）</label>' +
        '</div></div>';
    }
    html += '<button type="button" class="link-btn" id="quiz-restart">↺ 重新选择</button>';
    box.innerHTML = html;
    box.hidden = false;
    box.querySelectorAll('input[name="qual-notice"]').forEach(function (r) {
      r.addEventListener('change', function () {
        state.notice = r.value;
        document.getElementById('manual-notice').value = state.notice;
        saveStore();
      });
    });
    document.getElementById('quiz-restart').addEventListener('click', function () {
      state.scenario = null; state.note = '';
      box.hidden = true;
      quizStack = ['q1'];
      renderQuiz();
      saveStore();
    });
  }

  function initManual() {
    var sel = document.getElementById('manual-scenario');
    LayoffRules.SCN_ORDER.forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = LayoffRules.SCN[k].label + '（' + LayoffRules.SCN[k].std + '）';
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      state.scenario = sel.value;
      state.note = '';
      renderQualResult();
      saveStore();
    });
    document.getElementById('manual-notice').addEventListener('change', function (e) {
      state.notice = e.target.value;
      saveStore();
    });
  }

  /* ---------------- 工资构成：说明与清单 ---------------- */
  function initWageHelp() {
    document.querySelectorAll('.help-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var hint = document.getElementById('hint-' + btn.dataset.help);
        if (!hint.innerHTML) {
          var h = LayoffRules.WAGE_HELP[btn.dataset.help] || {};
          hint.innerHTML = (h.include ? '<b>计入：</b>' + h.include : '') +
            (h.exclude ? '<br><span class="no">注意：</span>' + h.exclude : '');
        }
        hint.hidden = !hint.hidden;
      });
    });
    var inc = document.getElementById('wage-include-list');
    var exc = document.getElementById('wage-exclude-list');
    inc.innerHTML = LayoffRules.WAGE_INCLUDE_SUMMARY.map(function (t) { return '<li>' + t + '</li>'; }).join('');
    exc.innerHTML = LayoffRules.WAGE_EXCLUDE_SUMMARY.map(function (t) { return '<li>' + t + '</li>'; }).join('');
    document.getElementById('toggle-wage-ref').addEventListener('click', function (e) {
      e.preventDefault();
      var ref = document.getElementById('wage-ref');
      ref.hidden = !ref.hidden;
    });
  }

  function initDemo() {
    document.getElementById('demo-fill').addEventListener('click', function () {
      if (!state.scenario) setScenario({ scenario: 'negotiate' });
      var demo = {
        'w-fixed': 18000, 'w-perf': 3000, 'w-allow': 1200, 'w-ot': 9600, 'w-other': 0,
        'w-bonus': 66000, 'w-months': 12,
        'd-start': '2019-03-15', 'd-end': '2026-10-20',
        'p-annual': 5, 'p-bonus': 66000, 'input-offer': 170000
      };
      Object.keys(demo).forEach(function (id) { document.getElementById(id).value = demo[id]; });
      gotoStep(3);
      saveStore();
    });
  }

  /* ---------------- 流水粘贴解析 ---------------- */
  function initPaste() {
    document.getElementById('paste-parse').addEventListener('click', function () {
      var text = document.getElementById('paste-input').value;
      parsedLines = WageParser.parse(text);
      renderParsed();
    });
  }

  function renderParsed() {
    var box = document.getElementById('paste-result');
    if (!parsedLines.length) {
      box.innerHTML = '<p class="result-warn">没有解析出金额（每行需含一个 ≥100 的数字），请检查粘贴格式。</p>';
      return;
    }
    var html = '<div class="table-wrap"><table class="parsed-table"><thead><tr><th>摘要</th><th class="num">金额（元）</th><th>归类</th></tr></thead><tbody>';
    parsedLines.forEach(function (l, i) {
      html += '<tr><td>' + l.label + '</td><td class="num">' + LayoffCalc.fmt(l.amount) + '</td><td><select data-i="' + i + '">' +
        WageParser.CATS.map(function (c) {
          return '<option value="' + c.key + '"' + (c.key === l.category ? ' selected' : '') + '>' + c.label + '</option>';
        }).join('') + '</select></td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="paste-actions"><button type="button" class="btn primary" id="paste-apply">应用到工资构成 ↑</button>' +
      '<span class="muted small">按“计算月数”折成月均；银行流水为税后口径，仅作参考下限。</span></div>' +
      '<div id="paste-apply-note"></div>';
    box.innerHTML = html;
    box.querySelectorAll('select').forEach(function (s) {
      s.addEventListener('change', function () { parsedLines[parseInt(s.dataset.i, 10)].category = s.value; });
    });
    document.getElementById('paste-apply').addEventListener('click', applyParsed);
  }

  function applyParsed() {
    var months = Math.max(1, Math.min(12, num('w-months') || 12));
    var s = WageParser.summarize(parsedLines, months);
    document.getElementById('w-fixed').value = Math.round(s.fixed);
    document.getElementById('w-perf').value = Math.round(s.perf);
    document.getElementById('w-allow').value = Math.round(s.allow);
    document.getElementById('w-ot').value = Math.round(s.otTotal);
    document.getElementById('w-other').value = Math.round(s.other);
    if (s.bonus > 0) document.getElementById('w-bonus').value = Math.round(s.bonus);
    var note = document.getElementById('paste-apply-note');
    note.innerHTML = '<p class="parsed-note-ok small">✓ 已按 ' + months + ' 个月折算并填入上方各项' +
      (s.skipped > 0 ? '（' + LayoffCalc.fmt(s.skipped) + ' 元标记为“不计入”，未计入基数）' : '') +
      '。请核对并用工资条 / 个税APP 应发数据校准。</p>';
    saveStore();
  }

  /* ---------------- 结果渲染 ---------------- */
  function collectInputs() {
    return {
      scenario: state.scenario,
      notice: state.notice,
      start: document.getElementById('d-start').value,
      end: document.getElementById('d-end').value,
      wage: {
        fixed: num('w-fixed'), perf: num('w-perf'), allow: num('w-allow'),
        ot: num('w-ot'), other: num('w-other'), bonus: num('w-bonus'), months: num('w-months')
      },
      social: num('p-social'),
      lastmonth: num('p-lastmonth'),
      annualDays: num('p-annual'),
      annualPaid: num('p-annual-paid'),
      bonusStd: num('p-bonus'),
      offer: num('input-offer')
    };
  }

  function renderResult() {
    var body = document.getElementById('result-body');
    body.setAttribute('aria-live', 'polite');
    if (!state.scenario) {
      body.innerHTML = '<div class="result-warn">请先回到第 1 步完成解除定性。</div>';
      resetStatementArea(false);
      return;
    }
    var cfg = LayoffRules.SCN[state.scenario];
    var input = collectInputs();
    var res = LayoffCalc.compute(input, cfg);
    if (!res.ok) {
      body.innerHTML = '<div class="result-warn">' + res.reason + '</div>';
      resetStatementArea(false);
      return;
    }

    var diffCard;
    if (res.diff === null) {
      diffCard = '<div class="stat-card"><div class="stat-label">差额（可能被少算）</div><div class="stat-value">—</div><div class="stat-sub">未填公司方案</div></div>';
    } else if (res.diff > 0) {
      diffCard = '<div class="stat-card negative"><div class="stat-label">差额（可能被少算）</div><div class="stat-value">-' + LayoffCalc.money(res.diff) + '</div><div class="stat-sub">公司方案 ' + LayoffCalc.money(res.offer) + '，低于法定应得</div></div>';
    } else if (res.diff < 0) {
      diffCard = '<div class="stat-card positive"><div class="stat-label">差额</div><div class="stat-value">+' + LayoffCalc.money(-res.diff) + '</div><div class="stat-sub">公司方案高于法定应得，直接收下即可</div></div>';
    } else {
      diffCard = '<div class="stat-card"><div class="stat-label">差额</div><div class="stat-value">¥0</div><div class="stat-sub">与法定应得一致</div></div>';
    }

    var html = '<div class="stat-grid">' +
      '<div class="stat-card"><div class="stat-label">法定月均工资基数</div><div class="stat-value">' + LayoffCalc.money(res.base) + '</div><div class="stat-sub">税前应发口径' + (res.capped ? '（已按社平3倍封顶）' : '') + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">法定应得合计</div><div class="stat-value">' + LayoffCalc.money(res.total) + '</div><div class="stat-sub">' + cfg.label + ' · ' + cfg.std + '</div></div>' +
      diffCard + '</div>';

    html += '<h3 class="sub-head">月均工资基数构成</h3><table class="res-table"><tbody>';
    res.baseParts.forEach(function (p) {
      html += '<tr><td>' + p.label + '</td><td class="calc">' + p.note + '</td><td class="num">' + LayoffCalc.fmt(p.val) + '</td></tr>';
    });
    html += '<tr class="total"><td>月均工资基数</td><td class="calc">税前应发合计</td><td class="num">' + LayoffCalc.fmt(res.base) + '</td></tr></tbody></table>';

    html += '<h3 class="sub-head">补偿明细</h3><table class="res-table"><thead><tr><th>项目</th><th>计算过程</th><th class="num">金额（元）</th></tr></thead><tbody>';
    res.rows.forEach(function (r) {
      html += '<tr><td>' + r.label + '</td><td class="calc">' + r.calc + '</td><td class="num">' + (r.amt === null ? '—' : LayoffCalc.fmt(r.amt)) + '</td></tr>';
    });
    html += '<tr class="total"><td>法定应得合计</td><td></td><td class="num">' + LayoffCalc.fmt(res.total) + '</td></tr></tbody></table>';

    var fixedVal = input.wage.fixed;
    if (fixedVal > 0 && fixedVal < res.base && state.scenario !== 'resign') {
      var lossKey = state.scenario === 'illegal' ? 2 : 1;
      html += '<div class="contrast-box">⚠️ 若只按固定工资 ' + LayoffCalc.money(fixedVal) + ' 计算基数（HR 常见做法），仅' + res.compLabel + '一项就少算 ' + LayoffCalc.money((res.base - fixedVal) * res.nMonths * lossKey) + '。</div>';
    }

    html += '<div class="law-block"><h3>法律依据</h3><ul>' +
      cfg.laws.map(function (id) {
        var l = LayoffRules.LAWS[id];
        return '<li><strong>' + l.cite + '</strong>：' + l.plain + '</li>';
      }).join('') + '</ul>';
    html += '<p class="law-note">工作年限 ' + res.tenure.text + '（' + res.tenure.rule + '），即 ' + res.nMonths + ' 个月工资基数（第47条）。</p>';
    res.notes.forEach(function (n) { html += '<p class="law-note">' + n + '</p>'; });
    if (state.scenario === 'illegal') {
      html += '<p class="law-note">参考：若公司系合法解除（N）≈ ' + LayoffCalc.money(res.nMonths * res.eff) + '。</p>';
    } else if (state.scenario !== 'resign') {
      html += '<p class="law-note">参考：若定性为违法解除（2N）≈ ' + LayoffCalc.money(res.nMonths * 2 * res.eff) + '。</p>';
    }
    html += '</div>';

    body.innerHTML = html;

    /* 公司给足（差额≤0）→ 恭喜文案，不出异议函；少给 → 生成异议函 */
    var needLetter = !(res.diff !== null && res.diff <= 0);
    document.getElementById('statement-wrap').hidden = !needLetter;
    document.getElementById('congrats-wrap').hidden = needLetter;
    document.getElementById('copy-statement').hidden = !needLetter;
    if (needLetter) {
      document.getElementById('statement').value = LayoffCalc.statement(input, res, cfg);
    } else {
      var verdict = res.diff < 0
        ? '公司方案 ' + LayoffCalc.money(res.offer) + ' 高于法定应得 ' + LayoffCalc.money(res.total) + '，多出 ' + LayoffCalc.money(-res.diff) + '——已经给足了，直接收下就行，不用谈也不用发函。'
        : '公司方案与法定应得（' + LayoffCalc.money(res.total) + '）完全一致，一分没少。';
      document.getElementById('congrats-wrap').innerHTML =
        '<h3>🎉 好消息：不需要异议函</h3>' +
        '<p>' + verdict + '</p>' +
        '<p class="muted">收尾只做三件事：① 到账日核对金额与协议一致；② 向公司拿离职证明；③ 办失业登记、申领失业金。若你还有未计入本测算的款项（报销、竞业补偿等），改参数重算即可。</p>';
    }
  }

  function resetStatementArea(showLetter) {
    document.getElementById('congrats-wrap').hidden = true;
    document.getElementById('statement-wrap').hidden = !showLetter;
    document.getElementById('copy-statement').hidden = !showLetter;
    document.getElementById('statement').value = '';
  }

  function initResultActions() {
    document.getElementById('copy-statement').addEventListener('click', function () {
      var ta = document.getElementById('statement');
      function done() {
        var b = document.getElementById('copy-statement');
        b.textContent = '✓ 已复制';
        setTimeout(function () { b.textContent = '复制话术'; }, 1800);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(done);
      } else {
        ta.select();
        document.execCommand('copy');
        done();
      }
    });
    document.getElementById('print-result').addEventListener('click', function () { window.print(); });
    document.getElementById('input-offer').addEventListener('input', function () {
      if (!document.getElementById('step-3').hidden) renderResult();
      saveStore();
    });
  }

  /* ---------------- 坑点自查 ---------------- */
  function initPitfalls() {
    var list = document.getElementById('pitfalls-list');
    var checked = new Set(loadStore().pitfalls || []);
    var html = '';
    LayoffRules.PITFALLS.forEach(function (g) {
      html += '<div class="pit-group"><h3>' + g.group + '</h3>';
      g.items.forEach(function (it, i) {
        var idx = LayoffRules.PITFALLS.indexOf(g) * 100 + i;
        html += '<div class="pit-item' + (checked.has(idx) ? ' checked' : '') + '" data-idx="' + idx + '">' +
          '<input type="checkbox" id="pit-' + idx + '"' + (checked.has(idx) ? ' checked' : '') + '>' +
          '<label for="pit-' + idx + '"><strong>' + it[0] + '</strong><span class="muted small"> — ' + it[1] + '</span></label></div>';
      });
      html += '</div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var item = cb.closest('.pit-item');
        item.classList.toggle('checked', cb.checked);
        var idx = parseInt(item.dataset.idx, 10);
        if (cb.checked) checked.add(idx); else checked.delete(idx);
        updatePitProgress(checked);
        savePitfalls(Array.from(checked));
      });
    });
    document.getElementById('pit-reset').addEventListener('click', function () {
      checked.clear();
      list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
      list.querySelectorAll('.pit-item').forEach(function (el) { el.classList.remove('checked'); });
      updatePitProgress(checked);
      savePitfalls([]);
    });
    updatePitProgress(checked);
  }

  function updatePitProgress(checked) {
    var total = document.querySelectorAll('#pitfalls-list input[type="checkbox"]').length;
    document.getElementById('pit-progress-text').textContent = '已排查 ' + checked.size + ' / ' + total;
    document.getElementById('pit-progress-bar').style.width = total ? (checked.size / total * 100) + '%' : '0';
  }

  /* ---------------- 法条速查 ---------------- */
  function initLaws() {
    var box = document.getElementById('laws-list');
    box.innerHTML = LayoffRules.LAWS_ORDER.map(function (id) {
      var l = LayoffRules.LAWS[id];
      return '<article class="law-item"><h3>' + l.cite + '</h3>' +
        '<p class="law-text">' + l.text + '</p>' +
        '<p class="law-plain">💡 ' + l.plain + '</p></article>';
    }).join('');
  }

  /* ---------------- 本地持久化 ---------------- */
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveStore() {
    var s = loadStore();
    s.scenario = state.scenario;
    s.notice = state.notice;
    s.fields = {};
    document.querySelectorAll('[data-store]').forEach(function (el) {
      s.fields[el.id] = el.value;
    });
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }
  function savePitfalls(arr) {
    var s = loadStore();
    s.pitfalls = arr;
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }
  function restoreStore() {
    var s = loadStore();
    if (s.fields) {
      Object.keys(s.fields).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = s.fields[id];
      });
    }
    if (s.scenario && LayoffRules.SCN[s.scenario]) {
      state.scenario = s.scenario;
      state.notice = s.notice || 'no';
      document.getElementById('manual-scenario').value = state.scenario;
      document.getElementById('manual-notice').value = state.notice;
      renderQualResult();
    }
  }

  function initStoreEvents() {
    document.querySelectorAll('[data-store]').forEach(function (el) {
      el.addEventListener('input', saveStore);
      el.addEventListener('change', saveStore);
    });
    document.getElementById('clear-data').addEventListener('click', function () {
      localStorage.removeItem(STORE_KEY);
      location.reload();
    });
  }

  /* ---------------- 启动 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initSteps();
    renderQuiz();
    initManual();
    initWageHelp();
    initDemo();
    initPaste();
    initResultActions();
    initPitfalls();
    initLaws();
    restoreStore();
    initStoreEvents();
  });
})();

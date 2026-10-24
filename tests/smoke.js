/* 冒烟测试：node tests/smoke.js，验证计算引擎与流水解析的关键数值 */
var fs = require('fs');
var path = require('path');
['rules.js', 'wage.js', 'calc.js'].forEach(function (f) {
  /* 间接 eval：在全局作用域执行，var 声明挂到 globalThis */
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
});

var failures = 0;
function eq(name, actual, expected, eps) {
  eps = eps || 0.51;
  var ok = Math.abs(actual - expected) <= eps;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  actual=' + actual + ' expected=' + expected);
  if (!ok) failures++;
}

/* 工龄折算 */
var t1 = LayoffCalc.tenure('2019-03-15', '2026-10-20');
eq('7年7个月 → 8个月', t1.nMonths, 8);
eq('7年7个月 text', t1.text.indexOf('7年7个月') === 0 ? 1 : 0, 1, 0);
var t2 = LayoffCalc.tenure('2020-01-01', '2026-04-10'); // 6年3个月+ → 6.5
eq('6年3个月 → 6.5个月', t2.nMonths, 6.5);
var t3 = LayoffCalc.tenure('2020-01-10', '2026-07-05'); // 6年5个月25天 <6个月 → 6.5
eq('余5个月25天 → 6.5个月', t3.nMonths, 6.5);
var t4 = LayoffCalc.tenure('2020-01-10', '2026-07-10'); // 恰好6年6个月 ≥6个月 → 7
eq('满6个月 → 7个月', t4.nMonths, 7);
if (LayoffCalc.tenure('2026-01-01', '2026-01-01') !== null) { console.log('FAIL  同日应返回 null'); failures++; }

/* 基数 */
var w = { fixed: 18000, perf: 3000, allow: 1200, ot: 9600, other: 0, bonus: 66000, months: 12 };
var b = LayoffCalc.computeBase(w);
eq('月均基数 28500', b.base, 28500);

/* 协商解除 N：8 × 28500 + 年假 + 年终奖折算 */
var baseInput = {
  scenario: 'negotiate', notice: 'no', start: '2019-03-15', end: '2026-10-20',
  wage: w, social: 0, lastmonth: 0, annualDays: 5, bonusStd: 66000, offer: 170000
};
var r1 = LayoffCalc.compute(baseInput, LayoffRules.SCN.negotiate);
eq('N = 228000', r1.comp, 228000);
eq('年假 2x（日工资剔除加班费）', r1.annAmt, (28500 - 800) / 21.75 * 5 * 2);
eq('年终奖折算 52953', r1.bonusAmt, 66000 * 293 / 365);
eq('合计 293689', r1.total, 228000 + r1.annAmt + r1.bonusAmt);
eq('差额 123689', r1.diff, r1.total - 170000);

/* 违法解除 2N */
var r2 = LayoffCalc.compute(Object.assign({}, baseInput, { scenario: 'illegal' }), LayoffRules.SCN.illegal);
eq('2N = 456000', r2.comp, 456000);

/* N+1：nofault 未提前通知，代通知金回退到基数 */
var r3 = LayoffCalc.compute(Object.assign({}, baseInput, { scenario: 'nofault', notice: 'no', lastmonth: 30000 }), LayoffRules.SCN.nofault);
eq('N+1(按上月30000) = 258000', r3.comp + r3.add1, 228000 + 30000);

/* 3倍社平封顶：社平 12000 → 封顶 36000，本例 28500 未超，不封顶 */
var r4 = LayoffCalc.compute(Object.assign({}, baseInput, { social: 12000 }), LayoffRules.SCN.negotiate);
eq('未超3倍不封顶', r4.eff, 28500);
var r5 = LayoffCalc.compute(Object.assign({}, baseInput, { social: 8000 }), LayoffRules.SCN.negotiate); // 封顶24000
eq('超3倍封顶 24000', r5.eff, 24000);

/* 年假：公司已按1倍折算后，主张补足差额 */
var r6 = LayoffCalc.compute(Object.assign({}, baseInput, { annualDays: 6, annualPaid: 10807.66 }), LayoffRules.SCN.negotiate);
eq('年假扣已折算1倍后的差额', r6.annAmt, Math.max(0, (28500 - 800) / 21.75 * 6 * 2 - 10807.66));

/* 流水解析 */
var lines = WageParser.parse('2026-09-15 代发工资 21,500.00\n8月 工资 21500\nQ3季度奖 9000\n交通补贴 800\n年终奖 66000\n10月 加班费 1500');
eq('解析出6条', lines.length, 6, 0);
eq('首条金额21500', lines[0].amount, 21500);
eq('首条归类fixed', lines[0].category === 'fixed' ? 1 : 0, 1, 0);
eq('季度奖归类perf', lines[2].category === 'perf' ? 1 : 0, 1, 0);
eq('交通补贴归类allow', lines[3].category === 'allow' ? 1 : 0, 1, 0);
eq('年终奖归类bonus', lines[4].category === 'bonus' ? 1 : 0, 1, 0);
var s = WageParser.summarize(lines, 12);
eq('fixed月均 3583', s.fixed, 43000 / 12);
eq('加班费总额 1500', s.otTotal, 1500);
eq('bonus总额 66000', s.bonus, 66000);
/* “10月 工资 21500” 不应把 10 当金额 */
var tricky = WageParser.parse('10月 工资 21500');
eq('月份不误判为金额', tricky.length === 1 && tricky[0].amount === 21500 ? 1 : 0, 1, 0);

/* 话术生成包含关键内容 */
var stmt = LayoffCalc.statement(baseInput, r1, LayoffRules.SCN.negotiate);
['28,500', '228,000', '第47条', '实施条例》第27条'].forEach(function (kw) {
  if (stmt.indexOf(kw) === -1) { console.log('FAIL  话术缺少 ' + kw); failures++; }
  else console.log('PASS  话术包含 ' + kw);
});

console.log(failures === 0 ? '\n全部通过 ✓' : '\n有 ' + failures + ' 项失败 ✗');
process.exit(failures === 0 ? 0 : 1);

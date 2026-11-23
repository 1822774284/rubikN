/* 四阶全流程压力测试：中心 → 12 对翼棱 → 三阶收尾 → 整颗复原校验 */
const fs = require('fs'), path = require('path');
const here = __dirname;
globalThis.window = globalThis;
eval(fs.readFileSync(path.join(here, 'cuben.js'), 'utf8'));
const C = globalThis.CubeN;
globalThis.Cube = require(path.join(here, 'vendor/cube3/cube.js'));
require(path.join(here, 'vendor/cube3/solve.js'));

const N = +(process.argv[2] || 30);
const SCR = +(process.argv[3] || 24);

let pass = 0, fail = 0;
const t0 = Date.now();
const stats = { centers: [], edges: [], tail: [], total: [], attempts: [] };
let bad = [];
for (let i = 0; i < N; i++) {
  const st = C.create(4);
  C.scramble(st, SCR);
  const t1 = Date.now();
  const r = C.solve4(st);
  const dt = Date.now() - t1;
  if (!r.ok) { fail++; bad.push('局 ' + i + '：' + r.err); continue; }
  const chk = C.applySeq(C.clone(st), r.moves);
  if (!C.isSolved(chk)) { fail++; bad.push('局 ' + i + '：回放没复原'); continue; }
  pass++;
  stats.centers.push(r.phases.centers || 0);
  stats.edges.push(r.phases.edges || 0);
  stats.tail.push(r.phases.tail || 0);
  stats.total.push(r.moves.length);
  stats.edges.length && (stats.attempts.push(r.moves.length));
  if (i < 8) console.log('局 ' + i + ' 中心 ' + (r.phases.centers || 0) + ' + 棱 ' + (r.phases.edges || 0) +
    ' + 收尾 ' + (r.phases.tail || 0) + ' = ' + r.moves.length + ' 步，' + dt + 'ms');
}
const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
const mx = a => a.length ? Math.max(...a) : '-';
console.log(`\nOK ${pass}/${N} 失败 ${fail}，用时 ${Date.now() - t0}ms`);
console.log(`中心 均 ${avg(stats.centers)} 最长 ${mx(stats.centers)}｜棱 均 ${avg(stats.edges)} 最长 ${mx(stats.edges)}｜收尾 均 ${avg(stats.tail)} 最长 ${mx(stats.tail)}｜总 均 ${avg(stats.total)} 最长 ${mx(stats.total)}`);
bad.slice(0, 6).forEach(b => console.log('  ' + b));

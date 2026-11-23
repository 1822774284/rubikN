/* 3 阶 / 4 阶模型自检 */
const fs = require('fs'), path = require('path');
const here = __dirname;
globalThis.window = globalThis;
eval(fs.readFileSync(path.join(here, 'cuben.js'), 'utf8'));
const C = globalThis.CubeN;
globalThis.Cube = require(path.join(here, 'vendor/cube3/cube.js'));
require(path.join(here, 'vendor/cube3/solve.js'));

let pass = 0, fail = 0;
function ck(n, ok, d) { if (ok) pass++; else { fail++; console.log('FAIL ' + n + (d ? '  ' + d : '')); } }

for (const N of [3, 4]) {
  const st = C.create(N);
  ck(`${N}: 块数`, st.cubies.length === (N === 3 ? 26 : 56), st.cubies.length);
  ck(`${N}: 已复原`, C.isSolved(st));
  const fl = C.allFacelets(st);
  ck(`${N}: 每面 ${N * N} 格`, C.FACES.every(f => fl[f].length === N * N));
  ck(`${N}: 每面同色`, C.FACES.every(f => new Set(fl[f]).size === 1));
  ck(`${N}: 颜色数`, C.counts(st).every(c => c === N * N), C.counts(st).join(','));

  // R^4 = 复原
  const s2 = C.create(N);
  for (let i = 0; i < 4; i++) C.applyName(s2, 'R');
  ck(`${N}: R^4`, C.isSolved(s2));
  // U R U' R' 不是复原
  const s3 = C.applySeq(C.create(N), "U R U' R'");
  ck(`${N}: 非平凡`, !C.isSolved(s3));
  // 打乱后反解
  const s4 = C.create(N);
  const sc = C.scramble(s4, 12);
  ck(`${N}: 打乱生效`, !C.isSolved(s4));
  const back = C.applySeq(C.create(N), C.scramble(C.create(N), 0).seq); // noop
}

// 3 阶：随机打乱 -> 串行化 -> cubejs 求解 -> 回放
let bad = 0, worst = 0;
const t0 = Date.now();
for (let i = 0; i < 12; i++) {
  const st = C.create(3);
  C.scramble(st, 18);
  const r = C.solve3(st);
  if (!r.ok) { bad++; console.log('solve3 fail', r.err); continue; }
  worst = Math.max(worst, r.moves.length);
}
console.log('3x3 求解 12 局，失败', bad, '最长', worst, '步，用时', Date.now() - t0, 'ms');

// 4 阶：宽层转动后仍合法
const s4 = C.create(4);
C.applyMove(s4, 0, 2, 1);   // 内层
C.applyMove(s4, 2, 1, 2);   // 内层 180
ck('4: 内层转动后颜色计数不变', C.counts(s4).every(c => c === 16), C.counts(s4).join(','));
ck('4: 内层转动后未复原', !C.isSolved(s4));
// 4 阶：复原态还原
const s5 = C.create(4);
C.applyMove(s5, 1, 1, 1);
C.applyMove(s5, 1, 1, 3);
ck('4: 内层转回', C.isSolved(s5));

/* ---- 2 阶：最短解 + 回放 ---- */
const t2 = Date.now();
let bad2 = 0, worst2 = 0;
for (let i = 0; i < 10; i++) {
  const st = C.create(2);
  C.scramble(st, 8);
  const r = C.solve2(st);
  if (!r.ok) { bad2++; console.log('solve2 fail:', r.err); continue; }
  if (!C.isSolved(C.applySeq(C.clone(st), r.moves))) { bad2++; console.log('solve2 回放没复原'); continue; }
  worst2 = Math.max(worst2, r.moves.length);
}
ck('2: 10 局全过', bad2 === 0, '失败 ' + bad2);
console.log('2x2 求解 10 局，最长 ' + worst2 + ' 步，用时 ' + (Date.now() - t2) + 'ms');

/* ---- 4 阶：expand4 的 r 记号（回归测试：曾经把 r2 展开成 "2Rr"，被静默丢掉） ---- */
ck('4: expand4 r -> 2R', C.expand4('r').join(' ') === '2R');
ck('4: expand4 r2 -> 2R2', C.expand4('r2').join(' ') === '2R2');
ck('4: expand4 Rw -> R 2R', C.expand4("Rw'").join(' ') === "R' 2R'");
ck('4: expand4 x', C.expand4('x').join(' ') === "R 2R 2L' L'");

/* ---- 两个 parity 公式必须既不破中心、也不破配对 ---- */
const OLL = C.expand4("Rw U2 x Rw U2 Rw U2 Rw' U2 Lw U2 Rw' U2 Rw U2 Rw' U2 Rw'");
const PLL = C.expand4('r2 U2 r2 Uw2 r2 Uw2');
for (const [nm, seq] of [['OLL', OLL], ['PLL', PLL]]) {
  const st = C.applySeq(C.create(4), seq);
  const info = C.reduceInfo(st);
  ck('4: ' + nm + ' parity 保中心保配对', info.centers === 24 && info.pairs === 12,
    '中心 ' + info.centers + ' 棱 ' + info.pairs);
}

/* ---- 4 阶：棱块配对（中心块不许被破坏） ---- */
const tE = Date.now();
let badE = 0, worstE = 0;
for (let i = 0; i < 6; i++) {
  const st = C.create(4);
  C.scramble(st, 20);
  const cen = C.solve4Centers(st);
  if (!cen.ok) { badE++; continue; }
  const e = C.solve4Edges(cen.state);
  if (!e.ok) { badE++; console.log('solve4Edges fail:', e.err); continue; }
  const chk = C.applySeq(C.clone(cen.state), e.moves);
  const info = C.reduceInfo(chk);
  if (info.centers !== 24 || info.pairs !== 12) { badE++; console.log('配对后 中心 ' + info.centers + ' 棱 ' + info.pairs); continue; }
  worstE = Math.max(worstE, e.moves.length);
}
ck('4: 棱块配对 6 局全过（中心 24/24 + 棱 12/12）', badE === 0, '失败 ' + badE);
console.log('4x4 棱块配对 6 局，最长 ' + worstE + ' 步，用时 ' + (Date.now() - tE) + 'ms');

/* ---- 4 阶全流程：中心 → 配对 → 三阶收尾 ---- */
const t4 = Date.now();
let bad4 = 0, worst4 = 0;
for (let i = 0; i < 8; i++) {
  const st = C.create(4);
  C.scramble(st, 22);
  const r = C.solve4(st);
  if (!r.ok) { bad4++; console.log('solve4 fail:', r.err); continue; }
  if (!C.isSolved(C.applySeq(C.clone(st), r.moves))) { bad4++; console.log('solve4 回放没复原'); continue; }
  worst4 = Math.max(worst4, r.moves.length);
}
ck('4: 全流程 8 局全过', bad4 === 0, '失败 ' + bad4);
console.log('4x4 全流程 8 局，最长 ' + worst4 + ' 步，用时 ' + (Date.now() - t4) + 'ms');

console.log(`\nPASS ${pass}  FAIL ${fail}`);

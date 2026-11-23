/* N×N 魔方模型（N = 3 / 4）：位置 + 旋转矩阵，可反推面片颜色、支持涂色与打乱。
 * 3 阶用 cubejs（vendor/cube3）求最短解；4 阶走「中心块 → 棱块配对 → 三阶收尾」。
 *
 * 坐标：每个小块的 pos 是 0..N-1 的整数；旋转时换算到「以中心为原点」的坐标再转回来。
 * 颜色 id = 面的下标：0 U 黄 / 1 D 白 / 2 F 绿 / 3 B 蓝 / 4 L 橙 / 5 R 红
 */
(function (root) {
  'use strict';

  var FACES = ['U', 'D', 'F', 'B', 'L', 'R'];
  var NORM = { U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], L: [-1, 0, 0], R: [1, 0, 0] };
  /* 每个面摊开在纸上的「上 / 右」，与三视图、cubejs 的展开图一致 */
  var VIEW = {
    U: { up: [0, 0, -1], right: [1, 0, 0] },
    D: { up: [0, 0, 1], right: [1, 0, 0] },
    F: { up: [0, 1, 0], right: [1, 0, 0] },
    B: { up: [0, 1, 0], right: [-1, 0, 0] },
    L: { up: [0, 1, 0], right: [0, 0, 1] },
    R: { up: [0, 1, 0], right: [0, 0, -1] }
  };
  var COLOR_NAME = ['黄', '白', '绿', '蓝', '橙', '红'];
  var COLOR_HEX = ['#ffd100', '#f7f7f2', '#17a05a', '#1b5fbe', '#ff8a1e', '#d8262c'];
  var LETTER = ['U', 'D', 'F', 'B', 'L', 'R'];
  var FACE_IDX = { U: 0, D: 1, F: 2, B: 3, L: 4, R: 5 };

  var I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  var ROT = {
    xp: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    xn: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
    yp: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    yn: [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    zp: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    zn: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]
  };
  function mVec(M, v) {
    return [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
            M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
            M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
  }
  function mMul(A, B) {
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
    return C;
  }
  function mT(M) {
    return [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];
  }
  function faceOfNormal(n) {
    for (var i = 0; i < 6; i++) {
      var f = FACES[i], m = NORM[f];
      if (m[0] === n[0] && m[1] === n[1] && m[2] === n[2]) return f;
    }
    return null;
  }
  function key(p) { return p[0] + ',' + p[1] + ',' + p[2]; }

  /* 标准记号 -> 轴 / 层 / 旋转正负（+1 = 绕正轴右手 +90°） */
  var FACE_MOVE = {
    R: { ax: 0, layer: 'last', sgn: -1 },
    L: { ax: 0, layer: 0, sgn: +1 },
    U: { ax: 1, layer: 'last', sgn: -1 },
    D: { ax: 1, layer: 0, sgn: +1 },
    F: { ax: 2, layer: 'last', sgn: -1 },
    B: { ax: 2, layer: 0, sgn: +1 }
  };

  function create(N) {
    var cubies = [], stickers = [], index = {};
    for (var x = 0; x < N; x++) for (var y = 0; y < N; y++) for (var z = 0; z < N; z++) {
      if (!(x === 0 || x === N - 1 || y === 0 || y === N - 1 || z === 0 || z === N - 1)) continue;
      var faces = [];
      if (x === N - 1) faces.push('R'); if (x === 0) faces.push('L');
      if (y === N - 1) faces.push('U'); if (y === 0) faces.push('D');
      if (z === N - 1) faces.push('F'); if (z === 0) faces.push('B');
      var st = {};
      faces.forEach(function (f) { st[f] = FACE_IDX[f]; });
      index[key([x, y, z])] = cubies.length;
      cubies.push({ home: [x, y, z], pos: [x, y, z], rot: I3 });
      stickers.push(st);
    }
    var at = {};
    cubies.forEach(function (c, i) { at[key(c.pos)] = i; });
    return { N: N, cubies: cubies, stickers: stickers, home: index, at: at };
  }

  /* 绕轴旋转层：axis 0/1/2，layer 0..N-1，n = 1|2|3 个 90° */
  function applyMove(state, axis, layer, n) {
    n = ((n % 4) + 4) % 4;
    if (!n) return state;
    var N = state.N;
    var base = axis === 0 ? 'xp' : axis === 1 ? 'yp' : 'zp';
    var M = I3;
    for (var t = 0; t < n; t++) M = mMul(ROT[base], M);
    var mid = N - 1;
    state.cubies.forEach(function (cu) {
      if (cu.pos[axis] !== layer) return;
      var c = [2 * cu.pos[0] - mid, 2 * cu.pos[1] - mid, 2 * cu.pos[2] - mid];
      var r = mVec(M, c);
      cu.pos = [(r[0] + mid) / 2, (r[1] + mid) / 2, (r[2] + mid) / 2];
      cu.rot = mMul(M, cu.rot);
    });
    var at = {};
    state.cubies.forEach(function (c, i) { at[key(c.pos)] = i; });
    state.at = at;
    return state;
  }

  /* 动作名 → (轴, 层, 旋转正负)，支持 R / 2R 这类内外层记号；层号依赖阶数 */
  function parseMove(name, N) {
    N = N || 3;
    var m = /^(2?)([URFDLB])(['2]?)$/.exec(String(name || '').trim());
    if (!m) return null;
    var letter = m[2], inner = !!m[1];
    var neg = 'LDB'.indexOf(letter) >= 0;
    var ax = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 }[letter];
    var layer = inner ? (neg ? 1 : N - 2) : (neg ? 0 : N - 1);
    if (layer < 0 || layer > N - 1) return null;
    var base = m[3] === '' ? 1 : m[3] === '2' ? 2 : 3;
    return { ax: ax, layer: layer, n: (neg ? 1 : -1) * base };
  }

  /* 标准记号（R / R' / R2 / 2R…） */
  function applyName(state, name) {
    var pm = parseMove(name, state.N);
    if (!pm) return state;
    return applyMove(state, pm.ax, pm.layer, pm.n);
  }
  function applySeq(state, seq) {
    var list = Array.isArray(seq) ? seq : String(seq).trim().split(/\s+/);
    for (var i = 0; i < list.length; i++) if (list[i]) state = applyName(state, list[i]);
    return state;
  }

  /* 面上第 (r,c) 格对应的小块位置 */
  function cellPos(N, f, r, c) {
    var n = NORM[f], up = VIEW[f].up, right = VIEW[f].right;
    var p = [0, 0, 0];
    var axN = n[0] ? 0 : n[1] ? 1 : 2;
    p[axN] = n[axN] > 0 ? N - 1 : 0;
    var axU = up[0] ? 0 : up[1] ? 1 : 2;
    p[axU] = up[axU] > 0 ? (N - 1 - r) : r;
    var axR = right[0] ? 0 : right[1] ? 1 : 2;
    p[axR] = right[axR] > 0 ? c : (N - 1 - c);
    return p;
  }

  function faceletColors(state, f) {
    var N = state.N, out = [];
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var p = cellPos(N, f, r, c);
      var idx = state.at[key(p)];
      var local = faceOfNormal(mVec(mT(state.cubies[idx].rot), NORM[f]));
      out.push(state.stickers[idx][local]);
    }
    return out;
  }

  function allFacelets(state) {
    var out = {};
    FACES.forEach(function (f) { out[f] = faceletColors(state, f); });
    return out;
  }

  function isSolved(state) {
    var fl = allFacelets(state), ok = true;
    FACES.forEach(function (f) {
      var c0 = fl[f][0];
      fl[f].forEach(function (c) { if (c !== c0) ok = false; });
    });
    return ok;
  }

  /* 涂色：把「位置 p、世界面 f」那一格的贴纸改成 colorId */
  function paintAt(state, p, f, colorId) {
    var idx = state.at[key(p)];
    var local = faceOfNormal(mVec(mT(state.cubies[idx].rot), NORM[f]));
    state.stickers[idx][local] = colorId;
    return { cubie: idx, face: local };
  }

  /* 统计每种颜色几格 */
  function counts(state) {
    var c = [0, 0, 0, 0, 0, 0];
    FACES.forEach(function (f) { faceletColors(state, f).forEach(function (x) { c[x]++; }); });
    return c;
  }

  function scramble(state, moves) {
    var N = state.N, faces = 'URFDLB', out = [], last = '';
    for (var i = 0; i < moves; i++) {
      var f;
      do { f = faces[Math.floor(Math.random() * 6)]; } while (f === last);
      last = f;
      var spec = FACE_MOVE[f];
      var outer = spec.layer === 'last' ? N - 1 : 0;
      var layer = outer;
      /* 4 阶：一半概率连内侧层一起转，打乱得更彻底 */
      if (N >= 4 && Math.random() < 0.45) layer = spec.layer === 'last' ? N - 2 : 1;
      var n = 1 + Math.floor(Math.random() * 3);
      applyMove(state, spec.ax, layer, spec.sgn * n);
      out.push(f + (n === 1 ? '' : n === 2 ? '2' : "'"));
    }
    return { state: state, seq: out };
  }

  function clone(state) {
    return {
      N: state.N,
      cubies: state.cubies.map(function (c) {
        return { home: c.home.slice(), pos: c.pos.slice(), rot: c.rot };
      }),
      stickers: state.stickers.map(function (s) {
        var o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k]; }); return o;
      }),
      home: state.home,
      at: Object.assign({}, state.at)
    };
  }

  /* ---- 3 阶求解：交给 cubejs（面片串 = U R F D L B，每面行优先） ---- */
  function serialize(state) {
    var s = '';
    ['U', 'R', 'F', 'D', 'L', 'B'].forEach(function (f) {
      faceletColors(state, f).forEach(function (c) { s += LETTER[c]; });
    });
    return s;
  }

  /* ---- 2 阶：当成「只有角块的三阶」交给同一个求解器 ----
   * 角块照搬，棱/中心填本面颜色；若角块排列是奇置换（三阶不允许，二阶允许），
   * 换一对棱的颜色把奇偶补上再解，求出来的步法在二阶上依然成立。 */
  function build3String(state) {
    var s = '';
    ['U', 'R', 'F', 'D', 'L', 'B'].forEach(function (f) {
      for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
        if (r % 2 === 0 && c % 2 === 0) {
          var p = cellPos(2, f, r / 2, c / 2);
          var idx = state.at[key(p)];
          var local = faceOfNormal(mVec(mT(state.cubies[idx].rot), NORM[f]));
          s += LETTER[state.stickers[idx][local]];
        } else {
          s += f;                     /* 棱和中心：本面颜色（相当于已复原） */
        }
      }
    });
    return s;
  }
  function swapEdges(s) {
    var a = s.split('');
    var UF = [1, 19], UR = [5, 10];   /* U(0,1)+F(0,1) ↔ U(1,2)+R(0,1) */
    var t1 = a[UF[0]], t2 = a[UF[1]];
    a[UF[0]] = a[UR[0]]; a[UF[1]] = a[UR[1]];
    a[UR[0]] = t1; a[UR[1]] = t2;
    return a.join('');
  }

  /* ---- 2 阶最短解：角块双向模式库 + IDA* ---- */
  var PB2 = null;
  var FACT = [1, 1, 2, 6, 24, 120, 720, 5040];
  function axisType(v) { return v[1] ? 0 : v[0] ? 1 : 2; }
  function pos2Idx(p) { return p[0] + 2 * p[1] + 4 * p[2]; }
  function idx2Pos(i) { return [i & 1, (i >> 1) & 1, (i >> 2) & 1]; }
  function rankPerm(a) {
    var r = 0;
    for (var i = 0; i < 8; i++) {
      var c = 0;
      for (var j = i + 1; j < 8; j++) if (a[j] < a[i]) c++;
      r = r * (8 - i) + c;
    }
    return r;
  }
  function unrankPerm(r) {
    var av = [0, 1, 2, 3, 4, 5, 6, 7], out = [];
    for (var i = 0; i < 8; i++) {
      var f = FACT[7 - i], d = Math.floor(r / f);
      r = r % f;
      out.push(av.splice(d, 1)[0]);
    }
    return out;
  }
  function encOri(o) { var r = 0; for (var i = 0; i < 8; i++) r = r * 3 + o[i]; return r; }
  function decOri(r) {
    var o = new Array(8);
    for (var i = 7; i >= 0; i--) { o[i] = r % 3; r = Math.floor(r / 3); }
    return o;
  }

  function build2() {
    if (PB2) return PB2;
    var AXIS = [[0, 1, 0], [1, 0, 0], [0, 0, 1]];
    var spec = { R: [0, 1, -1], L: [0, 0, 1], U: [1, 1, -1], D: [1, 0, 1], F: [2, 1, -1], B: [2, 0, 1] };
    var moves = [];
    Object.keys(spec).forEach(function (f) {
      var ax = spec[f][0], layer = spec[f][1], sgn = spec[f][2];
      var base = ax === 0 ? 'xp' : ax === 1 ? 'yp' : 'zp';
      for (var t = 1; t <= 3; t++) {
        var M = I3;
        var n = ((sgn * t) % 4 + 4) % 4;
        for (var k = 0; k < n; k++) M = mMul(ROT[base], M);
        var st = create(2);
        applyMove(st, ax, layer, sgn * t);
        var src = new Array(8), omap = [];
        for (var dest = 0; dest < 8; dest++) {
          var dp = idx2Pos(dest);
          omap.push(dp[ax] === layer
            ? [axisType(mVec(M, AXIS[0])), axisType(mVec(M, AXIS[1])), axisType(mVec(M, AXIS[2]))]
            : [0, 1, 2]);
        }
        st.cubies.forEach(function (cu) { src[pos2Idx(cu.pos)] = pos2Idx(cu.home); });
        moves.push({ name: f + (t === 1 ? '' : t === 2 ? '2' : "'"), src: src, omap: omap });
      }
    });
    var pdbPerm = new Int8Array(40320).fill(-1), pdbOri = new Int8Array(6561).fill(-1);
    pdbPerm[0] = 0; pdbOri[0] = 0;
    var q = [0], head = 0;
    while (head < q.length) {
      var idx = q[head++], d = pdbPerm[idx], perm = unrankPerm(idx);
      for (var mi = 0; mi < moves.length; mi++) {
        var mv = moves[mi], np = new Array(8);
        for (var dst = 0; dst < 8; dst++) np[dst] = perm[mv.src[dst]];
        var ni = rankPerm(np);
        if (pdbPerm[ni] < 0) { pdbPerm[ni] = d + 1; q.push(ni); }
      }
    }
    var q2 = [0], h2 = 0;
    while (h2 < q2.length) {
      var i2 = q2[h2++], d2 = pdbOri[i2], ori = decOri(i2);
      for (var mj = 0; mj < moves.length; mj++) {
        var mv2 = moves[mj], no = new Array(8);
        for (var dst2 = 0; dst2 < 8; dst2++) {
          var s = mv2.src[dst2];
          no[dst2] = mv2.omap[dst2][ori[s]];
        }
        var ni2 = encOri(no);
        if (pdbOri[ni2] < 0) { pdbOri[ni2] = d2 + 1; q2.push(ni2); }
      }
    }
    PB2 = { moves: moves, pdbPerm: pdbPerm, pdbOri: pdbOri };
    return PB2;
  }

  function coords2(state) {
    var perm = new Array(8), ori = new Array(8);
    for (var i = 0; i < 8; i++) {
      var ci = state.at[key(idx2Pos(i))];
      var cu = state.cubies[ci];
      perm[i] = pos2Idx(cu.home);
      ori[i] = axisType(mVec(cu.rot, [0, cu.home[1] ? 1 : -1, 0]));
    }
    return { perm: perm, ori: ori };
  }

  function solve2opt(state) {
    var P = build2();
    var c0 = coords2(state);
    var perm = c0.perm, ori = c0.ori;
    function h(perm, ori) {
      var a = P.pdbPerm[rankPerm(perm)], b = P.pdbOri[encOri(ori)];
      return a > b ? a : b;
    }
    if (h(perm, ori) === 0) return [];
    var path = [], nodes = 0, LIMIT = 2.5e6;
    function dfs(perm, ori, g, prev) {
      var hh = h(perm, ori);
      if (hh > g) return false;
      if (g === 0) return hh === 0;
      if (++nodes > LIMIT) return false;
      for (var mi = 0; mi < P.moves.length; mi++) {
        var mv = P.moves[mi], f = mv.name[0];
        if (f === prev) continue;
        if (prev && OPP[f] === prev && prev < f) continue;
        var np = new Array(8), no = new Array(8);
        for (var d = 0; d < 8; d++) {
          var s = mv.src[d];
          np[d] = perm[s];
          no[d] = mv.omap[d][ori[s]];
        }
        path.push(mv.name);
        if (dfs(np, no, g - 1, f)) return true;
        path.pop();
      }
      return false;
    }
    for (var d = h(perm, ori); d <= 16; d++) {
      nodes = 0;
      if (dfs(perm, ori, d, null)) return path.slice();
      if (nodes > LIMIT) break;
    }
    return null;
  }
  var OPP = { U: 'D', D: 'U', F: 'B', B: 'F', L: 'R', R: 'L' };

  function solve2(state) {
    /* 先用角块 PDB 求最短解，失败再退回「三阶嵌入」 */
    try {
      var fast = solve2opt(state);
      if (fast && fast.length) {
        var chk0 = applySeq(clone(state), fast);
        if (isSolved(chk0)) return { ok: true, moves: fast };
      }
      if (fast && fast.length === 0) return { ok: true, moves: [] };
    } catch (e) { /* 落到下面的兜底 */ }
    var Cube = root.Cube;
    if (!Cube) return { ok: false, err: '求解器未加载' };
    try { if (!Cube._solverReady) { Cube.initSolver(); Cube._solverReady = true; } }
    catch (e) { return { ok: false, err: '求解器初始化失败' }; }
    var cands = [build3String(state)];
    cands.push(swapEdges(cands[0]));
    for (var i = 0; i < cands.length; i++) {
      var sol;
      try {
        var c = Cube.fromString(cands[i]);
        sol = String(c.solve()).trim().split(/\s+/).filter(Boolean);
      } catch (e) { continue; }
      if (!sol.length) continue;
      var chk = applySeq(clone(state), sol);
      if (isSolved(chk)) return { ok: true, moves: sol };
    }
    return { ok: false, err: '这组配色在物理上不存在（有一格涂错了）' };
  }

  /* ---- 4 阶第一步：拼 24 个中心块 ----
   * 只看 24 个中心槽（槽之间自成闭环），逐面推进：每次找一条 ≤4 步的动作，
   * 让目标面多对一个槽、且已完成的中心面不被破坏。 */
  var C4 = null;
  function build4Centers() {
    if (C4) return C4;
    var slotPos = [], posSlot = {};
    FACES.forEach(function (f) {
      var n = NORM[f], ax = n[0] ? 0 : n[1] ? 1 : 2;
      var others = [0, 1, 2].filter(function (i) { return i !== ax; });
      for (var a = 1; a <= 2; a++) for (var b = 1; b <= 2; b++) {
        var p = [0, 0, 0];
        p[ax] = n[ax] > 0 ? 3 : 0;
        p[others[0]] = a; p[others[1]] = b;
        posSlot[p.join(',')] = slotPos.length;
        slotPos.push({ pos: p, face: f });
      }
    });
    var moves = [];
    for (var ax = 0; ax < 3; ax++) for (var layer = 0; layer < 4; layer++) for (var n2 = 1; n2 <= 3; n2++) {
      var st = create(4);
      applyMove(st, ax, layer, n2);
      var perm = new Array(24), touches = false;
      for (var q = 0; q < 24; q++) {
        var cu = st.cubies[st.at[slotPos[q].pos.join(',')]];
        perm[q] = posSlot[cu.home.join(',')];
        if (perm[q] !== q) touches = true;
      }
      if (touches) moves.push({ ax: ax, layer: layer, n: n2, perm: perm });
    }
    C4 = { slotPos: slotPos, slotFace: slotPos.map(function (s) { return s.face; }), moves: moves };
    return C4;
  }

  function centerColors(state) {
    var P = build4Centers(), out = new Array(24);
    for (var q = 0; q < 24; q++) {
      var ci = state.at[P.slotPos[q].pos.join(',')];
      var cu = state.cubies[ci];
      var homeFace = FACES.filter(function (f) {
        var n = NORM[f], ax = n[0] ? 0 : n[1] ? 1 : 2;
        return cu.home[ax] === (n[ax] > 0 ? 3 : 0);
      })[0];
      out[q] = state.stickers[ci][homeFace];
    }
    return out;
  }
  function permColor(col, perm) {
    var o = new Array(24);
    for (var q = 0; q < 24; q++) o[q] = col[perm[q]];
    return o;
  }
  function faceScore(col, f, slotFace) {
    var fi = FACES.indexOf(f), c = 0;
    for (var q = 0; q < 24; q++) if (slotFace[q] === f && col[q] === fi) c++;
    return c;
  }
  function centersDone(col, sf) {
    return FACES.every(function (f) { return faceScore(col, f, sf) === 4; });
  }

  /* 动作的显示名：轴 0 -> L/2L/2R/R，轴 1 -> D/2D/2U/U，轴 2 -> B/2B/2F/F */
  var LAYER_LETTER = [['L', '2L', '2R', 'R'], ['D', '2D', '2U', 'U'], ['B', '2B', '2F', 'F']];
  function nameOf(ax, layer, n) {
    var base = LAYER_LETTER[ax][layer];
    var neg = base[base.length - 1] === 'L' || base[base.length - 1] === 'D' || base[base.length - 1] === 'B';
    var s = neg ? 1 : -1;                     /* 字母自带的旋转正负 */
    var b = ((s * n) % 4 + 4) % 4;            /* 顺时针 1 / 180 2 / 逆时针 3 */
    return base + (b === 1 ? '' : b === 2 ? '2' : "'");
  }

  function solve4Centers(state) {
    var P = build4Centers();
    var col = centerColors(state);
    var work = clone(state);
    var names = [];
    var order = ['U', 'D', 'F', 'B', 'L', 'R'];
    for (var oi = 0; oi < order.length; oi++) {
      var target = order[oi];
      var locked = order.slice(0, oi);
      var guard = 0;
      while (faceScore(col, target, P.slotFace) < 4 && guard++ < 40) {
        var seq = findCenterSeq(col, target, locked, P);
        if (!seq) return { ok: false, err: '中心块卡在 ' + target + ' 面（' + faceScore(col, target, P.slotFace) + '/4）', moves: names };
        for (var i = 0; i < seq.length; i++) {
          var mv = seq[i];
          work = applyMove(work, mv.ax, mv.layer, mv.n);
          col = permColor(col, mv.perm);
          names.push(nameOf(mv.ax, mv.layer, mv.n));
        }
      }
      if (faceScore(col, target, P.slotFace) < 4) return { ok: false, err: target + ' 面没解开', moves: names };
    }
    return { ok: true, moves: names, state: work };
  }

  function findCenterSeq(col, target, locked, P) {
    var base = faceScore(col, target, P.slotFace);
    var lockedIdx = locked.map(function (f) { return FACES.indexOf(f); });
    var slotFace = P.slotFace;
    var path = [], found = null;
    function good(c) {
      for (var li = 0; li < lockedIdx.length; li++) {
        var fi = lockedIdx[li], cnt = 0;
        for (var q = 0; q < 24; q++) if (slotFace[q] === FACES[fi] && c[q] === fi) cnt++;
        if (cnt !== 4) return false;
      }
      return faceScore(c, target, slotFace) > base;
    }
    function dfs(c, d, lastAx, lastLayer) {
      if (found) return true;
      if (d === 0) { if (good(c)) { found = path.slice(); return true; } return false; }
      for (var mi = 0; mi < P.moves.length; mi++) {
        var mv = P.moves[mi];
        if (mv.ax === lastAx && mv.layer === lastLayer) continue;
        path.push(mv);
        if (dfs(permColor(c, mv.perm), d - 1, mv.ax, mv.layer)) return true;
        path.pop();
      }
      return false;
    }
    for (var d = 1; d <= 4; d++) {
      path.length = 0;
      if (dfs(col, d, -1, -1)) return found;
    }
    return null;
  }

  /* ---- 4 阶降阶进度 + 降阶完成后的三阶收尾 ---- */
  var WING = null;
  function buildWings() {
    if (WING) return WING;
    var list = [], posIdx = {};
    for (var x = 0; x < 4; x++) for (var y = 0; y < 4; y++) for (var z = 0; z < 4; z++) {
      var p = [x, y, z];
      var axes = [];
      for (var i = 0; i < 3; i++) if (p[i] === 0 || p[i] === 3) axes.push(i);
      if (axes.length !== 2) continue;
      var f1 = faceByAxis(axes[0], p[axes[0]] === 3);
      var f2 = faceByAxis(axes[1], p[axes[1]] === 3);
      posIdx[p.join(',')] = list.length;
      list.push({ pos: p, faces: [f1, f2], pair: [FACE_IDX[f1], FACE_IDX[f2]] });
    }
    WING = { list: list, posIdx: posIdx, edges: (function () {
      var byFace = {};
      list.forEach(function (s, i) {
        var k = s.faces.slice().sort().join('');
        (byFace[k] = byFace[k] || []).push(i);
      });
      return Object.keys(byFace).sort().map(function (k) { return byFace[k]; });
    })() };
    return WING;
  }
  function faceByAxis(ax, positive) {
    if (ax === 0) return positive ? 'R' : 'L';
    if (ax === 1) return positive ? 'U' : 'D';
    return positive ? 'F' : 'B';
  }

  /* 某条棱的两个翼棱：各自在槽位两个面上显示的颜色 */
  function edgeColors(state, e) {
    var W = buildWings(), slots = W.edges[e];
    function at(slot) {
      var s = W.list[slot], ci = state.at[s.pos.join(',')], cu = state.cubies[ci];
      return s.faces.map(function (f) {
        return state.stickers[ci][faceOfNormal(mVec(mT(cu.rot), NORM[f]))];
      });
    }
    return [at(slots[0]), at(slots[1])];
  }
  /* 配好 = 同一个棱槽里两个翼棱属于同一条棱（颜色对相同即可，翻转留到奇偶阶段） */
  function edgePaired(state, e) {
    var c = edgeColors(state, e);
    return c[0].slice().sort().join(',') === c[1].slice().sort().join(',');
  }

  /* 每条棱的配对详情：缺的那块跑到哪条棱去了 */
  function edgeReport(state) {
    var W = buildWings(), out = [];
    for (var e = 0; e < 12; e++) {
      var slots = W.edges[e];
      var name = W.list[slots[0]].faces.slice().sort().join('');
      var wantPair = W.list[slots[0]].pair.slice().sort().join(',');
      var miss = [];
      slots.forEach(function (slot) {
        var s = W.list[slot], ci = state.at[s.pos.join(',')], cu = state.cubies[ci];
        var pair = s.faces.map(function (f) {
          return state.stickers[ci][faceOfNormal(mVec(mT(cu.rot), NORM[f]))];
        }).sort().join(',');
        if (pair !== wantPair) {
          var home = W.list[W.posIdx[cu.home.join(',')]];
          miss.push(home.faces.slice().sort().join(''));
        }
      });
      out.push({ edge: name, ok: miss.length === 0, missing: miss });
    }
    return out;
  }
  function reduceInfo(state) {
    var centers = 0, pairs = 0;
    FACES.forEach(function (f) {
      var cells = faceletColors(state, f), mid = [];
      for (var r = 1; r < 3; r++) for (var c = 1; c < 3; c++) mid.push(cells[r * 4 + c]);
      if (mid.every(function (k) { return k === mid[0] && k === FACE_IDX[f]; })) centers += 4;
    });
    for (var e = 0; e < 12; e++) if (edgePaired(state, e)) pairs++;
    return { centers: centers, pairs: pairs, reduced: centers === 24 && pairs === 12 };
  }

  /* 降阶完成后：投影成三阶面片串交给 cubejs，步法按宽层回放。
   * 三阶投影会丢掉「翼棱朝向」，所以降阶态可能是三阶层面无解的那两种奇偶：
   * 单棱翻（OLL parity）和棱/角排列奇偶不一致（PLL parity）。
   * 这里不再靠猜：把「不加 / 只 OLL / 只 PLL / 两种顺序」都试一遍，
   * 每个组合真正投影求解、再回放到模型上，第一个能让整颗复原的就是答案。 */
  function project3(work) {
    var s = '';
    ['U', 'R', 'F', 'D', 'L', 'B'].forEach(function (f) {
      var cells = faceletColors(work, f);
      for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
        var R4 = r === 2 ? 3 : r, C4 = c === 2 ? 3 : c;
        s += LETTER[cells[R4 * 4 + C4]];
      }
    });
    return s;
  }
  function solve4Tail(state) {
    var info = reduceInfo(state);
    if (!info.reduced) {
      return { ok: false, err: '还没降阶完成：中心 ' + info.centers + '/24，棱 ' + info.pairs + '/12' };
    }
    var Cube = root.Cube;
    if (!Cube) return { ok: false, err: '求解器未加载' };
    try { if (!Cube._solverReady) { Cube.initSolver(); Cube._solverReady = true; } }
    catch (e) { return { ok: false, err: '求解器初始化失败' }; }
    var pi = parityInfo(state), guess = [];
    if (pi.flipOdd) guess = guess.concat(OLL_PARITY);
    if (pi.permOdd) guess = guess.concat(PLL_PARITY);
    var all = [guess, [], OLL_PARITY, PLL_PARITY,
               OLL_PARITY.concat(PLL_PARITY), PLL_PARITY.concat(OLL_PARITY)];
    var combos = [];
    for (var i = 0; i < all.length; i++) {
      var dup = false;
      for (var j = 0; j < combos.length; j++) if (combos[j].join(' ') === all[i].join(' ')) dup = true;
      if (!dup) combos.push(all[i]);
    }
    var err = '';
    for (var ci = 0; ci < combos.length; ci++) {
      var pre = combos[ci];
      var work = pre.length ? applySeq(clone(state), pre) : state;
      var sol;
      try {
        sol = String(Cube.fromString(project3(work)).solve()).trim().split(/\s+/).filter(Boolean);
      } catch (e) { err = e && e.message ? e.message : String(e); continue; }
      var moves = pre.concat(sol);
      if (isSolved(applySeq(clone(state), moves))) {
        return { ok: true, moves: moves, parity: pre.length ? 'parity' : 'none' };
      }
    }
    return { ok: false, err: '奇偶校验：几种 parity 组合都试过还是解不出（' + err + '）' };
  }

  /* ---- 4 阶第 2 段：把 24 个翼棱配成 12 对 ----
   * 四条几何事实（都能用模型验证）：
   *   1. 外层转动把一条棱的两个翼棱整体搬到另一条棱 => 外层转动永远不改变配对状态。
   *   2. 内层切片只动本层的 4 个翼棱槽，而这 4 个槽分属 4 条不同的棱
   *      （同一条棱的两个槽在任一内层里最多出现一个），所以一次切片能把 1~2 对合起来。
   *   3. 切片会打乱本层 8 个中心槽，必须靠 S⁻¹ 还回去；可 S⁻¹ 又会把刚合好的翼棱挪走，
   *      所以中间要插一段外层转动 A 当「停靠」，把刚合好的整条棱搬离该切片层。
   *   4. 中心块保不保得住，只看 A 的净转动：切片轴为 ax 时，凡轴 != ax 的 4 个侧面，
   *      字母净转量必须 ≡0 (mod 4)。这样 S·A·S⁻¹ 作用在中心块上只剩「与切片平行的
   *      两个面各自自转」，而这两个面的 4 个槽都不在该切片层里，于是六面依旧整齐。
   * 求解 = 外层摆位（BFS）→ 切片 → 停靠 A → 回切，贪心推进；
   *       走到 10/12 之后最后两条棱常常卡住，就换随机种子重来（每次几十毫秒）。
   */
  var E4 = null, E4_TOPSPAN = 12;
  function build4Edges() {
    if (E4) return E4;
    var WPOS = [], WIDX = {};
    for (var x = 0; x < 4; x++) for (var y = 0; y < 4; y++) for (var z = 0; z < 4; z++) {
      var p = [x, y, z], axes = [];
      for (var i = 0; i < 3; i++) if (p[i] === 0 || p[i] === 3) axes.push(i);
      if (axes.length !== 2) continue;
      var f1 = faceByAxis(axes[0], p[axes[0]] === 3), f2 = faceByAxis(axes[1], p[axes[1]] === 3);
      WIDX[p.join(',')] = WPOS.length;
      WPOS.push({ pos: p, faces: [f1, f2], key: [FACE_IDX[f1], FACE_IDX[f2]].sort().join(',') });
    }
    var SLOT_KEY = WPOS.map(function (w) { return w.key; });
    var EDGES = [], EDGE_OF = [], PARTNER = [], byKey = {};
    WPOS.forEach(function (w, i) { (byKey[w.key] = byKey[w.key] || []).push(i); });
    Object.keys(byKey).sort().forEach(function (k) {
      var s = byKey[k];
      EDGES.push(s);
      EDGE_OF[s[0]] = EDGE_OF[s[1]] = EDGES.length - 1;
      PARTNER[s[0]] = s[1]; PARTNER[s[1]] = s[0];
    });
    /* 中心 24 槽（与 build4Centers 一致） */
    var CPOS = [], CIDX = {};
    FACES.forEach(function (f, fi) {
      var n = NORM[f], ax = n[0] ? 0 : n[1] ? 1 : 2;
      var others = [0, 1, 2].filter(function (i2) { return i2 !== ax; });
      for (var a = 1; a <= 2; a++) for (var b = 1; b <= 2; b++) {
        var q = [0, 0, 0];
        q[ax] = n[ax] > 0 ? 3 : 0;
        q[others[0]] = a; q[others[1]] = b;
        CIDX[q.join(',')] = CPOS.length;
        CPOS.push({ pos: q, face: fi });
      }
    });
    var CFA = CPOS.map(function (c) { return c.face; });
    /* 36 个转动的置换表（翼棱 24 + 中心 24） */
    var MOVES = [], OUTER = [], INNER = [];
    for (var ax = 0; ax < 3; ax++) for (var layer = 0; layer < 4; layer++) for (var n2 = 1; n2 <= 3; n2++) {
      var st = create(4);
      applyMove(st, ax, layer, n2);
      var wp = new Array(24), cp = new Array(24), inv = new Array(24), q2;
      for (q2 = 0; q2 < 24; q2++) {
        wp[q2] = WIDX[st.cubies[st.at[WPOS[q2].pos.join(',')]].home.join(',')];
        cp[q2] = CIDX[st.cubies[st.at[CPOS[q2].pos.join(',')]].home.join(',')];
      }
      for (var d = 0; d < 24; d++) inv[wp[d]] = d;
      var nm = nameOf(ax, layer, n2);
      var fch = nm.replace(/^2/, '').replace(/['2]$/, '');
      var sgn = 'LDB'.indexOf(fch) >= 0 ? 1 : -1;
      var mv = {
        ax: ax, layer: layer, n: n2, wp: wp, inv: inv, cp: cp, name: nm,
        fin: FACE_IDX[fch], outer: layer === 0 || layer === 3,
        inner: layer === 1 || layer === 2,
        turn: ((sgn * n2) % 4 + 4) % 4
      };
      MOVES.push(mv);
      if (mv.outer) OUTER.push(mv); else INNER.push(mv);
    }
    /* 外层转动对 12 条棱的置换 */
    OUTER.forEach(function (mv) {
      mv.edgeMap = new Array(12);
      for (var e = 0; e < 12; e++) {
        var a = EDGE_OF[mv.inv[EDGES[e][0]]], b = EDGE_OF[mv.inv[EDGES[e][1]]];
        mv.edgeMap[e] = a === b ? a : e;
      }
    });
    var FACE_AXIS = FACES.map(function (f) { var n = NORM[f]; return n[0] ? 0 : n[1] ? 1 : 2; });
    E4 = {
      WPOS: WPOS, WIDX: WIDX, SLOT_KEY: SLOT_KEY, EDGES: EDGES, EDGE_OF: EDGE_OF, PARTNER: PARTNER,
      CPOS: CPOS, CIDX: CIDX, CFA: CFA, MOVES: MOVES, OUTER: OUTER, INNER: INNER,
      FACE_AXIS: FACE_AXIS, A_CACHE: {}
    };
    return E4;
  }

  function e4Wings(state) {
    var P4 = build4Edges(), out = new Array(24);
    for (var q = 0; q < 24; q++) {
      out[q] = P4.WIDX[state.cubies[state.at[P4.WPOS[q].pos.join(',')]].home.join(',')];
    }
    return out;
  }
  function e4ApplyW(S, mv) {
    var o = new Array(24);
    for (var d = 0; d < 24; d++) o[d] = S[mv.wp[d]];
    return o;
  }
  function e4ApplyWSeq(S, seq) { for (var i = 0; i < seq.length; i++) S = e4ApplyW(S, seq[i]); return S; }
  function e4PairFlags(S) {
    var P4 = build4Edges(), out = [];
    for (var e = 0; e < 12; e++) out.push(P4.SLOT_KEY[S[P4.EDGES[e][0]]] === P4.SLOT_KEY[S[P4.EDGES[e][1]]]);
    return out;
  }
  function e4PairCount(S) {
    var f = e4PairFlags(S), c = 0;
    for (var i = 0; i < 12; i++) if (f[i]) c++;
    return c;
  }
  /* 从 (p1,p2) 出发，用外层转动能把两块摆到哪些槽对（≤276 个状态） */
  function e4Place(p1, p2) {
    var P4 = build4Edges();
    function pk(a, b) { return a < b ? a + ',' + b : b + ',' + a; }
    var seen = {}, frontier = [[p1, p2]];
    seen[pk(p1, p2)] = [];
    for (var d = 0; d < 7; d++) {
      var nxt = [];
      for (var fi = 0; fi < frontier.length; fi++) {
        var a = frontier[fi][0], b = frontier[fi][1], w = seen[pk(a, b)];
        for (var mi = 0; mi < P4.OUTER.length; mi++) {
          var mv = P4.OUTER[mi], na = mv.inv[a], nb = mv.inv[b], k2 = pk(na, nb);
          if (seen[k2]) continue;
          seen[k2] = w.concat([mv]);
          nxt.push([na, nb]);
        }
      }
      if (!nxt.length) break;
      frontier = nxt;
    }
    return seen;
  }
  /* 停靠段 A 的候选表：轴 ax 上「侧面净转 ≡0 (mod 4)」且把起点棱搬出该轴内层的外层串 */
  function e4ParkTable(ax, K) {
    var P4 = build4Edges(), cacheKey = ax + ':' + K;
    if (P4.A_CACHE[cacheKey]) return P4.A_CACHE[cacheKey];
    var pos = {}, sidx = 0;
    P4.FACE_AXIS.forEach(function (fa, f) { if (fa !== ax) pos[f] = sidx++; });
    var goal = {};
    for (var e = 0; e < 12; e++) {
      var a = P4.EDGES[e][0], b = P4.EDGES[e][1];
      if (P4.WPOS[a].pos[ax] === 1 || P4.WPOS[a].pos[ax] === 2) continue;
      if (P4.WPOS[b].pos[ax] === 1 || P4.WPOS[b].pos[ax] === 2) continue;
      goal[e] = true;
    }
    var res = [];
    for (var s = 0; s < 12; s++) res.push([]);
    for (var start = 0; start < 12; start++) {
      if (goal[start]) { res[start].push([]); continue; }
      var seen = {}, frontier = [{ e: start, net: [0, 0, 0, 0], seq: [] }];
      seen[start + '|0000'] = true;
      for (var d = 0; d < 6 && frontier.length && res[start].length < K; d++) {
        var nxt = [];
        for (var ni = 0; ni < frontier.length; ni++) {
          var node = frontier[ni];
          for (var mi = 0; mi < P4.OUTER.length; mi++) {
            var mv = P4.OUTER[mi], net = node.net.slice();
            var sp = pos[mv.fin];
            if (sp !== undefined) net[sp] = (net[sp] + mv.turn) % 4;
            var e2 = mv.edgeMap[node.e], k3 = e2 + '|' + net.join('');
            if (seen[k3]) continue;
            seen[k3] = true;
            var seq = node.seq.concat([mv]);
            var zero = net[0] === 0 && net[1] === 0 && net[2] === 0 && net[3] === 0;
            if (goal[e2] && zero) { if (res[start].length < K) res[start].push(seq); }
            else nxt.push({ e: e2, net: net, seq: seq });
          }
        }
        frontier = nxt;
      }
    }
    P4.A_CACHE[cacheKey] = res;
    return res;
  }
  function e4Shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function e4Compose(x, y) {
    var o = new Array(24);
    for (var d = 0; d < 24; d++) o[d] = x[y[d]];
    return o;
  }
  function e4Inverse(mv) {
    var P4 = build4Edges();
    for (var i = 0; i < P4.MOVES.length; i++) {
      var m = P4.MOVES[i];
      if (m.ax === mv.ax && m.layer === mv.layer && m.n === (4 - mv.n) % 4) return m;
    }
    return mv;
  }
  /* 「外科」夹心：外层公式 A（翼棱只动少数槽）套在切片里 S·A·S⁻¹。
   * 普通摆位夹心在最后两条棱上常常无解，这组能补上；
   * 只留中心块「每面自换」的那些。 */
  var E4_SURG = null;
  function e4Surgeons() {
    if (E4_SURG) return E4_SURG;
    var P4 = build4Edges();
    var ALGS = [
      "R U R' U' R' F R2 U' R' U' R U R' F'",                    /* T perm：换两组整对 */
      "R2 U R U R' U' R' U' R' U R'",                            /* Ub：三循环 */
      "R U' R U R U R U' R' U' R2",                              /* Ua */
      "R U R' F' R U R' U' R' F R2 U' R'",                       /* Jb */
      "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R",          /* F perm */
      "F R U' R' U' R U R' F' R U R' U' R' F R F'",              /* Y perm */
      "2R2 B2 U2 2L U2 2R' U2 2R U2 F2 2R F2 2L' B2 2R2",        /* 单棱翻转 15 步 */
      "R U R' F R' F' R"                                         /* 经典翻棱 7 步 */
    ];
    var out = [];
    ALGS.forEach(function (str) {
      var names = expand4(str), moves = [], i;
      for (i = 0; i < names.length; i++) {
        var mv = null, j;
        for (j = 0; j < P4.MOVES.length; j++) if (P4.MOVES[j].name === names[i]) { mv = P4.MOVES[j]; break; }
        if (!mv) return;
        moves.push(mv);
      }
      var st = create(4);
      applySeq(st, names);
      var aw = new Array(24), ac = new Array(24);
      for (i = 0; i < 24; i++) {
        aw[i] = P4.WIDX[st.cubies[st.at[P4.WPOS[i].pos.join(',')]].home.join(',')];
        ac[i] = P4.CIDX[st.cubies[st.at[P4.CPOS[i].pos.join(',')]].home.join(',')];
      }
      P4.INNER.forEach(function (mv) {
        var back = e4Inverse(mv);
        var cw = e4Compose(e4Compose(mv.wp, aw), back.wp);
        var cc = e4Compose(e4Compose(mv.cp, ac), back.cp);
        var ok = true, sup = 0;
        for (var q = 0; q < 24; q++) {
          if (P4.CFA[cc[q]] !== P4.CFA[q]) { ok = false; break; }
          if (cw[q] !== q) sup++;
        }
        if (!ok || sup === 0 || sup > 8) return;
        out.push({ w: cw, sup: sup, seq: [mv].concat(moves, [back]) });
      });
    });
    E4_SURG = out;
    return out;
  }
  /* 一次把「所有能让配对变多的动作串」都列出来（普通夹心 + 外科夹心），
   * 按「配对数最多、步数最短」筛选，留前 K 条给上层挑 / 回溯。 */
  function e4Candidates(S, rnd) {
    var P4 = build4Edges(), before = e4PairCount(S), flags = e4PairFlags(S);
    var order = [], pool = [];
    for (var e = 0; e < 12; e++) if (!flags[e]) order.push(e);
    e4Shuffle(order, rnd);
    var oi, side, q, ki, si, ai, te, sd, sgi;
    for (oi = 0; oi < order.length; oi++) {
      var e0 = order[oi];
      for (side = 0; side < 2; side++) {
        var pW = P4.EDGES[e0][side], pO = -1;
        for (q = 0; q < 24; q++) {
          if (q !== pW && q !== P4.PARTNER[pW] && P4.SLOT_KEY[S[q]] === P4.SLOT_KEY[S[pW]]) { pO = q; break; }
        }
        if (pO < 0) continue;
        var reach = e4Place(pW, pO);
        for (ki = 0; ki < P4.INNER.length; ki++) {
          var mv = P4.INNER[ki];
          var back = e4Inverse(mv), slots = [], qq;
          for (qq = 0; qq < 24; qq++) if (P4.WPOS[qq].pos[mv.ax] === mv.layer) slots.push(qq);
          for (si = 0; si < slots.length; si++) {
            var in1 = slots[si], in2 = P4.PARTNER[in1], slotA = mv.wp[in1];
            var want = slotA < in2 ? slotA + ',' + in2 : in2 + ',' + slotA;
            var q1 = reach[want];
            if (!q1) continue;
            var eNow = P4.EDGE_OF[in1];
            var As = e4ParkTable(mv.ax, 6)[eNow];
            for (ai = 0; ai < As.length; ai++) {
              var A = As[ai];
              var T = e4ApplyWSeq(S, q1);
              T = e4ApplyW(T, mv);
              if (A.length) T = e4ApplyWSeq(T, A);
              T = e4ApplyW(T, back);
              if (P4.SLOT_KEY[T[P4.EDGES[eNow][0]]] !== P4.SLOT_KEY[T[P4.EDGES[eNow][1]]]) continue;
              var cnt = e4PairCount(T);
              if (cnt <= before) continue;
              var seq = q1.concat([mv], A, [back]);
              pool.push({ seq: seq, cnt: cnt, names: seq.map(function (m) { return m.name; }) });
            }
          }
        }
      }
    }
    /* 外科夹心：把目标两块摆到位后，直接套 S·A·S⁻¹（A 是外层公式） */
    var surgs = e4Surgeons();
    for (oi = 0; oi < order.length; oi++) {
      var e2 = order[oi];
      for (sd = 0; sd < 2; sd++) {
        var w1 = P4.EDGES[e2][sd], w2 = -1, q3;
        for (q3 = 0; q3 < 24; q3++) {
          if (q3 !== w1 && q3 !== P4.PARTNER[w1] && P4.SLOT_KEY[S[q3]] === P4.SLOT_KEY[S[w1]]) { w2 = q3; break; }
        }
        if (w2 < 0) continue;
        var r2 = e4Place(w1, w2);
        for (sgi = 0; sgi < surgs.length; sgi++) {
          var sg = surgs[sgi];
          for (te = 0; te < 12; te++) {
            var ka = sg.w[P4.EDGES[te][0]], kb = sg.w[P4.EDGES[te][1]];
            var kq = ka < kb ? ka + ',' + kb : kb + ',' + ka;
            var qq2 = r2[kq];
            if (!qq2) continue;
            var T2 = e4ApplyW(e4ApplyWSeq(S, qq2), { wp: sg.w });
            var cnt2 = e4PairCount(T2);
            if (cnt2 <= before) continue;
            var seq2 = qq2.concat(sg.seq);
            pool.push({ seq: seq2, cnt: cnt2, names: seq2.map(function (m) { return m.name; }) });
          }
        }
      }
    }
    if (!pool.length) return [];
    var bestCnt = 0, i2;
    for (i2 = 0; i2 < pool.length; i2++) if (pool[i2].cnt > bestCnt) bestCnt = pool[i2].cnt;
    var top = pool.filter(function (c) { return c.cnt === bestCnt; });
    top.sort(function (a, b) { return a.seq.length - b.seq.length; });
    /* 候选要「短 + 杂」：短的解干净，杂的才能走出不同的收尾局面 */
    var keep = top.slice(0, 5);
    var rest = top.slice(5);
    e4Shuffle(rest, rnd);
    for (var ri = 0; ri < rest.length && keep.length < E4_TOPSPAN; ri++) keep.push(rest[ri]);
    e4Shuffle(keep, rnd);
    return keep;
  }
  /* 兼容旧调用：挑一条候选 */
  function e4FindStep(S, rnd) {
    var cands = e4Candidates(S, rnd);
    if (!cands.length) return null;
    return cands[0];
  }
  function rngFrom(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  /* 把 24 个翼棱配成 12 对：有时间预算的「深度优先 + 回溯 + 扰动」。
   * 配对走到 10/12 时最后两条棱最麻烦：需要的净动作是「一次跨棱换位 + 一次同棱翻转」，
   * 而夹心能给出的净动作是「外层公式被切片共轭」。某些朝向组合下这一步不存在 ——
   * 这时先退回上一步换候选（回溯），还不行就随机踢一脚（换两组整对的位置，配对不变），
   * 让收尾局面变成可解的那种。 */
  var E4_KICK_SUP = { 3: 1, 4: 1, 6: 1 };
  function solve4Edges(state, opts) {
    opts = opts || {};
    var budgetMs = opts.budgetMs || 2000;
    var nodes = opts.nodes || 60;
    var t0 = Date.now();
    var base = e4Wings(state);
    var kicks = e4Surgeons().filter(function (s) { return E4_KICK_SUP[s.sup] === 1; });
    for (var round = 0; round < 48; round++) {
      if (Date.now() - t0 > budgetMs) break;
      var rnd = rngFrom(0x9e3779b9 ^ (round * 2654435761));
      var start = base, head = [];
      if (round > 0 && kicks.length) {          /* 第 2 次起先踢一脚（偶数轮踢两脚） */
        var nk = (round % 3 === 0) ? 2 : 1;
        for (var kj = 0; kj < nk; kj++) {
          var kick = kicks[Math.floor(rnd() * kicks.length)];
          start = e4ApplyWSeq(start, kick.seq);
          head = head.concat(kick.seq.map(function (m) { return m.name; }));
        }
      }
      var root2 = { S: start, cands: e4Candidates(start, rnd), idx: 0, names: head };
      var stack = [root2], used = 0, found = null;
      while (stack.length && used < nodes) {
        var top = stack[stack.length - 1];
        if (e4PairCount(top.S) === 12) { found = top; break; }
        if (!top.cands || top.idx >= top.cands.length) { stack.pop(); continue; }
        var cand = top.cands[top.idx++];
        var S2 = e4ApplyWSeq(top.S, cand.seq);
        used++;
        stack.push({ S: S2, cands: e4Candidates(S2, rnd), idx: 0, names: top.names.concat(cand.names) });
      }
      if (!found) continue;
      var chk = applySeq(clone(state), found.names);
      var info = reduceInfo(chk);
      if (info.centers === 24 && info.pairs === 12) {
        return { ok: true, moves: found.names, rounds: round + 1 };
      }
    }
    return { ok: false, err: '棱块配对：这局在时间预算内没找到能收尾的解法' };
  }
  /* 四阶一把梭：中心 → 配对 → 三阶收尾 */
  function solve4(state, opts) {
    var work = clone(state), out = [], phases = {};
    var info = reduceInfo(work);
    if (info.centers < 24) {
      var c = solve4Centers(work);
      if (!c.ok) return { ok: false, err: c.err, moves: out, phases: phases };
      out = out.concat(c.moves);
      phases.centers = c.moves.length;
      work = applySeq(work, c.moves);
    }
    info = reduceInfo(work);
    if (info.pairs < 12) {
      var eg = solve4Edges(work, opts);
      if (!eg.ok) return { ok: false, err: eg.err, moves: out, phases: phases };
      out = out.concat(eg.moves);
      phases.edges = eg.moves.length;
      work = applySeq(work, eg.moves);
    }
    var tail = solve4Tail(work);
    if (!tail.ok) return { ok: false, err: tail.err, moves: out, phases: phases };
    out = out.concat(tail.moves);
    phases.tail = tail.moves.length;
    work = applySeq(work, tail.moves);
    if (!isSolved(work)) return { ok: false, err: '四阶收尾校验失败（最后状态没复原）', moves: out, phases: phases };
    return { ok: true, moves: out, phases: phases };
  }

  /* 四阶专用的动作展开：Rw（宽层）、r（内层）、x/y/z（整魔方转） */
  function expand4(str) {
    var out = [];
    String(str).trim().split(/\s+/).forEach(function (tok) {
      if (!tok) return;
      if (tok === 'x') { out.push('R', '2R', "2L'", "L'"); return; }
      if (tok === 'y') { out.push('U', '2U', "2D'", "D'"); return; }
      if (tok === 'z') { out.push('F', '2F', "2B'", "B'"); return; }
      var m = /^(r)(['2]?)$/.exec(tok);
      if (m) { out.push('2R' + m[2]); return; }   /* 注意取第 2 组：r2 -> 2R2 */
      m = /^([URFDLB])w(['2]?)$/.exec(tok);
      if (m) { out.push(m[1] + m[2], '2' + m[1] + m[2]); return; }
      out.push(tok);
    });
    return out;
  }
  var OLL_PARITY = expand4("Rw U2 x Rw U2 Rw U2 Rw' U2 Lw U2 Rw' U2 Rw U2 Rw' U2 Rw'");
  var PLL_PARITY = expand4("r2 U2 r2 Uw2 r2 Uw2");

  /* 三阶投影的奇偶诊断：翻棱数奇偶、棱/角排列奇偶 */
  function parityInfo(state) {
    var W = buildWings();
    var edges = [], edgesSlot = [], corners = [], cornersSlot = [];
    var flips = 0;
    for (var e = 0; e < 12; e++) {
      var slots = W.edges[e];
      var s = W.list[slots[0]], ci = state.at[s.pos.join(',')], cu = state.cubies[ci];
      var got = s.faces.map(function (f) {
        return state.stickers[ci][faceOfNormal(mVec(mT(cu.rot), NORM[f]))];
      });
      /* 翻转：该块的 U/D 色是否在水平面上 */
      var flipped;
      if (got[0] === 0 || got[0] === 1) flipped = ('UD'.indexOf(s.faces[0]) >= 0) ? 0 : 1;
      else flipped = ('UD'.indexOf(s.faces[1]) >= 0) ? 0 : 1;
      flips += flipped;
      edges.push(got.slice().sort().join(','));
      edgesSlot.push(s.pair.slice().sort().join(','));
    }
    /* 角：8 个角位置 */
    for (var x = 0; x < 2; x++) for (var y = 0; y < 2; y++) for (var z = 0; z < 2; z++) {
      var p = [x === 0 ? 0 : 3, y === 0 ? 0 : 3, z === 0 ? 0 : 3];
      var ci2 = state.at[p.join(',')], cu2 = state.cubies[ci2];
      var faces = [x ? 'R' : 'L', y ? 'U' : 'D', z ? 'F' : 'B'];
      var got2 = faces.map(function (f) {
        return state.stickers[ci2][faceOfNormal(mVec(mT(cu2.rot), NORM[f]))];
      });
      corners.push(got2.slice().sort().join(','));
      cornersSlot.push(faces.map(function (f) { return FACE_IDX[f]; }).sort().join(','));
    }
    function permParity(a, b) {
      /* b 是目标序列，返回把 a 排成 b 的置换奇偶（-1 表示不匹配） */
      var idx = {};
      b.forEach(function (k, i) { idx[k] = i; });
      var perm = a.map(function (k) { return idx[k]; });
      if (perm.some(function (v) { return v === undefined; })) return -1;
      var seen = new Array(perm.length).fill(false), par = 0;
      for (var i = 0; i < perm.length; i++) {
        if (seen[i]) continue;
        var len = 0, j = i;
        while (!seen[j]) { seen[j] = true; j = perm[j]; len++; }
        par ^= (len - 1) & 1;
      }
      return par;
    }
    var ep = permParity(edges, edgesSlot), cp = permParity(corners, cornersSlot);
    return {
      flipOdd: (flips % 2) === 1,
      flips: flips,
      edgeParity: ep, cornerParity: cp,
      permOdd: ep >= 0 && cp >= 0 && ep !== cp
    };
  }

  function solve3(state) {
    var Cube = root.Cube;
    if (!Cube) return { ok: false, err: '求解器未加载' };
    try {
      if (!Cube._solverReady) { Cube.initSolver(); Cube._solverReady = true; }
      var c = Cube.fromString(serialize(state));
      var sol = c.solve();
      var moves = String(sol).trim().split(/\s+/).filter(Boolean);
      /* 验证一遍，防止涂色本身不合法 */
      var chk = applySeq(clone(state), moves);
      if (!isSolved(chk)) return { ok: false, err: '这组配色在物理上不存在（有一格涂错了）' };
      return { ok: true, moves: moves };
    } catch (e) {
      return { ok: false, err: '这组配色不合法：' + (e && e.message ? e.message : e) };
    }
  }

  var MOVE_CN = { R: '右层', L: '左层', U: '上层', D: '下层', F: '前层', B: '后层' };
  var SIDE_CN = [['左层', '左内层', '右内层', '右层'],
                 ['下层', '下内层', '上内层', '上层'],
                 ['后层', '后内层', '前内层', '前层']];
  var SIDE_EDGE = [['左层', '右层'], ['下层', '上层'], ['后层', '前层']];
  function describeMove(name, N) {
    N = N || 4;
    var pm = parseMove(name, N);
    var suf = String(name).replace(/^2?[URFDLB]/, '');
    var dir = suf === '' ? '顺时针 90°' : suf === "'" ? '逆时针 90°' : '转 180°';
    if (!pm) return String(name);
    var side;
    if (pm.layer === 0) side = SIDE_EDGE[pm.ax][0];
    else if (pm.layer === N - 1) side = SIDE_EDGE[pm.ax][1];
    else if (N === 3) side = '中层';
    else side = pm.layer === N - 2 ? SIDE_CN[pm.ax][2] : SIDE_CN[pm.ax][1];
    return side + ' ' + dir;
  }

  root.CubeN = {
    FACES: FACES, NORM: NORM, VIEW: VIEW, COLOR_NAME: COLOR_NAME, COLOR_HEX: COLOR_HEX,
    create: create, applyMove: applyMove, applyName: applyName, applySeq: applySeq, clone: clone,
    parseMove: parseMove, expand4: expand4, parityInfo: parityInfo,
    allFacelets: allFacelets, faceletColors: faceletColors, isSolved: isSolved,
    paintAt: paintAt, counts: counts, scramble: scramble, cellPos: cellPos,
    serialize: serialize, solve2: solve2, solve3: solve3,
    solve4Centers: solve4Centers, solve4Tail: solve4Tail, reduceInfo: reduceInfo,
    edgeReport: edgeReport, centersDone: centersDone, nameOf: nameOf,
    build4Centers: build4Centers, describeMove: describeMove,
    solve4Edges: solve4Edges, solve4: solve4, build4Edges: build4Edges,
    e4Wings: e4Wings, e4PairCount: e4PairCount, e4PairFlags: e4PairFlags,
    e4FindStep: e4FindStep, e4ApplyWSeq: e4ApplyWSeq, e4Surgeons: e4Surgeons,
    mVec: mVec, mT: mT, faceOfNormal: faceOfNormal
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

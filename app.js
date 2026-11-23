/* 三阶 / 四阶 · 3D 交互与解算界面（共用一份 UI） */
(function () {
  'use strict';
  var C = window.CubeN;
  var N = 3;                       /* 当前阶数 */
  var state = C.create(N);
  var mode = 'turn';
  var paintColor = 0;
  var FAST = false;

  /* ---------------- three.js ---------------- */
  var canvas = document.getElementById('stage');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if (THREE.ColorManagement && 'enabled' in THREE.ColorManagement) THREE.ColorManagement.enabled = true;
  if (THREE.SRGBColorSpace && 'outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else if (THREE.sRGBEncoding !== undefined && 'outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  var dist = 10.0, yaw = 0.68, pitch = 1.03;

  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  var L1 = new THREE.DirectionalLight(0xffffff, 0.55); L1.position.set(6, 9, 7); scene.add(L1);
  var L2 = new THREE.DirectionalLight(0xa9d4ff, 0.30); L2.position.set(-7, -6, -5); scene.add(L2);
  var L3 = new THREE.DirectionalLight(0xffffff, 0.22); L3.position.set(-4, 8, -8); scene.add(L3);

  var bodyMat = new THREE.MeshPhongMaterial({ color: 0x1b2231, shininess: 22, specular: 0x1a2130 });
  var bodyGeo = new THREE.BoxGeometry(0.955, 0.955, 0.955);

  function roundedRect(w, h, r) {
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return new THREE.ShapeGeometry(s, 5);
  }
  var stickerGeo = roundedRect(0.84, 0.84, 0.1);

  var cubies = [], stickerMeshes = [], pickables = [], meshOf = [];
  var cubeRoot = new THREE.Group();
  scene.add(cubeRoot);

  function worldPos(p) {
    var mid = (N - 1) / 2;
    return [p[0] - mid, p[1] - mid, p[2] - mid];
  }

  function build() {
    /* 清掉旧的 */
    cubies.forEach(function (g) { cubeRoot.remove(g); });
    cubies = []; stickerMeshes = []; meshOf = [];
    state.stickers.forEach(function (st, i) {
      var g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, bodyMat));
      meshOf[i] = {};
      Object.keys(st).forEach(function (face) {
        var n = C.NORM[face];
        var mat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 42, specular: 0x333333 });
        var m = new THREE.Mesh(stickerGeo, mat);
        m.position.set(n[0] * 0.479, n[1] * 0.479, n[2] * 0.479);
        m.lookAt(new THREE.Vector3(n[0] * 3, n[1] * 3, n[2] * 3));
        m.userData = { cubie: i, face: face };
        g.add(m);
        stickerMeshes.push(m);
        meshOf[i][face] = m;
      });
      cubeRoot.add(g);
      cubies.push(g);
    });
    pickables = stickerMeshes;
  }

  function refreshColors() {
    state.stickers.forEach(function (st, i) {
      Object.keys(st).forEach(function (face) {
        meshOf[i][face].material.color.setStyle(C.COLOR_HEX[st[face]]);
      });
    });
  }

  var _m4 = new THREE.Matrix4();
  function sync() {
    for (var i = 0; i < state.cubies.length; i++) {
      var cu = state.cubies[i], g = cubies[i], r = cu.rot, w = worldPos(cu.pos);
      g.position.set(w[0], w[1], w[2]);
      _m4.set(r[0][0], r[0][1], r[0][2], 0,
             r[1][0], r[1][1], r[1][2], 0,
             r[2][0], r[2][1], r[2][2], 0,
             0, 0, 0, 1);
      g.quaternion.setFromRotationMatrix(_m4);
      g.updateMatrixWorld(true);
    }
  }

  function updateCam() {
    camera.position.set(dist * Math.sin(pitch) * Math.sin(yaw),
                        dist * Math.cos(pitch),
                        dist * Math.sin(pitch) * Math.cos(yaw));
    camera.lookAt(0, 0, 0);
  }

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ---------------- 转层动画 ---------------- */
  var animating = false;
  var AXIS_CH = ['x', 'y', 'z'];

  function animateMove(axis, layer, n, done) {
    if (animating) return false;
    if (FAST) { if (done) done(); return true; }
    animating = true;
    var pivot = new THREE.Group();
    cubeRoot.add(pivot);
    var group = [];
    state.cubies.forEach(function (cu, i) {
      if (cu.pos[axis] === layer) { pivot.attach(cubies[i]); group.push(cubies[i]); }
    });
    var mid = (N - 1) / 2;
    var target = layer - mid;      /* 层的世界坐标 */
    var total = (((n % 4) + 4) % 4) * (Math.PI / 2);
    if (total > Math.PI) total -= Math.PI * 2;
    var t0 = performance.now(), dur = Math.abs(total) > 1.7 ? 240 : 150;
    function step() {
      var t = Math.min(1, (performance.now() - t0) / dur);
      var e = 1 - Math.pow(1 - t, 3);
      pivot.rotation.set(0, 0, 0);
      pivot.rotation[AXIS_CH[axis]] = total * e;
      if (t < 1) { requestAnimationFrame(step); return; }
      pivot.rotation.set(0, 0, 0);
      pivot.rotation[AXIS_CH[axis]] = total;
      pivot.updateMatrixWorld(true);
      group.forEach(function (g) { cubeRoot.attach(g); });
      cubeRoot.remove(pivot);
      animating = false;
      if (done) done();
    }
    requestAnimationFrame(step);
    return true;
  }

  function doMove(axis, layer, n, done) {
    return animateMove(axis, layer, n, function () {
      C.applyMove(state, axis, layer, n);
      sync();
      if (done) done();
    });
  }

  /* 动作名 -> (轴, 层, n)，支持 R / 2R 这类内外层记号 */
  function moveTriple(name) {
    var pm = C.parseMove(name, N);
    return pm ? [pm.ax, pm.layer, pm.n] : null;
  }

  /* ---------------- 交互 ---------------- */
  var ray = new THREE.Raycaster();
  var ptr = { kind: null, x0: 0, y0: 0, yaw0: 0, pitch0: 0, moved: false, hit: null, done: false };

  function pointer(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }
  function pick(x, y, w, h) {
    var ndc = new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    var hits = ray.intersectObjects(pickables, false);
    return hits.length ? hits[0] : null;
  }
  function worldNormal(obj) {
    var v = new THREE.Vector3();
    v.setFromMatrixColumn(obj.matrixWorld, 2).normalize();
    return v;
  }

  function dragToMove(normal, cubiePos, dx, dy) {
    var right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    var up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    var n = normal.clone();
    var tR = right.clone().sub(n.clone().multiplyScalar(right.dot(n))).normalize();
    var tU = up.clone().sub(n.clone().multiplyScalar(up.dot(n))).normalize();
    var w = tR.multiplyScalar(dx).add(tU.multiplyScalar(-dy));
    var best = null, bestScore = -1;
    [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].forEach(function (a) {
      var v = new THREE.Vector3(a[0], a[1], a[2]);
      if (Math.abs(v.dot(n)) > 0.5) return;
      var sc = w.dot(v);
      if (sc > bestScore) { bestScore = sc; best = v; }
    });
    if (!best) return null;
    var axis = new THREE.Vector3().crossVectors(n, best).normalize();
    var axIdx = Math.abs(axis.x) > 0.5 ? 0 : Math.abs(axis.y) > 0.5 ? 1 : 2;
    var s = axis.getComponent(axIdx) > 0 ? 1 : -1;
    var v = new THREE.Vector3().crossVectors(axis, cubiePos).dot(best) > 0 ? 1 : -1;
    v *= s;
    var layer = Math.round(cubiePos.getComponent(axIdx) + (N - 1) / 2);
    return [axIdx, layer, v];
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (animating) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    var p = pointer(e);
    var hit = pick(p.x, p.y, p.w, p.h);
    ptr = { kind: null, x0: p.x, y0: p.y, yaw0: yaw, pitch0: pitch, moved: false, hit: hit };
    if (hit && mode === 'paint') ptr.kind = 'paint';
    else if (hit) ptr.kind = 'sticker';
    else ptr.kind = 'orbit';
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!ptr.kind) return;
    var p = pointer(e), dx = p.x - ptr.x0, dy = p.y - ptr.y0;
    if (!ptr.moved && Math.hypot(dx, dy) > 6) ptr.moved = true;
    if (ptr.kind === 'orbit') {
      yaw = ptr.yaw0 - dx * 0.0065;
      pitch = Math.max(0.18, Math.min(2.96, ptr.pitch0 - dy * 0.0065));
      updateCam();
    } else if (ptr.kind === 'sticker' && ptr.moved) {
      ptr.kind = null;
      var obj = ptr.hit.object;
      var n = worldNormal(obj);
      var cubiePos = new THREE.Vector3().setFromMatrixPosition(obj.parent.matrixWorld);
      var mv = dragToMove(n, cubiePos, dx, dy);
      if (!mv) return;
      clearSolution(true);
      doMove(mv[0], mv[1], mv[2], function () { refreshTip(); });
    } else if (ptr.kind === 'paint' && ptr.moved) {
      ptr.kind = null;
    }
  });

  canvas.addEventListener('pointerup', function (e) {
    if (ptr.kind === 'paint' && !ptr.moved && ptr.hit) {
      var obj = ptr.hit.object;
      var n = worldNormal(obj);
      var face = C.faceOfNormal([Math.round(n.x), Math.round(n.y), Math.round(n.z)]);
      var wp = new THREE.Vector3().setFromMatrixPosition(obj.parent.matrixWorld);
      var mid = (N - 1) / 2;
      var pos = [Math.round(wp.x + mid), Math.round(wp.y + mid), Math.round(wp.z + mid)];
      if (face) {
        C.paintAt(state, pos, face, paintColor);
        refreshColors();
        clearSolution(true);
        refreshTip();
      }
    }
    ptr.kind = null;
  });

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    dist = Math.max(N * 1.4, Math.min(N * 4.2, dist * Math.exp(e.deltaY * 0.0011)));
    updateCam();
  }, { passive: false });

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowLeft') {
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'BUTTON') return;
      if (!solution.length) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') gotoStep(cursor - 1); else doStep();
      return;
    }
    var k = e.key.toUpperCase();
    if ('URFLDB'.indexOf(k) < 0) return;
    if (animating) return;
    var name = k + (e.shiftKey ? "'" : '');
    var tr = moveTriple(name);
    if (!tr) return;
    clearSolution(true);
    doMove(tr[0], tr[1], tr[2], function () { refreshTip(); });
  });

  /* ---------------- HUD ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var tipEl = $('tip'), paletteEl = $('palette');

  function setTip(msg, cls) {
    tipEl.textContent = msg;
    tipEl.className = 'tip' + (cls ? ' ' + cls : '');
  }

  function refreshTip() {
    var c = C.counts(state);
    var need = N * N, bad = [];
    for (var i = 0; i < 6; i++) if (c[i] !== need) bad.push(C.COLOR_NAME[i] + ' ' + c[i]);
    if (bad.length) { setTip('涂色未完成：' + bad.join(' / ') + '（每色应 ' + need + ' 格）', 'err'); }
    else if (C.isSolved(state)) setTip('这已经是复原状态。', 'ok');
    else if (N === 4) {
      var info = C.reduceInfo(state);
      $('btn-solve').textContent = '开始复原';
      setTip('降阶进度：中心 ' + info.centers + '/24 · 棱块 ' + info.pairs + '/12 ｜ ' +
        (info.reduced ? '已降阶，点「开始复原」自动收尾（含三阶部分）'
          : '点「开始复原」会依次拼中心块 → 配 12 对翼棱 → 三阶收尾，全程自动'));
    } else setTip(need * 6 + ' 格已齐。点「开始复原」算出逐步动作。');
    refreshPaletteCounts(c);
  }

  function buildPalette() {
    paletteEl.innerHTML = '';
    for (var i = 0; i < 6; i++) {
      (function (i) {
        var b = document.createElement('div');
        b.className = 'sw' + (i === paintColor ? ' on' : '');
        b.innerHTML = '<span class="dot" style="background:' + C.COLOR_HEX[i] + '"></span>' +
          '<b>' + C.COLOR_NAME[i] + '</b><i data-cnt>0</i>';
        b.addEventListener('click', function () {
          paintColor = i;
          Array.prototype.forEach.call(paletteEl.children, function (n) { n.classList.remove('on'); });
          b.classList.add('on');
        });
        paletteEl.appendChild(b);
      })(i);
    }
  }
  function refreshPaletteCounts(c) {
    Array.prototype.forEach.call(paletteEl.children, function (n, i) {
      var e = n.querySelector('[data-cnt]');
      if (e) e.textContent = c[i];
    });
  }
  function setMode(m) {
    mode = m;
    Array.prototype.forEach.call(document.querySelectorAll('#modes .mode'), function (b) {
      b.classList.toggle('on', b.dataset.mode === m);
    });
    paletteEl.classList.toggle('show', m === 'paint');
    if (m === 'paint') setTip('点任意贴纸，把它涂成选中的颜色。');
    else refreshTip();
  }
  Array.prototype.forEach.call(document.querySelectorAll('#modes .mode'), function (b) {
    b.addEventListener('click', function () { setMode(b.dataset.mode); });
  });

  /* ---------------- 解算 ---------------- */
  var solution = [], cursor = 0, playing = false, pendingSteps = 0;
  var replayStart = null;
  var stepsEl = $('steps'), stepCountEl = $('stepCount'), playBtn = $('btn-play'),
    stepBtn = $('btn-step'), backBtn = $('btn-back'), playInfo = $('playInfo');

  function clearSolution(silent) {
    solution = []; cursor = 0; playing = false; pendingSteps = 0;
    stepsEl.innerHTML = '<li class="empty">还没有解算。点「开始复原」，布洛妮娅会把每一步列在这里，' +
      '然后点「下一步」一步一步走。</li>';
    stepCountEl.textContent = '—';
    stepBtn.disabled = true; stepBtn.textContent = '下一步';
    backBtn.disabled = true;
    playBtn.disabled = true; playBtn.textContent = '▶ 自动';
    playInfo.textContent = '';
    if (!silent) refreshTip();
  }

  function renderSteps() {
    stepsEl.innerHTML = '';
    solution.forEach(function (mv, i) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="no">' + (i + 1) + '</span><span class="mv">' + mv +
        '</span><span class="desc">' + C.describeMove(mv, N) + '</span>';
      li.title = '跳到第 ' + (i + 1) + ' 步之前';
      li.addEventListener('click', function () { gotoStep(i); });
      stepsEl.appendChild(li);
    });
    stepCountEl.textContent = '共 ' + solution.length + ' 步';
  }

  function gotoStep(k) {
    if (!solution.length || animating || !replayStart) return;
    playing = false; pendingSteps = 0;
    k = Math.max(0, Math.min(solution.length, k));
    state = C.clone(replayStart);
    for (var i = 0; i < k; i++) state = C.applyName(state, solution[i]);
    cursor = k;
    sync();
    highlight(cursor);
    updatePlayUI();
  }

  function highlight(i) {
    Array.prototype.forEach.call(stepsEl.children, function (li, k) {
      li.classList.toggle('cur', k === i);
      li.classList.toggle('done', k < i);
    });
    if (stepsEl.children[i] && stepsEl.children[i].scrollIntoView) {
      stepsEl.children[i].scrollIntoView({ block: 'nearest' });
    }
  }

  function updatePlayUI() {
    var n = solution.length;
    if (!n) {
      stepBtn.disabled = true; stepBtn.textContent = '下一步';
      backBtn.disabled = true;
      playBtn.disabled = true; playBtn.textContent = '▶ 自动';
      playInfo.textContent = '';
      return;
    }
    var atEnd = cursor >= n;
    backBtn.disabled = cursor <= 0;
    if (atEnd) {
      stepBtn.disabled = true; stepBtn.textContent = '已完成';
      playBtn.disabled = false; playBtn.textContent = '↺ 重放';
    } else {
      stepBtn.disabled = false; stepBtn.textContent = '下一步 ' + (cursor + 1) + '/' + n;
      playBtn.disabled = false; playBtn.textContent = playing ? '⏸ 暂停' : '▶ 自动';
    }
    playInfo.textContent = '';
  }

  function applyOne(auto) {
    if (animating) return;
    if (cursor >= solution.length) { playing = false; updatePlayUI(); return; }
    var name = solution[cursor];
    var tr = moveTriple(name);
    if (!tr) { cursor++; updatePlayUI(); if (auto && playing) setTimeout(function () { applyOne(true); }, 20); return; }
    highlight(cursor);
    animateMove(tr[0], tr[1], tr[2], function () {
      C.applyMove(state, tr[0], tr[1], tr[2]);
      sync();
      cursor++;
      highlight(cursor);
      if (cursor >= solution.length) {
        playing = false;
        setTip('复原完成。', 'ok');
        updatePlayUI();
        return;
      }
      updatePlayUI();
      if (pendingSteps > 0) { pendingSteps--; setTimeout(doStep, 30); return; }
      if (auto && playing) setTimeout(function () { applyOne(true); }, 60);
    });
  }

  function doStep() {
    if (!solution.length || cursor >= solution.length) return;
    playing = false;
    updatePlayUI();
    if (animating) { pendingSteps = Math.min(pendingSteps + 1, 8); return; }
    applyOne(false);
  }

  stepBtn.addEventListener('click', function () { doStep(); stepBtn.blur(); });
  backBtn.addEventListener('click', function () {
    if (!solution.length) return;
    gotoStep(cursor - 1);
    backBtn.blur();
  });
  playBtn.addEventListener('click', function () {
    if (!solution.length) return;
    if (playing) { playing = false; updatePlayUI(); return; }
    if (cursor >= solution.length) gotoStep(0);
    playing = true;
    updatePlayUI();
    applyOne(true);
  });

  $('btn-solve').addEventListener('click', function () {
    if (animating) return;
    if (N === 4) {
      var r4 = C.solve4(state);
      if (!r4.ok) { setTip(r4.err + '（再点一次会换一条随机路线重试）', 'err'); return; }
      if (!r4.moves.length) { setTip('这已经是复原状态。', 'ok'); return; }
      solution = r4.moves;
      cursor = 0; pendingSteps = 0;
      replayStart = C.clone(state);
      renderSteps();
      updatePlayUI();
      highlight(0);
      var ph = r4.phases || {};
      setTip('四阶一把梭：中心 ' + (ph.centers || 0) + ' 步 → 配 12 对翼棱 ' + (ph.edges || 0) +
        ' 步 → 三阶收尾 ' + (ph.tail || 0) + ' 步，共 ' + solution.length + ' 步。');
      return;
    }
    var sol = N === 2 ? C.solve2(state) : C.solve3(state);
    if (!sol.ok) { setTip(sol.err, 'err'); return; }
    if (!sol.moves.length) { setTip('这已经是复原状态。', 'ok'); return; }
    solution = sol.moves;
    cursor = 0; pendingSteps = 0;
    replayStart = C.clone(state);
    renderSteps();
    updatePlayUI();
    highlight(0);
    setTip('共 ' + solution.length + ' 步（最短解）。点「下一步」一步一步走，或点「自动」。');
  });

  $('btn-pairs').addEventListener('click', function () {
    if (N !== 4) return;
    var rep = C.edgeReport(state);
    var lines = rep.map(function (r, i) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="no">' + (i + 1) + '</span><span class="mv">' +
        (r.ok ? '✓' : '·') + '</span><span class="desc">' + r.edge + ' 棱' +
        (r.ok ? '：已配对' : '：缺 ' + r.missing.length + ' 块（在 ' + r.missing.join(' / ') + ' 棱）') +
        '</span>';
      return li;
    });
    stepsEl.innerHTML = '';
    lines.forEach(function (li) { stepsEl.appendChild(li); });
    var okN = rep.filter(function (r) { return r.ok; }).length;
    stepCountEl.textContent = okN + ' / 12 已配对';
    setTip('配对清单（只诊断，不动魔方）：棱块自动配对会自己处理，这份清单用来看还差哪几块。');
  });

  $('btn-scramble').addEventListener('click', function () {
    if (animating) return;
    clearSolution(true);
    C.scramble(state, N === 4 ? 16 : 12);
    sync();
    refreshTip();
    setTip('已打乱。想复原就点「开始复原」。');
  });

  $('btn-reset').addEventListener('click', function () {
    if (animating) return;
    state = C.create(N);
    rebuild();
    clearSolution(true);
    refreshTip();
  });

  /* 换阶数 */
  function rebuild() {
    build();
    refreshColors();
    sync();
  }
  function setN(n) {
    if (animating || n === N) return;
    N = n;
    state = C.create(N);
    dist = N === 4 ? 13.6 : N === 3 ? 10.0 : 8.4;
    updateCam();
    rebuild();
    clearSolution(true);
    document.getElementById('btn-solve').textContent = '开始复原';
    document.getElementById('acts4').style.display = n === 4 ? 'flex' : 'none';
    Array.prototype.forEach.call(document.querySelectorAll('#sizes .size'), function (b) {
      b.classList.toggle('on', +b.dataset.n === n);
    });
    refreshTip();
    setTip(n === 4 ? '四阶：点「开始复原」，会自动拼中心块 → 配 12 对翼棱 → 三阶收尾（含奇偶）。'
      : (n === 2 ? '二阶：涂好 24 格，最短解最多 11 步。' : '三阶：涂好 54 格就能算最短解。'));
  }
  Array.prototype.forEach.call(document.querySelectorAll('#sizes .size'), function (b) {
    b.addEventListener('click', function () { setN(+b.dataset.n); });
  });

  /* ---------------- 启动 ---------------- */
  build();
  buildPalette();
  refreshColors();
  sync();
  updateCam();
  resize();
  refreshTip();
  window.addEventListener('resize', resize);

  var q = new URLSearchParams(location.search);
  FAST = q.get('fast') === '1';
  if (q.get('n')) setN(+q.get('n'));
  if (q.get('mode') === 'paint') setMode('paint');
  if (q.get('scramble') === '1') $('btn-scramble').click();
  if (q.get('solve') === '1') setTimeout(function () {
    $('btn-solve').click();
    if (q.get('at')) gotoStep(+q.get('at'));
  }, 80);

  if (q.get('check') === '1') setTimeout(function () {
    var bad = [], need = N * N;
    C.FACES.forEach(function (f) {
      var cells = C.faceletColors(state, f);
      var mid = [];
      for (var r = 1; r < N - 1; r++) for (var c = 1; c < N - 1; c++) mid.push(cells[r * N + c]);
      if (!mid.every(function (k) { return k === mid[0]; })) bad.push(f);
    });
    setTip(bad.length ? '自检：还有面的中心没同色：' + bad.join(',') : ('自检：' + N + ' 阶中心全部同色'),
      bad.length ? 'err' : 'ok');
  }, 1500);

  (function loop() {
    requestAnimationFrame(loop);
    renderer.render(scene, camera);
  })();

  window.__cube = {
    get state() { return state; },
    setN: setN,
    solve: function () { $('btn-solve').click(); },
    scramble: function () { $('btn-scramble').click(); },
    apply: function (name) { state = C.applyName(state, name); sync(); }
  };
})();

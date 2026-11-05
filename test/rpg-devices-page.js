/* 汉字勇者 RPG (rpg/)：いろいろな画面（スマホ縦・横、タブレット、パソコン）で表示と操作を確かめるテスト。
   使い方：npm run test:rpg-devices -- <出力フォルダ>（HSK_BASE_URL がなければ http://127.0.0.1:8000/ の rpg/ をテスト）
   各端末で確認すること：
   ・横スクロールが出ない／地図の画面で縦スクロールも出ない
   ・地図と操作ボタンが画面に収まる（タッチ端末は十字・A ボタン、パソコンはキーの説明）
   ・地図の canvas が画面のピクセル数でかかれている（ぼやけない）
   ・戦闘の4択と「つぎへ」が画面に収まる
   ・クリック／タップした場所へ歩く、人をクリック／タップすると話す、十字ボタンを指ですべらせて向きをかえる */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
if (!out) throw new Error('pass an output directory');
fs.mkdirSync(out, { recursive: true });
const URL = new globalThis.URL('rpg/', (process.env.HSK_BASE_URL || 'http://127.0.0.1:8000').replace(/\/?$/, '/')).href;
const D = [
  ['iphone-se1', { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['iphone-se1-land', { viewport: { width: 568, height: 270 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['iphone-13', devices['iPhone 13']],
  ['iphone-13-land', devices['iPhone 13 landscape']],
  ['pixel-7', devices['Pixel 7']],
  ['pixel-7-land', devices['Pixel 7 landscape']],
  ['galaxy-s9', devices['Galaxy S9+']],
  ['ipad-mini', devices['iPad Mini']],
  ['ipad-land', devices['iPad Mini landscape']],
  ['laptop-1366', { viewport: { width: 1366, height: 768 } }],
  ['laptop-hidpi', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
  ['desktop-1920', { viewport: { width: 1920, height: 1080 } }],
  ['small-window', { viewport: { width: 700, height: 500 } }]
];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
(async () => {
  const launch = { headless: true };
  if (process.env.HSK_CHROMIUM_EXECUTABLE) launch.executablePath = process.env.HSK_CHROMIUM_EXECUTABLE;
  const b = await chromium.launch(launch);
  const lines = [];
  const problems = [];
  for (const [name, dev] of D) {
    if (only && !only.includes(name)) continue;
    const opt = { ...dev }; delete opt.defaultBrowserType;
    const ctx = await b.newContext(opt);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.goto(URL); await p.waitForLoadState('load');
    await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForLoadState('load');
    const vw = await p.evaluate(() => [innerWidth, innerHeight]);
    const touch = !!opt.hasTouch;
    const issues = [];
    const tap = async (x, y) => { if (touch) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y); };
    const tileXY = (tx, ty) => p.evaluate(([tx, ty]) => {
      const c = document.getElementById('map').getBoundingClientRect(), s = c.width / 240, cam = __rpg.camera;
      return { x: c.left + (tx * 16 + 8 - cam.x) * s, y: c.top + (ty * 16 + 8 - cam.y) * s };
    }, [tx, ty]);

    if (await p.evaluate(() => document.documentElement.scrollWidth) > vw[0] + 1) issues.push('title: horizontal overflow');
    await p.screenshot({ path: `${out}/d-${name}-title.png` });
    // パソコンはキーボードだけで始める（タイトルでは「はじめから」にフォーカスがある）、タッチ端末はタップ
    if (touch) await p.tap('#btn-new'); else { await p.waitForTimeout(120); await p.keyboard.press('Enter'); }
    await p.waitForTimeout(100);
    if (await p.evaluate(() => document.getElementById('title').hidden) !== true) issues.push('could not start from the title' + (touch ? '' : ' with Enter'));
    await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    await p.screenshot({ path: `${out}/d-${name}-picker.png` });
    const foot = await p.evaluate(() => document.querySelector('.pick-foot .btn').getBoundingClientRect().bottom);
    if (foot > vw[1] + 1) issues.push('picker: decide button below the screen');
    await p.click('.pick-foot .btn'); await p.waitForTimeout(200);
    await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    await p.evaluate(() => { __rpg.noEncounter = true; __rpg.setMap('plain', 5, 3); __rpg.layout(); });
    await p.waitForTimeout(300);
    const m = await p.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; if (getComputedStyle(e).display === 'none' || e.offsetParent === null) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height }; };
      const c = document.getElementById('map');
      return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, map: r('#map'), dpad: r('#dpad'), a: r('#btn-a'), menu: r('#btn-menu'), hint: r('#keys-hint'),
        cw: c.width, ch: c.height, dpr: devicePixelRatio, land: document.body.classList.contains('land') };
    });
    await p.screenshot({ path: `${out}/d-${name}-map.png` });
    if (m.sw > vw[0] + 1) issues.push('map: horizontal overflow ' + m.sw + '>' + vw[0]);
    if (m.sh > vw[1] + 1) issues.push('map: vertical scroll ' + m.sh + '>' + vw[1]);
    if (!m.map || m.map.bottom > vw[1] + 1 || m.map.top < 0) issues.push('map not fully visible');
    if (!m.menu || m.menu.bottom > vw[1] + 1) issues.push('menu button not visible');
    if (touch) {
      if (!m.dpad || !m.a) issues.push('touch controls hidden');
      else {
        if (Math.max(m.dpad.bottom, m.a.bottom) > vw[1] + 1) issues.push('controls below the screen');
        const ov = (r) => r.left < m.map.right - 1 && r.right > m.map.left + 1 && r.top < m.map.bottom - 1 && r.bottom > m.map.top + 1;
        if (ov(m.dpad) || ov(m.a)) issues.push('controls overlap the map');
      }
    } else {
      if (m.dpad || m.a) issues.push('touch controls shown on a mouse device');
      if (!m.hint) issues.push('keyboard hint missing');
    }
    if (m.map && Math.abs(m.cw - m.map.w * m.dpr) > m.dpr * 2) issues.push('canvas not at device resolution: ' + m.cw + ' vs ' + m.map.w * m.dpr);

    // クリック／タップで歩く：草原の (8,3) へ
    let t = await tileXY(8, 3);
    await tap(t.x, t.y); await p.waitForTimeout(1500);
    const pos1 = await p.evaluate(() => __rpg.pos);
    if (pos1[0] !== 8 || pos1[1] !== 3) issues.push('click-to-walk failed: at ' + pos1);
    // 先生（9,2）をクリック／タップ → となりまで歩いて話す
    t = await tileXY(9, 2);
    await tap(t.x, t.y); await p.waitForTimeout(1200);
    const talked = await p.evaluate(() => __rpg.mode === 'dialog' && document.getElementById('d-name').textContent);
    if (talked !== '李先生') issues.push('tapping the teacher did not start the talk (' + talked + ')');
    await p.screenshot({ path: `${out}/d-${name}-talk.png` });
    for (let i = 0; i < 6 && (await p.evaluate(() => __rpg.mode)) !== 'map'; i++) {
      const last = await p.$('#d-choices button:last-child');
      if (last) await last.click(); else await p.keyboard.press('Enter');
      await p.waitForTimeout(150);
    }

    // 十字ボタン：押したまま指をすべらせる（上 → 右）
    if (touch && m.dpad) {
      await p.evaluate(() => { __rpg.setMap('village', 8, 12); });
      await p.waitForTimeout(100);
      const d = m.dpad, cx = d.left + d.w / 2, cy = d.top + d.h / 2;
      await p.mouse.move(cx, d.top + d.h * 0.15); await p.mouse.down();
      await p.waitForTimeout(400);
      const up = await p.evaluate(() => __rpg.pos);
      await p.mouse.move(d.left + d.w * 0.85, cy, { steps: 4 });
      await p.waitForTimeout(400);
      const right = await p.evaluate(() => __rpg.pos);
      await p.mouse.up(); await p.waitForTimeout(250);
      if (!(up[1] < 12)) issues.push('d-pad up did not move');
      if (!(right[0] > 8)) issues.push('sliding to the right on the d-pad did not turn right: ' + up + ' -> ' + right);
    }

    // 戦闘：4択と「つぎへ」が画面に収まる
    await p.evaluate(() => { __rpg.setMap('plain', 5, 3); __rpg.encounter(); }); await p.waitForTimeout(1100);
    await p.click('#bcmd button'); await p.waitForTimeout(300);
    if (await p.$('#bcard:not([hidden])')) { await p.screenshot({ path: `${out}/d-${name}-card.png` }); await p.click('#bcard-ok'); await p.waitForTimeout(300); }
    const bt = await p.evaluate(() => {
      const last = [...document.querySelectorAll('#bchoices button')].pop();
      const r = last ? last.getBoundingClientRect() : null;
      const bc = document.getElementById('bcanvas');
      return { lastBottom: r ? r.bottom : null, sw: document.getElementById('battle').scrollWidth, cw: bc.width, w: bc.getBoundingClientRect().width, dpr: devicePixelRatio,
        lang: document.getElementById('bq-main').getAttribute('lang'), type: __rpg.q && __rpg.q.type };
    });
    await p.screenshot({ path: `${out}/d-${name}-battle.png` });
    if (bt.lastBottom == null || bt.lastBottom > vw[1] + 1) issues.push('battle choices below the screen (' + Math.round(bt.lastBottom) + '>' + vw[1] + ')');
    if (bt.sw > vw[0] + 1) issues.push('battle: horizontal overflow');
    if (Math.abs(bt.cw - bt.w * bt.dpr) > bt.dpr * 2) issues.push('battle canvas not at device resolution');
    if (bt.type && bt.type !== 'ja2h' && bt.type !== 'listen' && bt.lang !== 'zh-CN') issues.push('Chinese question without lang=zh-CN');
    await p.click('#bchoices button'); await p.waitForTimeout(400);
    const nx = await p.evaluate(() => { const n = document.getElementById('bnext'); if (!n || n.offsetParent === null) return null; return n.getBoundingClientRect().bottom; });
    if (nx != null && nx > vw[1] + 1) issues.push('next button below the screen after answering');
    await p.screenshot({ path: `${out}/d-${name}-answer.png` });

    if (errs.length) issues.push('errors: ' + errs.join(' | '));
    const line = name.padEnd(16) + ' ' + vw.join('x').padEnd(10) + ' ' + (m.land ? 'land ' : '') + 'map ' + (m.map ? Math.round(m.map.w) + 'x' + Math.round(m.map.h) : '-') + ' canvas ' + m.cw + 'x' + m.ch + ' ' + (issues.length ? '✗ ' + issues.join('; ') : '✓');
    console.log(line); lines.push(line);
    if (issues.length) problems.push(name);
    await ctx.close();
  }
  await b.close();
  const total = D.filter(([name]) => !only || only.includes(name)).length;
  lines.push(problems.length ? 'problems: ' + problems.join(', ') : total + ' rpg device cases passed; pageErrors=0; consoleErrors=0');
  fs.writeFileSync(path.join(out, 'rpg-devices.log'), lines.join('\n') + '\n');
  console.log(lines[lines.length - 1]);
  if (problems.length) process.exit(1);
})();

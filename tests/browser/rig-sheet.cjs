// Spacefarer review sheet: the 14 canonical poses at 5x, the working tree under a git ref.
//   cd tests/browser && node rig-sheet.cjs [ref=origin/main] [out=rig-sheet.png]
// The acceptance artifact for any rig change (docs/art-direction.md, "Model sheet"): it
// ships only when no pose reads worse than the BEFORE row.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.resolve(__dirname, '../..'), ref = process.argv[2] || 'origin/main', out = path.resolve(process.argv[3] || 'rig-sheet.png');
const FILES = ['src/math.js', 'src/cosmetics.js', 'src/seasons.js', 'src/art.js', 'src/anim.js'];
const POSES = [
  ['idle', { t: .3 }], ['idle t1', { t: 1.1 }], ['wave', { t: .5, wave: 1 }],
  ['run 0', { speed: 1, runCycle: 0, t: .2, lean: .1 }], ['run 1.6', { speed: 1, runCycle: 1.6, t: .2, lean: .1 }], ['run 3.1', { speed: 1, runCycle: 3.1, lean: .1 }],
  ['rise', { onGround: false, air: -1 }], ['fall', { onGround: false, air: 1 }],
  ['land crouch', { crouch: 1, squashY: .85, squashX: 1.12 }], ['celebrate', { t: .4, celebrate: 1 }],
  ['attack', { attack: .3, gear: 'emitter', gearColor: '#ff7a59' }], ['hit', { hit: 1 }],
  ['aim', { aim: 1, gear: 'emitter', gearColor: '#44bbdd' }], ['hang', { hang: true, onGround: false, hangT: .3 }],
];
const sources = rev => FILES.map(f => rev ? execFileSync('git', ['show', `${rev}:${f}`], { cwd: ROOT, encoding: 'utf8' }) : fs.readFileSync(path.join(ROOT, f), 'utf8'));

(async () => {
  const browser = await chromium.launch(process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } });
  await page.setContent('<body style="margin:0;background:#1b2240"><canvas id=c width=1400 height=1800></canvas></body>');
  for (const [row, rev] of [[0, ref], [1, null]]) {
    // Each row loads its own copy of the modules into a fresh global, then paints.
    await page.evaluate(() => { delete window.SpaceManArt; delete window.SpaceManAnim; });
    for (const s of sources(rev)) await page.addScriptTag({ content: s });
    await page.evaluate(({ row, label, poses }) => {
      const c = document.getElementById('c').getContext('2d'), A = window.SpaceManArt, y0 = row * 900;
      c.fillStyle = '#fff'; c.font = 'bold 22px sans-serif'; c.fillText(label, 20, y0 + 40);
      poses.forEach(([name, p], i) => {
        const x = 100 + (i % 7) * 195, y = y0 + 380 + Math.floor(i / 7) * 420;
        c.fillStyle = '#0005'; c.beginPath(); c.ellipse(x, y, 60, 10, 0, 0, Math.PI * 2); c.fill();
        A.drawSpacefarer(c, x, y, 5.2, { suit: 'classic', hat: 'none', eyes: 'happy' }, p);
        c.fillStyle = '#fff'; c.font = '16px sans-serif'; c.fillText(name, x - 50, y + 30);
      });
    }, { row, label: row ? 'AFTER (working tree)' : `BEFORE (${ref})`, poses: POSES });
  }
  await page.screenshot({ path: out });
  await browser.close();
  console.log(out);
})();

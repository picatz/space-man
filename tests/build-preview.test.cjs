const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { copyProduction, buildPreview } = require('../scripts/build-preview.cjs');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-man-static-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source');
  for (const name of ['src', 'icons', 'screenshots', 'docs']) await fs.mkdir(path.join(source, name), { recursive: true });
  for (const [name, content] of Object.entries({
    'index.html': '<html><head><link rel="stylesheet" href="src/theme-2.css"></head><body><script src="src/build.js"></script><script>BUILD.storageKey("test")</script></body></html>',
    'service-worker.js': 'throw Error("never executed")',
    'manifest.json': '{}', 'favicon.png': '',
  })) await fs.writeFile(path.join(source, name), content);
  return { dir, source, output: path.join(dir, 'output') };
}

test('production and preview copy src CSS bytes verbatim without executing source code', async (t) => {
  const { dir, source, output } = await fixture(t), marker = path.join(dir, 'executed');
  const code = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`;
  const css = Buffer.from('/* byte-preserved CSS: π */\r\n:root { --accent: #8fe8ff; }\r\n');
  await fs.writeFile(path.join(source, 'src/theme-2.css'), css);
  await fs.writeFile(path.join(source, 'src/build.js'), code);
  await fs.mkdir(path.join(source, 'scripts'));
  await fs.writeFile(path.join(source, 'scripts/build-preview.cjs'), code);
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ scripts: { build: code } }));
  const preview = path.join(dir, 'preview');
  await copyProduction(source, output);
  await buildPreview({ source, output: preview, pr: 1, sha: 'a'.repeat(40), buildSha: 'b'.repeat(40) });
  for (const destination of [output, preview]) {
    assert.deepEqual(await fs.readFile(path.join(destination, 'src/theme-2.css')), css);
    assert.equal(await fs.readFile(path.join(destination, 'src/build.js'), 'utf8'), code);
    assert.match(await fs.readFile(path.join(destination, 'index.html'), 'utf8'), /href="src\/theme-2\.css"/);
    for (const excluded of ['scripts', 'package.json']) await assert.rejects(fs.access(path.join(destination, excluded)), { code: 'ENOENT' });
  }
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
});

test('CSS allowance stays confined to flat lowercase src asset names', async (t) => {
  for (const relative of ['src/unexpected.cjs', 'src/theme.mjs', 'src/theme.css.map', 'src/.hidden.css',
    'src/Theme.css', 'src/theme_name.css', 'src/theme..css', 'icons/theme.css', 'screenshots/theme.css', 'docs/theme.css']) {
    await t.test(relative, async (t) => {
      const { source, output } = await fixture(t);
      await fs.writeFile(path.join(source, relative), 'throw Error("never executed")');
      await assert.rejects(copyProduction(source, output), /Unexpected static path/);
    });
  }
  for (const relative of ['src/nested', 'src/nested.css']) {
    await t.test(relative, async (t) => {
      const { source, output } = await fixture(t);
      await fs.mkdir(path.join(source, relative));
      await fs.writeFile(path.join(source, relative, 'theme.css'), 'body {}');
      await assert.rejects(copyProduction(source, output), /Unexpected static path|Only regular static files/);
    });
  }
});

test('CSS files, static directories and source roots cannot be symlinks', async (t) => {
  for (const relative of ['src/theme.css', 'src', '']) {
    await t.test(relative || 'source root', async (t) => {
      const { dir, source, output } = await fixture(t), target = path.join(dir, 'target');
      if (relative === 'src/theme.css') await fs.writeFile(target, 'body {}');
      else await fs.mkdir(target);
      const link = path.join(source, relative);
      await fs.rm(link, { recursive: true, force: true });
      await fs.symlink(target, link);
      await assert.rejects(copyProduction(source, output), /Only regular static files|cannot be a symlink|Source must be a real directory/);
    });
  }
});

test('CSS keeps the per-file, total-byte and file-count limits', async (t) => {
  const MiB = 1024 * 1024;
  await t.test('5 MiB per file', async (t) => {
    const { dir, source, output } = await fixture(t), css = Buffer.alloc(5 * MiB, 32);
    await fs.writeFile(path.join(source, 'src/large.css'), css);
    await copyProduction(source, output);
    assert.deepEqual(await fs.readFile(path.join(output, 'src/large.css')), css);
    await fs.appendFile(path.join(source, 'src/large.css'), ' ');
    await assert.rejects(copyProduction(source, path.join(dir, 'oversize')), /Static file exceeds 5 MiB/);
  });
  await t.test('20 MiB total', async (t) => {
    const { source, output } = await fixture(t);
    for (let i = 0; i < 4; i++) await fs.writeFile(path.join(source, `src/large-${i}.css`), Buffer.alloc(5 * MiB, 32));
    await assert.rejects(copyProduction(source, output), /Static build exceeds 20 MiB/);
  });
  await t.test('250 static files', async (t) => {
    const { source, output } = await fixture(t);
    for (let i = 0; i < 251; i++) await fs.writeFile(path.join(source, `src/theme-${i}.css`), '');
    await assert.rejects(copyProduction(source, output), /Too many static files/);
  });
});

test('static packaging still rejects overlapping directories', async (t) => {
  const { dir, source } = await fixture(t);
  for (const output of [source, path.join(source, 'nested'), dir]) {
    await assert.rejects(copyProduction(source, output), /separate, non-nested directories/);
  }
});

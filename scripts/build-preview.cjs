// Trusted static packager. PR files are copied as data, never required/evaluated.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ROOT_FILES = ['index.html', 'service-worker.js', 'manifest.json', 'favicon.png', 'CNAME', 'LICENSE', 'README.md'];
const DIRECTORIES = { src: /^[a-z0-9-]+\.(js|css)$/, icons: /^[a-z0-9-]+\.png$/, screenshots: /^[a-z0-9-]+\.png$/, docs: /^[a-z0-9-]+\.md$/ };
async function copyFile(source, output, relative, optional = false) {
  const from = path.join(source, relative), to = path.join(output, relative);
  let stat;
  try { stat = await fs.lstat(from); } catch (e) { if (optional && e.code === 'ENOENT') return; throw e; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Only regular static files are permitted: ' + relative);
  if (stat.size > 5 * 1024 * 1024) throw new Error('Static file exceeds 5 MiB: ' + relative);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return stat.size;
}
// The worker's cache name must change whenever an asset the app shell serves
// changes, and only then. Contributors never bump it by hand: the deployed copy
// gets the source VERSION plus a hash of every shipped shell file, so two PRs
// can't conflict on it and an unchanged build never forces a reinstall.
const SHELL_ASSET = /^(index\.html|manifest\.json|favicon\.png|(src|icons)\/.+)$/;
const VERSION_LINE = /const VERSION = '([^'\\]*)';/g;
async function stampVersion(output, files) {
  const hash = createHash('sha256');
  for (const relative of files.filter((f) => SHELL_ASSET.test(f)).sort()) {
    hash.update(relative + '\0'); hash.update(await fs.readFile(path.join(output, relative))); hash.update('\0');
  }
  const worker = path.join(output, 'service-worker.js'), text = await fs.readFile(worker, 'utf8');
  const lines = [...text.matchAll(VERSION_LINE)];
  if (lines.length !== 1) throw new Error('service-worker.js must declare exactly one const VERSION');
  const version = lines[0][1].replace(/-[a-f0-9]{12}$/, '') + '-' + hash.digest('hex').slice(0, 12);
  await fs.writeFile(worker, text.replace(lines[0][0], `const VERSION = '${version}';`));
  return version;
}
async function copyProduction(source, output) {
  source = path.resolve(source); output = path.resolve(output);
  if (source === output || source.startsWith(output + path.sep) || output.startsWith(source + path.sep)) {
    throw new Error('Source and output must be separate, non-nested directories');
  }
  const stat = await fs.lstat(source);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Source must be a real directory');
  await fs.mkdir(output, { recursive: true });
  if ((await fs.readdir(output)).length) throw new Error('Output must be empty');
  let bytes = 0;
  const copied = [];
  for (const file of ROOT_FILES) {
    const size = await copyFile(source, output, file, ['CNAME', 'LICENSE', 'README.md'].includes(file));
    if (size !== undefined) { bytes += size; copied.push(file); }
  }
  if (bytes > 20 * 1024 * 1024) throw new Error('Static build exceeds 20 MiB');
  let total = 0;
  for (const [dir, allow] of Object.entries(DIRECTORIES)) {
    const from = path.join(source, dir);
    let d;
    try { d = await fs.lstat(from); } catch (e) { if (dir === 'docs' && e.code === 'ENOENT') continue; throw e; }
    if (!d.isDirectory() || d.isSymbolicLink()) throw new Error('Static directory cannot be a symlink: ' + dir);
    for (const name of await fs.readdir(from)) {
      if (!allow.test(name)) throw new Error('Unexpected static path: ' + dir + '/' + name);
      if (++total > 250) throw new Error('Too many static files');
      bytes += await copyFile(source, output, dir + '/' + name); copied.push(dir + '/' + name);
      if (bytes > 20 * 1024 * 1024) throw new Error('Static build exceeds 20 MiB');
    }
  }
  await fs.writeFile(path.join(output, '.nojekyll'), '');
  return stampVersion(output, copied);
}
async function buildPreview({ source, output, pr, sha, buildSha }) {
  pr = Number(pr);
  if (!Number.isSafeInteger(pr) || pr < 1 || !/^[a-f0-9]{40}$/.test(sha) || !/^[a-f0-9]{40}$/.test(buildSha)) throw new Error('Expected positive PR number and full lowercase commit SHA');
  const info = { schema: 1, pr, sha, buildSha, basePath: '/pr/' + pr + '/' + sha + '/' + buildSha + '/' };
  await copyProduction(source, output);
  const htmlPath = path.join(output, 'index.html');
  let html = await fs.readFile(htmlPath, 'utf8');
  if (!html.includes('<script src="src/build.js"></script>') || !html.includes('BUILD.storageKey(')
      || html.includes('name="space-man-preview"')) throw new Error('Source is not a preview-aware game build');
  const escaped = JSON.stringify(info).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const heads = [...html.matchAll(/<head\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi)];
  if (heads.length !== 1) throw new Error('Preview HTML must contain exactly one head element');
  html = html.replace(heads[0][0], heads[0][0] + '\n<meta name="space-man-preview" content="' + escaped + '">\n<meta name="robots" content="noindex,nofollow">');
  // Preview URLs are online-only: do not offer a PWA that could outlive the PR.
  html = html.replace(/<link\s+rel="manifest"[^>]*>/g, '');
  await fs.writeFile(htmlPath, html);
  const manifestPath = path.join(output, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  Object.assign(manifest, { id: info.basePath, name: 'Space Man Preview PR ' + pr, short_name: 'SM PR ' + pr, start_url: './', scope: './' });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'preview-build.json'), JSON.stringify(info, null, 2) + '\n');
  await fs.rm(path.join(output, 'service-worker.js'));
  await fs.rm(path.join(output, 'CNAME'), { force: true });
  return info;
}

module.exports = { copyProduction, buildPreview };
if (require.main === module) {
  const args = process.argv.slice(2), values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source', '--output', '--pr', '--sha', '--build-sha'].includes(args[i]) || !args[i + 1] || values[args[i]]) throw new Error('Usage: --source DIR --output DIR --pr NUMBER --sha SHA --build-sha SHA');
    values[args[i]] = args[i + 1];
  }
  buildPreview({ source: values['--source'], output: values['--output'], pr: values['--pr'], sha: values['--sha'], buildSha: values['--build-sha'] })
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}

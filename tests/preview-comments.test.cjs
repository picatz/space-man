'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const commenter = require('../scripts/comment-previews.cjs');

const MAIN = 'a'.repeat(40), HEAD = 'b'.repeat(40), NEXT = 'c'.repeat(40);
const BASE = 'https://spacemangame.online/';
const PREFIX = '/repos/picatz/space-man';
function preview(number = 10, sha = HEAD, buildSha = MAIN) {
  return { number, sha, buildSha, url: `${BASE}pr/${number}/${sha}/${buildSha}/` };
}
function publication(items = [preview()], sha = MAIN) {
  return { version: 1, production: { sha, url: BASE }, previews: items, omitted: [] };
}
function pull(number = 10, sha = HEAD, patch = {}) {
  return { number, state: 'open', user: { login: 'picatz' },
    head: { sha, repo: { full_name: 'picatz/space-man' } },
    base: { ref: 'main', repo: { full_name: 'picatz/space-man' } }, ...patch };
}
function bot(id, body, patch = {}) {
  return { id, body, user: { login: 'github-actions[bot]', type: 'Bot' }, ...patch };
}
function harness({ manifest = publication(), comments = [], current = pull(), live = manifest,
  metadataPatch = {}, readJson: customReader, api: customApi } = {}) {
  const requests = [], reads = [], pauses = [];
  const api = async (route, request = {}) => {
    requests.push({ route, ...request });
    if (customApi) return customApi(route, request);
    if (route.includes('/comments?')) {
      const page = Number(new URL(`https://api.github.com${route}`).searchParams.get('page'));
      return comments.slice((page - 1) * 100, page * 100);
    }
    if (route.includes('/pulls/')) return current;
    return { id: 123 };
  };
  const readJson = async url => {
    reads.push(url);
    if (customReader) return customReader(url);
    if (url === `${BASE}pr/previews.json`) return live;
    const item = manifest.previews.find(item => `${item.url}preview-build.json` === url);
    assert.ok(item, `Unexpected metadata URL: ${url}`);
    return { schema: 1, pr: item.number, sha: item.sha, buildSha: item.buildSha,
      basePath: new URL(item.url).pathname, ...metadataPatch };
  };
  return { requests, reads, pauses, run: () => commenter.commentPreviews(manifest, {
    base: BASE, mainSha: MAIN, api, readJson, attempts: 2, pause: async ms => pauses.push(ms),
  }), writes: () => requests.filter(item => item.method) };
}

test('a verified deployed preview creates a concise Actions comment, then a rerun is a no-op', async () => {
  const first = harness();
  assert.deepEqual(await first.run(), [{ number: 10, action: 'created' }]);
  const write = first.writes()[0];
  assert.equal(write.route, `${PREFIX}/issues/10/comments`);
  assert.equal(write.method, 'POST');
  assert.equal(write.body, `${commenter.MARKER}\n[Play preview](${preview().url}) · \`bbbbbbb\``);
  assert.deepEqual(first.requests.at(-2), { route: `${PREFIX}/pulls/10` });
  const rerun = harness({ comments: [bot(123, write.body)] });
  assert.deepEqual(await rerun.run(), [{ number: 10, action: 'unchanged' }]);
  assert.equal(rerun.writes().length, 0);
});

test('sticky updates paginate comments and never replace human comments or other bot messages', async () => {
  const marked = `${commenter.MARKER}\nOld preview`;
  const comments = [bot(1, marked, { user: { login: 'picatz', type: 'User' } }),
    bot(2, marked, { user: { login: 'other[bot]', type: 'Bot' } }),
    bot(3, marked, { user: { login: 'github-actions[bot]', type: 'User' } }),
    bot(4, 'Someone quoted ' + marked), bot(5, 'Unrelated Actions output'),
    ...Array.from({ length: 95 }, (_, index) => bot(index + 6, 'Another comment')),
    bot(200, marked)];
  const task = harness({ comments });
  assert.deepEqual(await task.run(), [{ number: 10, action: 'updated' }]);
  assert.deepEqual(task.writes(), [{ route: `${PREFIX}/issues/comments/200`, method: 'PATCH',
    body: commenter.commentBody(preview()) }]);
  assert.ok(task.requests.some(item => item.route.endsWith('page=2')));
});

test('a new source or builder updates the same bot comment to the exact new URL', async () => {
  for (const old of [preview(10, NEXT), preview(10, HEAD, NEXT)]) {
    const task = harness({ comments: [bot(21, commenter.commentBody(old))] });
    await task.run();
    assert.equal(task.writes()[0].route, `${PREFIX}/issues/comments/21`);
    assert.equal(task.writes()[0].body, commenter.commentBody(preview()));
  }
});

test('all eligibility and exact head checks happen again after metadata reads, immediately before writing', async () => {
  const ineligible = [pull(10, NEXT), pull(10, HEAD, { state: 'closed' }),
    pull(10, HEAD, { user: { login: 'other' } }),
    pull(10, HEAD, { head: { sha: HEAD, repo: { full_name: 'other/space-man' } } }),
    pull(10, HEAD, { base: { ref: 'other', repo: { full_name: 'picatz/space-man' } } }),
    pull(10, HEAD, { base: { ref: 'main', repo: { full_name: 'other/space-man' } } }), pull(11)];
  for (const current of ineligible) {
    const task = harness({ current, comments: [bot(1, `${commenter.MARKER}\nOld preview`)] });
    assert.deepEqual(await task.run(), [{ number: 10, action: 'skipped' }]);
    assert.equal(task.writes().length, 0);
    assert.equal(task.requests.at(-1).route, `${PREFIX}/pulls/10`);
  }
});

test('canonical manifest validation rejects external, injected, duplicate and mismatched identities before I/O', async () => {
  const bad = [publication([preview(10, HEAD, NEXT)]), publication([preview(10, 'bad')]),
    publication([preview('../10')]), publication([preview(), preview()]),
    publication([preview()], NEXT), { ...publication(), production: { sha: MAIN, url: 'https://evil.example/' } },
    ...['https://evil.example/', `${preview().url}?next=evil`, `${preview().url}\n@picatz`,
      preview().url.replace('/10/', '/11/')].map(url => publication([{ ...preview(), url }]))];
  for (const manifest of bad) {
    const task = harness({ manifest });
    await assert.rejects(task.run(), /Invalid|Unexpected|Duplicate/);
    assert.equal(task.requests.length, 0);
    assert.equal(task.reads.length, 0);
  }
});

test('stale or incomplete live publications exhaust bounded readiness checks without comment writes', async () => {
  for (const live of [publication([], MAIN), publication([preview(10, NEXT)]),
    publication([preview(), preview(20)]), publication([preview(10, HEAD, NEXT)], NEXT)]) {
    const task = harness({ live });
    await assert.rejects(task.run(), /publication|production identity/);
    assert.equal(task.writes().length, 0);
    assert.deepEqual(task.pauses, [10000]);
  }
});

test('immutable preview metadata must match schema, PR, source, builder and base path', async () => {
  for (const metadataPatch of [{ schema: 2 }, { pr: 11 }, { sha: NEXT },
    { buildSha: NEXT }, { basePath: '/wrong/' }]) {
    const task = harness({ metadataPatch });
    await assert.rejects(task.run(), /build metadata mismatch/);
    assert.equal(task.writes().length, 0);
    assert.deepEqual(task.pauses, [10000]);
  }
});

test('transient stale manifests and missing immutable metadata retry until the right deployment appears', async () => {
  for (const transient of ['stale', '404']) {
    let first = true;
    const item = preview();
    const task = harness({ readJson: async url => {
      if (url.endsWith('previews.json')) {
        if (first && transient === 'stale') { first = false; return publication([]); }
        return publication();
      }
      if (first && transient === '404') { first = false; throw new Error('Preview metadata unavailable (404)'); }
      return { schema: 1, pr: 10, sha: HEAD, buildSha: MAIN, basePath: new URL(item.url).pathname };
    } });
    assert.deepEqual(await task.run(), [{ number: 10, action: 'created' }]);
    assert.equal(task.writes().length, 1);
    assert.deepEqual(task.pauses, [10000]);
  }
});

test('a publication superseded while listing comments is rejected before mutation', async () => {
  let reads = 0;
  const task = harness({ readJson: async url => {
    if (url.endsWith('previews.json')) return ++reads === 1 ? publication() : publication([]);
    return { schema: 1, pr: 10, sha: HEAD, buildSha: MAIN, basePath: new URL(preview().url).pathname };
  } });
  await assert.rejects(task.run(), /does not match this publication/);
  assert.equal(task.writes().length, 0);
});

test('an empty publication does not touch APIs or alter old comments', async () => {
  const task = harness({ manifest: publication([]) });
  assert.deepEqual(await task.run(), []);
  assert.equal(task.requests.length, 0);
  assert.equal(task.reads.length, 0);
});

test('the API permits only repository PR reads and JSON comment POST/PATCH requests; failures are not retried', async () => {
  const calls = [];
  const api = commenter.createCommentApi('test-token', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 42 }), { status: 201 });
  });
  const body = 'literal `code` $(no shell) "quotes"\nnew line';
  await api(`${PREFIX}/issues/10/comments`, { method: 'POST', body });
  assert.equal(calls[0].url, `https://api.github.com${PREFIX}/issues/10/comments`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { body });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].options.redirect, 'error');
  for (const [route, request] of [[`${PREFIX}/issues/comments/42`, { method: 'DELETE' }],
    [`${PREFIX}/contents/test`, { method: 'PUT', body }], ['/repos/other/repo/issues/10/comments', { method: 'POST', body }],
    [`${PREFIX}/issues/10/comments/../../pulls/1`, { method: 'POST', body }],
    [`${PREFIX}/pulls/10`, { method: 'GET', body }]]) {
    await assert.rejects(api(route, request), /Unexpected|Invalid/);
  }
  assert.equal(calls.length, 1);
  let failures = 0;
  const failed = commenter.createCommentApi('test-token', async () => { failures++; throw new Error('connection lost'); });
  await assert.rejects(failed(`${PREFIX}/issues/10/comments`, { method: 'POST', body }), /connection lost/);
  assert.equal(failures, 1);
});

test('site checks never forward credentials or redirects, bypass caches, and bound downloaded JSON', async () => {
  const calls = [];
  const read = commenter.createSiteReader(BASE, '123.2', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(publication()));
  });
  assert.deepEqual(await read(`${BASE}pr/previews.json`), publication());
  assert.equal(calls[0].url, `${BASE}pr/previews.json?preview_run=123.2&check=1`);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
  await read(`${BASE}pr/previews.json`);
  assert.equal(calls[1].url, `${BASE}pr/previews.json?preview_run=123.2&check=2`);
  await assert.rejects(read('https://evil.example/pr/previews.json'), /Unexpected site/);
  await assert.rejects(read(`${BASE}pr/previews.json?url=other`), /Unexpected site/);
  const large = commenter.createSiteReader(BASE, '123.2', async () => new Response('x'.repeat(1024 * 1024 + 1)));
  await assert.rejects(large(`${BASE}pr/previews.json`), /byte limit/);
  const missing = commenter.createSiteReader(BASE, '123.2', async () => new Response('', { status: 404 }));
  await assert.rejects(missing(`${BASE}pr/previews.json`), /404/);
});

test('comment CLI stays default-off before checkout validation or network access', () => {
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, '../scripts/comment-previews.cjs')], {
    env: { ...process.env, SPACE_MAN_PREVIEWS_ENABLED: '', GITHUB_TOKEN: '', GITHUB_REPOSITORY: 'picatz/space-man' }, stdio: 'pipe',
  }), error => /Pages previews are disabled/.test(error.stderr.toString()));
});

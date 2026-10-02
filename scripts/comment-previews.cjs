#!/usr/bin/env node
'use strict';

// Run after deploy succeeds, from the exact trusted-main checkout. Never load
// PR code or accept comment text, destinations, or URLs from a PR artifact.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { REPOSITORY, trustedPull, allPages, siteBase } = require('./publish-pages.cjs');

const MARKER = '<!-- space-man-pr-preview -->';
const SHA = /^[a-f0-9]{40}$/;
const PREFIX = `/repos/${REPOSITORY}`;
const JSON_BYTES_LIMIT = 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validNumber(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateManifest(manifest, base, mainSha) {
  assert(/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\/$/i.test(base), 'Invalid trusted site URL');
  assert(SHA.test(mainSha) && manifest?.version === 1 &&
    manifest.production?.sha === mainSha && manifest.production.url === base, 'Unexpected deployed production identity');
  assert(Array.isArray(manifest.previews) && manifest.previews.length < 256, 'Invalid preview manifest');
  for (const item of manifest.previews) {
    assert(validNumber(item.number) && typeof item.sha === 'string' && SHA.test(item.sha) && item.buildSha === mainSha &&
      item.url === `${base}pr/${item.number}/${item.sha}/${mainSha}/`, 'Invalid preview identity or URL');
  }
  assert(new Set(manifest.previews.map(item => item.number)).size === manifest.previews.length, 'Duplicate preview identity');
  return manifest;
}

function createCommentApi(token, fetchImpl = fetch) {
  assert(token, 'GITHUB_TOKEN is required');
  return async function api(route, request = {}) {
    const method = request.method || 'GET';
    const local = route.startsWith(PREFIX) ? route.slice(PREFIX.length) : '';
    const allowed = method === 'GET' && (/^\/pulls\/[1-9][0-9]*$/.test(local) ||
      /^\/issues\/[1-9][0-9]*\/comments\?per_page=100&page=[1-9][0-9]*$/.test(local)) ||
      method === 'POST' && /^\/issues\/[1-9][0-9]*\/comments$/.test(local) ||
      method === 'PATCH' && /^\/issues\/comments\/[1-9][0-9]*$/.test(local);
    assert(allowed, 'Unexpected comment API request');
    assert(method === 'GET' ? request.body === undefined : typeof request.body === 'string', 'Invalid comment API body');
    const response = await fetchImpl(`https://api.github.com${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(method === 'GET' ? {} : { body: JSON.stringify({ body: request.body }) }),
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    assert(response.ok, `GitHub comment API failed (${response.status}): ${route}`);
    // Do not retry mutations: an uncertain POST may already have created a comment.
    return response.json();
  };
}

function createSiteReader(base, run, fetchImpl = fetch) {
  assert(/^[1-9][0-9]*\.[1-9][0-9]*$/.test(run), 'Invalid Actions run identity');
  let request = 0;
  return async function readJson(url) {
    assert(url.startsWith(`${base}pr/`) && !/[?#]/.test(url), 'Unexpected site metadata URL');
    const response = await fetchImpl(`${url}?preview_run=${run}&check=${++request}`, {
      // Never send the GitHub token to Pages, and never follow a redirect.
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    assert(response.ok, `Preview metadata unavailable (${response.status})`);
    let bytes = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      assert(bytes <= JSON_BYTES_LIMIT, 'Preview metadata exceeds the byte limit');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
}

async function verifyLiveManifest(manifest, base, readJson) {
  const live = validateManifest(await readJson(`${base}pr/previews.json`), base, manifest.production.sha);
  assert(live.previews.length === manifest.previews.length && manifest.previews.every(expected =>
    live.previews.some(item => item.number === expected.number && item.sha === expected.sha &&
      item.buildSha === expected.buildSha && item.url === expected.url)), 'Deployed preview set does not match this publication');
}

function commentBody(item) {
  return `${MARKER}\n[Play preview](${item.url}) · \`${item.sha.slice(0, 7)}\``;
}

function ownedComment(comment) {
  return validNumber(comment.id) && comment.user?.login === 'github-actions[bot]' &&
    comment.user.type === 'Bot' && typeof comment.body === 'string' &&
    comment.body.startsWith(`${MARKER}\n`);
}

async function verifyLivePreview(manifest, item, base, readJson) {
  await verifyLiveManifest(manifest, base, readJson);
  const metadata = await readJson(`${item.url}preview-build.json`);
  assert(metadata?.schema === 1 && metadata.pr === item.number && metadata.sha === item.sha &&
    metadata.buildSha === item.buildSha && metadata.basePath === new URL(item.url).pathname,
  `PR #${item.number} deployed build metadata mismatch`);
}

async function commentPreviews(manifest, { base, mainSha, api, readJson, pause = ms =>
  new Promise(resolve => setTimeout(resolve, ms)), attempts = 13 }) {
  validateManifest(manifest, base, mainSha);
  if (!manifest.previews.length) return [];
  // Allow Pages' public edge a short propagation window after deploy succeeds.
  for (let attempt = 1; ; attempt++) {
    try {
      for (const item of manifest.previews) await verifyLivePreview(manifest, item, base, readJson);
      break;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`Waiting for matching Pages metadata (${attempt}/${attempts}): ${error.message}`);
      await pause(10000);
    }
  }
  const results = [];
  for (const item of manifest.previews) {
    const comments = await allPages(api, `${PREFIX}/issues/${item.number}/comments`);
    const existing = comments.filter(ownedComment).sort((a, b) => a.id - b.id)[0];
    await verifyLivePreview(manifest, item, base, readJson);
    // Check eligibility last, immediately before the write. A push/close while
    // building or waiting for Pages must not attach a stale preview to a PR.
    const pull = await api(`${PREFIX}/pulls/${item.number}`);
    if (!trustedPull(pull) || pull.number !== item.number || pull.head.sha !== item.sha) {
      results.push({ number: item.number, action: 'skipped' });
      continue;
    }
    const body = commentBody(item);
    if (existing?.body === body) results.push({ number: item.number, action: 'unchanged' });
    else {
      await api(existing ? `${PREFIX}/issues/comments/${existing.id}` : `${PREFIX}/issues/${item.number}/comments`,
        { method: existing ? 'PATCH' : 'POST', body });
      results.push({ number: item.number, action: existing ? 'updated' : 'created' });
    }
  }
  return results;
}

async function main() {
  assert(process.env.SPACE_MAN_PREVIEWS_ENABLED === 'true', 'Pages previews are disabled');
  assert(process.env.GITHUB_REPOSITORY === REPOSITORY, 'Unexpected repository');
  const trusted = path.resolve(__dirname, '..');
  const mainSha = process.env.EXPECTED_MAIN_SHA;
  assert(SHA.test(mainSha || ''), 'Invalid trusted main SHA');
  assert(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: trusted, encoding: 'utf8' }).trim() === mainSha,
    'Trusted checkout SHA mismatch');
  const base = siteBase(trusted);
  const results = await commentPreviews(JSON.parse(process.env.PREVIEW_MANIFEST || 'null'), {
    base, mainSha, api: createCommentApi(process.env.GITHUB_TOKEN),
    readJson: createSiteReader(base, `${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT}`),
  });
  for (const result of results) console.log(`PR #${result.number}: preview comment ${result.action}`);
}

module.exports = { MARKER, validateManifest, createCommentApi, createSiteReader,
  verifyLiveManifest, commentBody, ownedComment, commentPreviews };
if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

/* Build identity is stamped by the trusted preview packager, never a query flag.
   Namespaces prevent accidental save/session overlap; same-origin JavaScript is
   still trusted code, so only owner-authored repository PRs may be published. */
(function (root) {
  'use strict';
  const node = root.document && root.document.querySelector('meta[name="space-man-preview"]');
  let preview = null, error = '';
  if (node) {
    try {
      const p = JSON.parse(node.getAttribute('content'));
      if (p.schema !== 1 || !Number.isSafeInteger(p.pr) || p.pr < 1 || !/^[a-f0-9]{40}$/.test(p.sha) || !/^[a-f0-9]{40}$/.test(p.buildSha)
          || p.basePath !== '/pr/' + p.pr + '/' + p.sha + '/' + p.buildSha + '/') throw new Error('Invalid preview identity');
      preview = Object.freeze({ schema: 1, pr: p.pr, sha: p.sha, buildSha: p.buildSha, basePath: p.basePath });
    } catch (_) { error = 'This preview has an invalid build identity. Open the latest link from its pull request.'; }
  }
  const pathname = root.location && root.location.pathname || '/';
  if (preview && pathname !== preview.basePath && pathname !== preview.basePath + 'index.html') {
    error = 'This preview is at the wrong URL. Open the exact commit link from its pull request.';
  } else if (!preview && /^\/pr\//.test(pathname)) {
    error = 'The production cache intercepted this preview. Open the main game, finish its update, then reopen the preview link.';
  }
  const prefix = preview ? 'sm2.preview.' + preview.pr + '.' + preview.sha + '.' + preview.buildSha + '.' : '';
  const build = {
    preview, error,
    storageKey(key) { return prefix + key; },
    // Room codes and bare invite payloads carry no commit identity. Preview
    // players use full links; direct #j= navigation already has the exact path.
    resolveJoin(input) {
      const value = String(input || '').trim();
      const matches = value.match(/https?:\/\/[^\s]+/g) || [];
      const urls = matches.map((match) => { try { return new URL(match); } catch (_) { return null; } }).filter(Boolean);
      const isPreview = (url) => /^\/pr\/[1-9]\d*\/[a-f0-9]{40}\/[a-f0-9]{40}\/(?:index\.html)?$/.test(url.pathname);
      if (preview) {
        const url = urls.length === 1 ? urls[0] : null;
        if (!url || url.username || url.password || url.search || url.origin !== root.location.origin
            || (url.pathname !== preview.basePath && url.pathname !== preview.basePath + 'index.html')) {
          return { error: 'Paste the full invite link from this exact preview build. Room codes cannot identify a preview commit.' };
        }
        // Pass ONLY the identity-checked URL to the invite codec. Another #j=
        // elsewhere in a pasted sentence cannot smuggle a different payload.
        return { value: url.href, error: '' };
      }
      if (urls.some(isPreview)) {
        return { error: 'Open that preview invite link directly so you and your friend use the same build.' };
      }
      return { value, error: '' };
    },
    inviteError(input) { return build.resolveJoin(input).error; },
    show() {
      if (!preview && !error) return;
      const el = root.document.createElement('div');
      el.id = 'previewBuild';
      el.textContent = error || 'PREVIEW · PR #' + preview.pr + ' · ' + preview.sha.slice(0, 7);
      el.setAttribute('role', error ? 'alert' : 'status');
      el.className = 'game-status' + (error ? ' game-status-error' : '');
      if (preview) {
        const label = 'Preview PR #' + preview.pr + ' · source ' + preview.sha + ' · builder ' + preview.buildSha;
        el.setAttribute('title', label);
        el.setAttribute('aria-label', error || label);
      }
      // Passive status belongs in the shared reserved rail, never over the
      // bottom thumb controls. Canvas and DOM HUDs consume its safe inset.
      root.document.getElementById('gameStatusRail').appendChild(el);
    },
  };
  root.SpaceManBuild = Object.freeze(build);
})(typeof window !== 'undefined' ? window : globalThis);

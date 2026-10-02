# Playable preview verification

This documentation-only change exercises the owner-authored pull-request preview workflow without changing gameplay.

After the Pages and PR previews workflow publishes this revision:

1. Open the preview from the workflow summary or production `/pr/` index.
2. Confirm `preview-build.json` identifies this PR's exact source revision and the trusted main builder revision.
3. Start a game in both production and the preview, and confirm the preview badge and independent saved state.
4. Share a full invitation link and confirm it stays on the same preview build.

Keep this PR open until the published link has been verified and recorded in the PR discussion.

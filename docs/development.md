# Development checkpoints

Treat execution workspaces and temporary folders as disposable. Commit and push
meaningful progress to a dedicated feature branch early, including work in
progress. Verify the remote branch points to the intended commit before relying
on the checkpoint. Keep recovery scripts and essential project artifacts in the
repository rather than only in temporary storage. Never commit credentials or
private test session keys.

Open unfinished changes as draft pull requests and distinguish completed checks
from pending checks. A remote checkpoint is a backup, not a release approval.
Rebase onto the intended base and run the full required regression, browser and
workflow checks against the final commit before merging or calling it ready.

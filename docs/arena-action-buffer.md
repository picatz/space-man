# Bounded late action input

Offline Arena and the authoritative room host allow a fresh Pulse or Dash tap
up to six simulation ticks before its existing lock ends. The pending intent
expires after six observed ticks or 100 ms of monotonic wall time, whichever
comes first. It executes once when the original action conditions permit it.
Cooldowns, invulnerability, air-dash resources, damage, knockback and CPU rules
are unchanged. The existing jump buffer is unchanged.

The single pending intent never stacks. A newer deliberate action replaces it.
Simultaneous requests retain Dash's existing priority when Dash is eligible;
an unavailable Dash does not suppress an eligible Pulse. Execution uses current
movement/aim inputs, never replays old steering. Holding a button does not repeat
an action. Presses earlier than the bounded window are not stored.

Pause/menu, input ownership, touch cancellation, loss of control, stun,
death/respawn, changed fighter/seat/stock, epoch changes, clock rollback and
expired time invalidate a pending intent. A new input on the final stun tick
still follows the original authority rules. Ordinary key-up ends a hold but
does not erase a valid short tap.

## Online scope

Guests retain the previous fresh-input transmission path byte-for-byte at the
command boundary. Their displayed cooldowns may be stale: suppressing an input
because a snapshot still shows recovery would discard actions the authority
can already accept. Guessing and retransmitting actions could create delayed
surprises. Equal guest buffering requires a separately designed acknowledged
action/cancellation protocol; it is not implemented here.

The host uses its coordinator's live `isHost` role and the per-tick authoritative
presentation introduced in PR 56. No pending intent is serialized, and no codec,
packet size, authority, sequence or capability version changes are needed.

## Verification

- `tests/arena-action-buffer.test.cjs`: window boundaries, authority outcomes,
  cooldown/resources, simultaneous priority, cancellation, time rollback and
  guest loss/reordering passthrough
- `tests/arena-buffer-input.test.cjs`: extracted production keyboard, touch and
  gamepad handlers for offline, host and guest; pause/resume, cancellation and
  ownership transitions
- `tests/browser/arena-action-buffer.test.cjs`: real keyboard/touch and simulated
  standard gamepad Pulse presses against the running browser simulation

These tests establish command behavior, not a claim that all Arena gameplay
feels good or that network latency has disappeared.

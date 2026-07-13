# Space Man — Run Together Wire Protocol

**Status:** public, versioned interoperability specification.
**Protocol version:** `1` (the app-envelope version byte; see [§13](#13-protocol-version--compatibility)).
**Audience:** an engineer building a third-party client (TUI, native mobile, bot, test
harness) that must interoperate with Space Man rooms without access to the reference
implementation.

This document describes the protocol **as implemented**. Where the historical design notes
disagree with the shipping code, the code is authoritative and the discrepancy is called
out inline and collected in [§14](#14-conflicts-between-code-and-prior-spec).

Throughout, a "relay" is a store-and-forward node reached over `wss://`. It never sees
plaintext: all application traffic is end-to-end encrypted between the host and each guest.
The relay protocol tokens that a client MUST reproduce byte-for-byte to interoperate — the
URL path `/derp`, the WebSocket subprotocol `derp`, and the 8-byte hello magic — are wire
**data**, quoted here verbatim for that reason.

---

## Table of contents

1. [Conventions & notation](#1-conventions--notation)
2. [Transport: relay connection lifecycle](#2-transport-relay-connection-lifecycle)
3. [Relay frame format & byte-stream reassembly](#3-relay-frame-format--byte-stream-reassembly)
4. [Relay frame catalog](#4-relay-frame-catalog)
5. [Relay handshake (byte-exact)](#5-relay-handshake-byte-exact)
6. [Keys & key derivation](#6-keys--key-derivation)
7. [AEAD envelopes, nonces & replay rules](#7-aead-envelopes-nonces--replay-rules)
8. [Invite `#j=` codec & join proof](#8-invite-j-codec--join-proof)
9. [Short-code rendezvous channel](#9-short-code-rendezvous-channel)
10. [Application frames (byte-by-byte)](#10-application-frames-byte-by-byte)
    - [10.1 HELLO (0x01)](#101-hello-0x01)
    - [10.2 WELCOME (0x02)](#102-welcome-0x02)
    - [10.3 ROSTER (0x03)](#103-roster-0x03)
    - [10.4 PRES (0x04)](#104-pres-0x04)
    - [10.5 SNAP (0x05)](#105-snap-0x05)
    - [10.6 ROLE (0x0c)](#106-role-0x0c)
    - [10.7 Control-frame envelope (hostEpoch/seq gate)](#107-control-frame-envelope-hostepochseq-gate)
    - [10.8 Frames specified but not in this snapshot](#108-frames-specified-but-not-in-this-snapshot)
11. [Frame-type space partitioning](#11-frame-type-space-partitioning)
12. [Roles, capabilities, callsigns, roster & directory](#12-roles-capabilities-callsigns-roster--directory)
13. [Protocol version & compatibility](#13-protocol-version--compatibility)
14. [Conflicts between code and prior spec](#14-conflicts-between-code-and-prior-spec)
15. [Strikes, bans & rate limits a client MUST enforce](#15-strikes-bans--rate-limits-a-client-must-enforce)
16. [Security invariants (conformance requirements)](#16-security-invariants-conformance-requirements)
17. [Worked example: an annotated HELLO](#17-worked-example-an-annotated-hello)
18. [Constant reference](#18-constant-reference)

---

## 1. Conventions & notation

- **Byte order.** Two different orders coexist, deliberately:
  - **Relay transport layer** (frame headers, `Restarting` durations) is **big-endian**.
  - **Everything application-layer** (app frames, AEAD counter, AAD, invite integers, the
    relay `Ping`/`Pong` 8-byte token, control-frame `seq`) is **little-endian**.
- **Offsets** are 0-based, in bytes, relative to the start of the structure being described
  (the frame type byte is at offset 0 of every application frame).
- **Strings** are fixed-width ASCII, zero-padded, never length-prefixed unless stated.
  There is no JSON or CBOR on the application hot path.
- **Field rules** (borrowed from the reference implementation):
  - **C** = *clamp on read* — an out-of-range value is clamped to the legal range; **no
    strike**. A buggy client renders oddly, never gets banned.
  - **W** = *whitelist* — an unrecognized value falls back to a safe default; **no strike**.
  - **S** = *strike* — a violation counts toward the 3-strike ban ([§15](#15-strikes-bans--rate-limits-a-client-must-enforce)).
- **MUST / SHOULD / MAY** follow RFC 2119 intent. A "conforming client" is one that a host
  will not strike or ban for well-formed traffic, and that will not crash on hostile input.
- **Topology is a star.** Guests speak only to the host. The host fans out to every guest.
  There is no guest-to-guest traffic; a guest MUST drop any application packet whose relay
  source key is neither the current host nor (transiently) the short-code listener key.

---

## 2. Transport: relay connection lifecycle

### 2.1 Endpoint

- **URL:** `wss://<host>/derp` — the path is exactly `/derp`.
- **Subprotocol:** `derp` (required). The relay routes to its WebSocket handler only when
  the upgrade request carries `Sec-WebSocket-Protocol: derp`.
- **Binary only.** `binaryType = "arraybuffer"`. All messages are binary. Compression is
  not requested and is ignored if offered.
- **Port** is whatever the host string specifies; public directory nodes serve on 443. A
  custom relay MAY specify `wss://host:port/derp`.

Reference open:

```js
const ws = new WebSocket('wss://' + host + '/derp', 'derp');
ws.binaryType = 'arraybuffer';
```

### 2.2 State machine

```
IDLE → CONNECTING → HANDSHAKE → ESTABLISHED → (DOWN) → CLOSED
```

| State | Entry | Timeout / exit |
|---|---|---|
| CONNECTING | `new WebSocket(...)` | **8 s** connect timeout (`T_CONNECT`) → `DOWN` |
| HANDSHAKE | socket `open` | **5 s** timeout (`T_HANDSHAKE`) → `DOWN` |
| ESTABLISHED | `NotePreferred` sent ([§5](#5-relay-handshake-byte-exact)) | see liveness below |
| DOWN | any failure/violation | schedule reconnect (backoff) |
| CLOSED | explicit `close()` | terminal |

### 2.3 Liveness & keepalive

- **Inbound liveness.** The relay sends `KeepAlive` (type `0x06`) at least once per ~60 s.
  **Any** inbound frame refreshes `lastRecv`. If `now - lastRecv > 90 s` (`T_DEAD`), the
  client declares the socket dead and reconnects. The liveness sweep runs every 5 s.
- **Outbound liveness / RTT.** When ESTABLISHED and send-idle for **25 s** (`T_PING_IDLE`),
  the client sends `Ping` (type `0x12`) with an 8-byte payload: a **little-endian u32
  counter** in the first 4 bytes (remaining 4 bytes are unused/zero). The relay echoes it
  in a `Pong` (type `0x13`); the RTT sample updates an EWMA `rtt = 0.7·rtt + 0.3·sample`.
  The client MUST also answer inbound `Ping` with `Pong` echoing the first 8 bytes (the
  handshake advertises `CanAckPings:true`).
- The client keeps at most 8 outstanding ping tokens; older ones are evicted.

### 2.4 Reconnect backoff

- On a dead socket or failed connect: delay = `min(500ms · 2ⁿ, 10s)` with **±25 % full
  jitter** (`base · (0.75 + random·0.5)`), where `n = min(attempts, 6)`.
- After 30 s (`BACKOFF_RESET`) of healthy ESTABLISHED, `attempts` resets to 0.
- A `Restarting(a, b)` frame ([§4](#4-relay-frame-catalog)) closes and reconnects after
  `a` ms with **no** backoff penalty.
- Reconnect stampede control (relevant when many clients follow a host at once): spread
  reconnects with uniform **0–2 s** jitter (`RECONNECT_JITTER`).

### 2.5 Absent-key semantics

Sends to a key not currently connected to the relay are **silently dropped** — no error
frame is returned. Liveness is therefore an application-level concern, not a transport
signal. `PeerGone` (below) is an advisory accelerant for detecting a fast leave, never the
source of truth.

---

## 3. Relay frame format & byte-stream reassembly

**The relay treats the WebSocket as a byte *stream*, not a message boundary.** A single
WebSocket message may carry several relay frames, or a fraction of one. A conforming client
MUST reassemble.

### 3.1 Frame header

```
offset  size  field
0       1     u8   frameType
1       4     u32  length   (BIG-ENDIAN, payload length only, excludes this 5-byte header)
5       len   ...  payload
```

Header length is fixed at **5 bytes**. Keys carried in payloads are **32-byte** X25519
public keys.

### 3.2 Reassembly rules (MUST)

- Allocate **one** reassembly buffer of `131072` bytes per connection, once, at connect.
- Append each inbound WebSocket message. If appending would overflow the buffer, treat it
  as a protocol violation → close + reconnect.
- Parse loop: while at least 5 buffered bytes remain, read the header. If the declared
  `length > 65536` (`RELAY_FRAME_MAX`), it is a **protocol violation** → close + reconnect
  (legitimate frames are far smaller; app packets are ≤ 256 bytes). If fewer than `length`
  payload bytes are buffered, stop and wait for more data. Otherwise slice out one complete
  frame, advance, repeat.
- After draining complete frames, compact the buffer (move the tail to offset 0).
- Frames are dispatched in order; an application-layer fault while handling one frame MUST
  NOT recycle the transport (strike logic lives above the transport — see [§15](#15-strikes-bans--rate-limits-a-client-must-enforce)).

---

## 4. Relay frame catalog

Values are the relay wire contract. Direction: **S→C** relay-to-client, **C→S**
client-to-relay.

| Name | Type | Dir | Payload | Client action |
|---|---|---|---|---|
| ServerKey | `0x01` | S→C | 8-byte magic + 32-byte relay pubkey (accept ≥ 40 B; read first 40) | handshake step 1 |
| ClientInfo | `0x02` | C→S | 32-byte client pubkey + 24-byte nonce + secretbox(JSON) | handshake step 2 |
| ServerInfo | `0x03` | S→C | 24-byte nonce + secretbox(JSON) | handshake step 3 (best-effort decrypt) |
| SendPacket | `0x04` | C→S | 32-byte dst pubkey + opaque app packet | all outbound app traffic |
| RecvPacket | `0x05` | S→C | 32-byte src pubkey + opaque app packet | all inbound app traffic |
| KeepAlive | `0x06` | S→C | empty | liveness credit only |
| NotePreferred | `0x07` | C→S | 1 byte (`0x01`) | send once, post-handshake |
| PeerGone | `0x08` | S→C | 32-byte peer key + optional 1-byte reason (`0`=disconnected, `1`=not here) | advisory fast-leave hint |
| Ping | `0x12` | both | 8 bytes | send for RTT; answer inbound with Pong |
| Pong | `0x13` | both | 8-byte echo | RTT sample / server ack |
| Health | `0x14` | S→C | UTF-8 text | log, non-fatal |
| Restarting | `0x15` | S→C | 2× u32 **big-endian** (reconnect-in ms, try-for ms) | close, reconnect after first value ms |

**Unknown / unimplemented types are skipped silently** (forward compatibility). Types
`0x09` (PeerPresent), `0x0a` (ForwardPacket), `0x10` (WatchConns), `0x11` (ClosePeer) are
relay/mesh-side and never sent by a client; if received they are skipped.

**Magic (8 bytes):** `44 45 52 50 F0 9F 94 91`. (These bytes render as ASCII `DERP`
followed by U+1F511 in UTF-8; treat them purely as a fixed constant to match.)

---

## 5. Relay handshake (byte-exact)

The client's relay identity key **is** the player's session keypair ([§6](#6-keys--key-derivation)).
One relay connection per keypair — which is why the short-code listener ([§9](#9-short-code-rendezvous-channel))
is a *second* connection.

1. **Receive `ServerKey`.** Verify the first 8 bytes equal the magic. Bytes `8..40` are the
   relay's X25519 public key `S_pub`. Wrong magic or a short payload → close, try the next
   host in the region.
2. **Compute the relay box key.** `boxK = HSalsa20(0, X25519(clientPriv, S_pub))` — i.e. the
   NaCl `box_beforenm` precomputation ([§7.4](#74-nacl-secretbox-relay-handshake--code-channel)).
3. **Send `ClientInfo`.** Payload = `clientPub(32) || nonce(24, random) || secretbox(json,
   nonce, boxK)` where
   `json = {"version":2,"CanAckPings":true}` (send these bytes exactly; field casing is
   part of the contract).
4. **Receive `ServerInfo`.** Payload = `nonce(24) || secretbox(json, nonce, boxK)`. Open
   best-effort; the JSON MAY carry `TokenBucketBytesPerSecond` / `TokenBucketBytesBurst`.
   A decryption failure is treated as a tamper signal → close + reconnect (repeated failure
   → surface "relay unavailable").
5. **Send `NotePreferred(0x01)`** (1-byte payload `0x01`). The connection is now ESTABLISHED.

**Send path.** `SendPacket` payload = `dstPub(32) || appEnvelope` where `appEnvelope` is the
`'S'` AEAD envelope of [§7.1](#71-app-envelope-s--0x53). **Receive path.** `RecvPacket`
payload = `srcPub(32) || appEnvelope`. A `RecvPacket` shorter than 32 bytes is ignored.

---

## 6. Keys & key derivation

### 6.1 Session identity

An ephemeral **X25519** keypair, generated when a room is opened or an invite is accepted —
never earlier, never persisted beyond the 15-minute rejoin token. The public key is the
peer's identity on the relay and in the roster.

Clients detect native X25519 (`crypto.subtle`) once at first use and fall back to a vendored
scalar-mult if unavailable. Either way the **raw 32-byte private key must be recoverable**
(needed for the NaCl-box relay handshake and for the rejoin token). Vendored private keys
are 32 random bytes clamped `k[0] &= 248; k[31] &= 127; k[31] |= 64`, public = `X25519(k, 9)`.

### 6.2 Per-pair AEAD key

Star topology → a key exists only per (host, guest) pair.

```
ss      = X25519(myPriv, theirPub)                                    // 32 bytes
lo, hi  = the two public keys ordered by lowercase-hex string compare // lexmin, lexmax
pairKey = HKDF-SHA256(
            ikm  = ss,
            salt = roomId(8 bytes) || epoch(1 byte),
            info = "smnet1" || lo(32) || hi(32),
            L    = 32 )
```

`pairKey` is imported as a **non-extractable AES-GCM** key. `epoch` is a u8 bumped on
rotate-link; bumping it re-derives all pair keys, and frames sealed under the old epoch fail
AEAD and are dropped.

> Note: `roomId` appears in the salt as its raw 8 bytes (the reference derives it from the
> invite's `roomId` field verbatim). It also appears in the AAD ([§7.2](#72-nonce-aad--counter)).

---

## 7. AEAD envelopes, nonces & replay rules

### 7.1 App envelope (`'S'` = 0x53)

Every application frame ([§10](#10-application-frames-byte-by-byte)) is carried inside this
envelope, which is the opaque packet inside `SendPacket` / `RecvPacket`:

```
offset  size  field
0       1     0x53                 ('S')
1       1     0x01                 envelope version = PROTO = 1
2       1     dir                  0x01 guest→host, 0x02 host→guest
3       8     counter u64 LE       per (pairKey, dir), starts at 0, +1 per frame
11      ...   AES-GCM ciphertext   (plaintext frame + 16-byte tag appended)
```

Header overhead = **11 bytes**; AES-GCM tag = **16 bytes**. Total per-frame overhead = 27 B.

### 7.2 Nonce, AAD & counter

- **Nonce (96-bit, counter-based, never random):**
  `nonce = dir(1) || counter(u64 LE, 8) || 0x00 0x00 0x00`.
- **AAD (11 bytes):** `ver(1)=1 || roomId(8) || epoch(1) || dir(1)`.
- Counter starts at 0 and increments by 1 per sent frame per (pairKey, dir). At 2³² frames
  the pair is exhausted and MUST be closed (unreachable in practice — assert anyway).

### 7.3 Replay rule (MUST)

The receiver keeps `highSeen` per (pair, dir), initialized to `-1`. Decode order:

1. `wire.length > 256` → error `size` (**strike**), before any decryption.
2. `wire.length < 27` or byte 0 ≠ `0x53` or byte 1 ≠ `1` → error `ver` (**strike**).
3. byte 2 ≠ the peer's expected direction → error `dir` (**strike**).
4. `counter ≤ highSeen` → error `replay` (**strike**).
5. AES-GCM open with the derived nonce/AAD; failure → error `aead` (**strike**).
6. On success, set `highSeen = counter` and deliver the plaintext.

`highSeen` advances **only** after a successful open, so forged/garbage frames cannot burn
counter space. Accept is strictly monotonic (`counter > highSeen`); late or duplicate frames
are dropped. At 10 Hz presence this reorder loss is invisible.

### 7.4 NaCl secretbox (relay handshake & code channel)

The relay handshake and the short-code channel use XSalsa20-Poly1305 (`crypto_secretbox` /
`crypto_box`), because the relay mandates NaCl box and browsers have no XSalsa20 primitive.
Box construction: `k = HSalsa20(0, X25519(myPriv, theirPub))`; seal/open are standard NaCl
secretbox (`tag(16) || ciphertext`, Poly1305 keyed by the first 32 stream bytes). Nonces on
the code channel are **random 24-byte** values (no counter state exists pre-join).

### 7.5 Code-channel envelope (`'C'` = 0x43)

```
offset  size  field
0       1     0x43                 ('C')
1       1     0x01                 version = 1
2       24    nonce                random
26      ...   NaCl box(payload)    crypto_box(payload, nonce, theirPub, myPriv) = tag(16)||ct
```

Minimum length 42 bytes (2 + 24 + 16). Used only by the short-code rendezvous ([§9](#9-short-code-rendezvous-channel)).

---

## 8. Invite `#j=` codec & join proof

An invite is a fixed-order binary payload, base64url-encoded (alphabet
`A-Za-z0-9-_`, **no padding**), placed in the URL fragment:
`…/#j=<base64url(payload)>`.

### 8.1 Binary layout

| offset | size | field | notes |
|---|---|---|---|
| 0 | 1 | `ver` | = `1`; unknown → refuse ("update to play together") |
| 1 | 1 | `flags` | bit0 = approve-joins hint; bit1 = custom relay present |
| 2 | 8 | `roomId` | random; room namespace + HKDF salt |
| 10 | 1 | `epoch` | current epoch at issue time |
| 11 | 32 | `hostPub` | pins the host — the trust root |
| 43 | 3 | `region` | ASCII region code, each byte masked `& 0x7f`; ignored if bit1 set |
| 46 | 1+n | `relayHost` | **only if `flags & 2`**: `u8 len` + ASCII `host[:port]`, `4 ≤ len ≤ 64` |
| … | 16 | `secret` | 128-bit room secret |
| … | 4 | `expiryMin` | Unix time in **minutes**, u32 LE |

Fixed-size total (no custom relay) = **66 bytes** → 88 base64url chars.

### 8.2 Decode & validation (MUST)

- Reject non-base64url input, or a decoded length `< 66` → `parse` error.
- Byte 0 ≠ 1 → `version` error.
- `region` must match `^[a-z0-9]{3}$` after decode, else `parse` error.
- If `flags & 2`: read `n = payload[46]`; require `4 ≤ n ≤ 64` and enough remaining bytes;
  `relayHost` must match `^[A-Za-z0-9.\-]+(:\d{1,5})?$`, else `relayhost` error (no scheme,
  no path — a bare host, optional port).
- After the (optional) relay host, read `secret(16)` and `expiryMin(u32 LE)`.
- If `Date.now()/60000 > expiryMin` → `expired` error.

The invite is decoded **only after the user opts in** (tapping "Join"). Reading the URL
fragment is free; decoding keys is not.

### 8.3 Join proof

```
proof   = HMAC-SHA256(secret, "join1" || roomId(8) || epoch(1) || guestPub(32) || hostPub(32))[0:16]
```

The guest puts this 16-byte proof in HELLO ([§10.1](#101-hello-0x01)). The host recomputes
it; a mismatch is a **silent drop + strike** (no reply — no oracle for secret-guessers).
Because the proof binds `guestPub`, `roomId`, and `epoch`, it cannot be replayed by another
key, for another room, or across a rotate-link.

```
rejoinToken = HMAC-SHA256(secret, "rejoin" || guestPub)[0:8]
```

Used for the 15-minute rejoin path (HELLO `rejoin8` field).

---

## 9. Short-code rendezvous channel

A human-shareable alternative to the invite link. **The code *is* a keypair** — possession
of the code is the capability (the same trust class as overhearing it spoken aloud).

- **Format:** `WORD-NN` — `WORD` from a curated 128-entry word list (each 4–6 letters,
  family-safe), `NN` two decimal digits. 128 × 100 = 12 800 combinations. A client
  validates a code against `^[A-Z]{4,6}-\d\d$` (uppercased, trimmed).
- **Derivation (region-scoped, so identical codes never collide across relays):**
  `seed = SHA-256("sm.code.v1|" + region + "|" + CODE)`; clamp → `codePriv`;
  `codePub = X25519(codePriv, 9)`. Both host and guest derive the full keypair.
- **Host** opens a **second** relay connection authenticated as `codePub` and listens.
- **Guest** connects with a throwaway keypair `tmp`, and sends a `CODEREQ` to `codePub`
  inside a `'C'` envelope ([§7.5](#75-code-channel-envelope-c--0x43)) sealed **to** `codePub`
  **from** `tmpPriv`.
- **Host** replies with a `CODERESP` carrying the full invite bytes, sealed from `codePriv`
  to `tmpPub`. Opening the reply against `codePub` authenticates the host as the code owner;
  the guest then joins normally with the invite.

### 9.1 Code-channel frame types (payload inside the `'C'` box)

| Name | Type | Layout |
|---|---|---|
| CODEREQ | `0x01` | `type(1) || tmpPub(32)` — 33 bytes. `tmpPub` MUST equal the relay `src` key. |
| CODERESP | `0x02` | `type(1) || inviteLen(u16 LE) || inviteBytes` |

Host obligations: verify the sealed `tmpPub` equals the relay source key; rate-limit replies
to **≤ 6 per minute** and **≤ 64 per room lifetime**; anything else is silence (blind-scan
posture). Guest obligations: accept a reply only from `srcPub == codePub`; reject
`inviteLen > 200` or a truncated body; give up after a 10-second timeout.

---

## 10. Application frames (byte-by-byte)

All application frames sit **inside** the `'S'` AEAD envelope ([§7.1](#71-app-envelope-s--0x53)).
Plaintext layout is always `type(u8 @ offset 0) || body`, integers **little-endian**.

**Hard size cap:** plaintext ≤ **229 bytes** (⇒ wire ≤ 256 bytes including the 11-byte
envelope header + 16-byte tag). A receiver drops + strikes any *wire* packet exceeding 256
bytes before attempting decryption.

**Forward compatibility:** decoders MUST ignore trailing bytes beyond the fields they know,
and MUST default fields that are absent in a shorter (older-client) frame. An unknown
*type* in the **core** range is ignored silently (no strike); see [§11](#11-frame-type-space-partitioning).

### 10.1 HELLO (0x01)

Direction: **guest → host** (also used for reconnect / post-migration re-hello). Sent
sealed under the pair key. Total **43 bytes** (36-byte historical core + 7 appended bytes).

| offset | size | field | type | rule |
|---|---|---|---|---|
| 0 | 1 | type | u8 | = `0x01` |
| 1 | 1 | protoMin | u8 | **S** if `protoMin > protoMax` |
| 2 | 1 | protoMax | u8 | join rejected if no overlap with host `[1,1]` |
| 3 | 3 | tag | ASCII | **W**: `[A-Z0-9]{3}`, else `"AAA"` |
| 6 | 1 | suit | u8 | **W**: cosmetic index, else 0 |
| 7 | 1 | hat | u8 | **W**: cosmetic index, else 0 |
| 8 | 8 | rejoin8 | bytes | all-zero = fresh join; else `rejoinToken` ([§8.3](#83-join-proof)) — **S** if present but wrong |
| 16 | 1 | wantP | u8 | 0 or a previous P-number; honored only with a valid `rejoin8`; **C**→0 otherwise |
| 17 | 3 | reserved | bytes | must-ignore |
| 20 | 16 | proof16 | bytes | join proof ([§8.3](#83-join-proof)); mismatch → **silent drop + strike** |
| 36 | 1 | role | u8 | `0`=player, `1`=spectator; any other → player (**W**) |
| 37 | 4 | caps | u32 LE | capability bitfield ([§12.2](#122-capability-bitfield)) |
| 41 | 1 | adjIdx | u8 | callsign adjective index; `0xff` = none ([§12.3](#123-callsigns)) |
| 42 | 1 | nounIdx | u8 | callsign noun index; `0xff` = none |

A decoder accepts a body as short as 36 bytes: `role` defaults to player, `caps` to 0,
callsign indices to `0xff`, when their bytes are absent.

### 10.2 WELCOME (0x02)

Direction: **host → guest**. Total **23 bytes**.

| offset | size | field | type | notes |
|---|---|---|---|---|
| 0 | 1 | type | u8 | = `0x02` |
| 1 | 1 | proto | u8 | = 1; guest drops WELCOME whose `proto ≠ 1` |
| 2 | 1 | yourP | u8 | your P-number, 1..32 (1 is always the host) |
| 3 | 4 | seed | u32 LE | shared world seed |
| 7 | 1 | runId | u8 | current round id |
| 8 | 1 | epoch | u8 | current room epoch |
| 9 | 3 | hostTag | ASCII | **W** as `tag` |
| 12 | 1 | rosterN | u8 | roster size incl. host |
| 13 | 1 | boardN | u8 | leaderboard entry count (0 in this snapshot) |
| 14 | 1 | roomFlags | u8 | bit0 approve-joins, bit1 emotes-muted |
| 15 | 1 | hostEpoch | u8 | control-frame epoch ([§10.7](#107-control-frame-envelope-hostepochseq-gate)); default 0 |
| 16 | 4 | caps | u32 LE | host capability bitfield |
| 20 | 3 | reserved | bytes | must-ignore |

Guests MUST adopt `hostEpoch` **monotonically** — a WELCOME must never *rewind* the control
gate, or it would resurrect control frames the stale-epoch rule already killed. Older hosts
that omit bytes 15–19 leave `hostEpoch`/`caps` at their defaults.

### 10.3 ROSTER (0x03)

Direction: **host → all**, chunked. Carries roles and callsigns. Header is 5 bytes; each
entry is **41 bytes**; at most **5 entries** per chunk (5 × 41 + 5 = 210 ≤ 229).

Header:

| offset | size | field | rule |
|---|---|---|---|
| 0 | 1 | type = `0x03` | |
| 1 | 1 | op | `0` full, `1` join, `2` leave, `3` kick; **W**: op > 3 → drop whole frame |
| 2 | 1 | chunkIdx | (SHOULD be ≤ 8) |
| 3 | 1 | chunkTot | (SHOULD be ≤ 8) |
| 4 | 1 | count | ≤ 5; **S** if `> 5` or the body would overrun |

Entry (repeated `count` times, starting at offset 5):

| rel. offset | size | field | rule |
|---|---|---|---|
| 0 | 1 | P | 1..32; entry dropped if out of range (frame kept) |
| 1 | 32 | pub | peer public key |
| 33 | 3 | tag | **W** `[A-Z0-9]{3}` |
| 36 | 1 | suit | **W** |
| 37 | 1 | hat | **W** |
| 38 | 1 | role | `0` player / `1` spectator (any other → player) |
| 39 | 1 | adjIdx | callsign adjective; `0xff` none |
| 40 | 1 | nounIdx | callsign noun; `0xff` none |

For `op ∈ {2,3}` (leave/kick) the entries name P-numbers to remove. Invariant every guest
relies on: **P1 is always the host**, so the host public key is recoverable independent of
op ordering. A full 32-player roster is 7 chunks.

### 10.4 PRES (0x04)

Direction: **guest → host**, the 10 Hz heartbeat and leaderboard feed. Total **21 bytes**.
(Spectators MUST NOT send PRES — see [§12.1](#121-roles--spectators).)

| offset | size | field | type | rule |
|---|---|---|---|---|
| 0 | 1 | type | u8 | = `0x04` |
| 1 | 2 | seq | u16 LE | per-sender monotonic (interp ordering; replay already handled at AEAD) |
| 3 | 4 | x | f32 LE | **C** finite, `[-1e6, 4e6]`; **S** if NaN/Inf |
| 7 | 4 | y | f32 LE | **C** finite, `[-4000, 4000]`; **S** if NaN/Inf |
| 11 | 1 | vx | i8 | **C** ±127 (display lean only) |
| 12 | 1 | state | u8 | bit0 facing-right, bit1 onGround, bit2 deadRagdoll, bit3 inRun, bit4 slipstream; **mask `& 0x1f`** |
| 13 | 1 | chain | u8 | **C** 0..4 |
| 14 | 4 | score | u32 LE | **C** ≤ 9 999 999; per-runId monotonic (decrease → clamp to previous) |
| 18 | 2 | dist | u16 LE | **C** ≤ 60 000; per-runId monotonic |
| 20 | 1 | runId | u8 | round id; unknown → renders as ghost, excluded from board |

Per-runId monotonicity: if the incoming `runId` matches the last accepted row's `runId`,
`score`/`dist` are clamped upward to the previous values (desync-tolerant, no strike). A new
`runId` resets the trace.

### 10.5 SNAP (0x05)

Direction: **host → all**, batched presence fan-out. Header 4 bytes; each entry **19 bytes**
(`P` + a PRES body minus `seq`); at most **11 entries** (`SNAP_MAX`).
Max size = 4 + 11 × 19 = **213 bytes** plaintext.

Header:

| offset | size | field | notes |
|---|---|---|---|
| 0 | 1 | type = `0x05` | |
| 1 | 2 | tick | u16 LE | host ms `>> 4`, wraps |
| 3 | 1 | count | ≤ 11; frame rejected if `count > 11` or body overruns |

Entry (repeated, starting at offset 4):

| rel. offset | size | field | rule |
|---|---|---|---|
| 0 | 1 | P | 1..32; entry dropped if out of range (frame kept) |
| 1 | 4 | x | f32 LE | **C** / entry dropped if NaN |
| 5 | 4 | y | f32 LE | **C** / entry dropped if NaN |
| 9 | 1 | vx | i8 | |
| 10 | 1 | state | u8 | mask `& 0x1f` |
| 11 | 1 | chain | u8 | **C** 0..4 |
| 12 | 4 | score | u32 LE | **C** ≤ 9 999 999 |
| 16 | 2 | dist | u16 LE | **C** ≤ 60 000 |
| 18 | 1 | runId | u8 | |

The host round-robins live players so that, in a full room, every live player appears in a
SNAP at ≥ 4 Hz; when the room is ≤ 11 players everyone appears every tick (10 Hz). The
recipient's own row is included (enables self-echo). A sitting-out (spectator) host streams
no ghost of its own.

### 10.6 ROLE (0x0c)

Direction: **guest → host** — a role-change request. Total **4 bytes**.

| offset | size | field | notes |
|---|---|---|---|
| 0 | 1 | type = `0x0c` | |
| 1 | 2 | seq | u16 LE |
| 3 | 1 | newRole | `0` player / `1` spectator (any other → player) |

The host validates capability and rate (≤ 1 change / 10 s per key), applies it, and
**acknowledges via the next ROSTER broadcast** — there is no dedicated ack frame. A guest
switching *to* spectator MAY stop sending PRES immediately (always safe); a guest switching
*to* player MUST wait for the roster ack before sending PRES, or it will be struck for
`spectator-pres`.

### 10.7 Control-frame envelope (hostEpoch/seq gate)

Host-authoritative control frames (roster acks today; the reserved-range move/handoff/
migrate frames later) are wrapped so guests can reject stale or replayed control state. The
payload still rides the pair AEAD (that is the authenticity — only the host holds a given
guest's pair key, so an AEAD-valid frame *is* proof of host origin; there is no separate
signature in this snapshot). The envelope adds anti-replay and anti-stale-crown binding.

```
offset  size  field
0       1     type
1       8     roomId
9       1     hostEpoch
10      4     seq (u32 LE)
14      ...   body
```

Minimum 14 bytes. **Gate rule (guest MUST enforce):**

- If `roomId` ≠ my room → reject.
- If `hostEpoch < gate.epoch` → reject (**dead on arrival** — stale crown).
- If `hostEpoch > gate.epoch` → adopt it and reset `gate.seq = -1` (a handoff bumped epoch).
- If `seq ≤ gate.seq` → reject (replay/reorder). Otherwise set `gate.seq = seq` and accept.

`hostEpoch` is distinct from the crypto `epoch` in [§6.2](#62-per-pair-aead-key): the crypto
`epoch` scopes pair keys (rotate-link), while `hostEpoch` scopes control authority (host
handoff/migration).

### 10.8 Frames now implemented (emote + host-control stage)

The following application frame types are implemented and carried on the wire. A conforming
client SHOULD handle them; all are core-range and are validated (not ignored).

| Name | Type | Dir | Layout |
|---|---|---|---|
| EMOTE | `0x06` | G→H | `emoteId u8 (0–5) || seq u8` |
| BYE | `0x09` | H→G | `reason u8 (0 kicked…6 not-approved) || detail u8` |
| ROUND | `0x0a` | H→all | `seed u32 || runId u8 || countdown u8 || flags u8` (rides the control envelope: room id, host epoch, seq) |
| EMOTEB | `0x16` | H→all | `P u8 || emoteId u8 || seq u8` |

Receipt rules a conforming host/guest MUST honor: `emoteId` is clamped to `0–5` **at receipt**
(out-of-range is dropped, not just unrendered); EMOTE is per-key rate-limited; the broadcast
`P` is taken from the sender's authenticated roster row, never from the payload; ROUND is
rejected unless it passes the control-envelope gate (matching room id + current host epoch,
non-replayed seq); a guest that emits any host→all opcode (`EMOTEB`/`ROUND`/roster/snap/`BYE`)
earns a strike. `BYE(reason=0)` is sent to a kicked peer, whose key is then banned for the
room's life. "New link" is a local host action (epoch + secret bump) with no wire frame — it
simply staleifies prior invites.

### 10.9 Frames specified but not in this snapshot

Still reserved by value, defined by the design, not yet implemented. Tolerate their absence;
byte layouts are intended shapes and may change before they ship.

| Name | Type | Dir | Intended layout |
|---|---|---|---|
| MOMENT | `0x07` | H→all | `kind u8 (0–4) || P u8 || value u32 || reserved u8×3` |
| LEAVE | `0x08` | G→H | `reason u8` |
| MIGRATE | `0x0b` | new-host→all | `newHostP u8 || epoch u8 || oldHostPub 32 || proof 16 || reserved u8` |

In this snapshot, the host still expresses "full room", "version mismatch", and "not approved"
by **silently dropping** the HELLO rather than sending a `BYE` with those reason codes. A
joining client MUST therefore treat "no WELCOME after retries" as a soft failure, not wait for
an explicit rejection. (`BYE` itself is implemented for the kick path, reason `0`.)

---

## 11. Frame-type space partitioning

The application frame-type byte (offset 0 of the plaintext) is partitioned:

| Range | Class | Semantics |
|---|---|---|
| `0x00`–`0x3F` | **core** | Specified frames. Validated. Unknown core types are ignored silently (no strike). |
| `0x40`–`0x7F` | **reserved** | Future standard extensions (records/social; M2 mobility move/handoff/migrate). **Ignored silently, never striked**, capability-gated. |
| `0x80`–`0xFF` | **experimental** | Private/experimental. **Ignored silently, never striked.** |

The reference gate is literally `if (type > 0x3F) return;` — reserved and experimental
frames never reach validation and never earn a strike. Only the core range is validated.
This is what lets newer clients introduce frames that older clients safely ignore.

---

## 12. Roles, capabilities, callsigns, roster & directory

### 12.1 Roles & spectators

`role ∈ {player: 0, spectator: 1}`. Separate caps: **32 players** (`PLAYER_CAP`) + **16
spectators** (`SPECTATOR_CAP`). Spectators pass the identical invite/handshake gate, appear
in the roster, are kickable, and may (in later stages) emote — but they send **only
keepalives**. A PRES frame from a spectator is a protocol violation → **strike**
(`spectator-pres`). The host itself may sit out (role spectator) while hosting; a sitting-out
host streams no ghost.

Role changes are rate-limited to ≤ 1 / 10 s per key and acked via the next ROSTER. A guest
must not assume the player role locally before the roster ack (doing so risks
`spectator-pres` strikes on an honest client).

### 12.2 Capability bitfield

HELLO and WELCOME both carry a u32 capability bitfield. Peers AND-mask before using a
feature — features negotiate, they are never assumed.

| Bit | Value | Capability |
|---|---|---|
| 0 | `0x01` | CALLSIGN |
| 1 | `0x02` | SPECTATE |
| 2 | `0x04` | ROLECHANGE |
| 3 | `0x08` | ANTICHEAT |
| 4 | `0x10` | HOSTEPOCH |

Full mask advertised by this snapshot: `0x1F`.

### 12.3 Callsigns

The wire carries **two u8 indexes** (`adjIdx`, `nounIdx`) into two shipped, versioned
wordlists — never free text (free text is *unrepresentable*). `0xff` (`CALLSIGN_NONE`) means
"no callsign, use P-number". Resolution rules a client MUST apply:

- Either index `0xff`, or a missing wordlist → no callsign → display P-number.
- Either index out of range for the local wordlist → P-number (a client with an older list
  shows P-number for an index it doesn't know — never a wrong word).
- A denied `(adjIdx, nounIdx)` pair (local deny list) → P-number.
- Otherwise display `adj[adjIdx] + " " + noun[nounIdx]`, with the P-number still shown for
  disambiguation (callsigns may collide; P-numbers are unique).

### 12.4 Callsign / P-number index semantics

P-numbers are 1-based join-order slots, `P1`..`P32`, assigned by the host and never reused
while a member is present. **P1 is always the current host.** The host picks the lowest free
slot for a new joiner. P-numbers survive reconnect within the 15-minute rejoin window and
survive host migration (the new host re-issues the roster with preserved P-numbers).

### 12.5 Relay-directory sourcing & fallback ladder

A client resolves a region code (from the invite) to relay hostnames using an active
directory. The reference parses the **official public directory JSON format natively**
(regions → nodes with region id/code/name, host name, port), so any compatible directory
endpoint or self-hosted fleet works without a schema change.

**Three sourcing modes** (`setRelayDirectory(mode, opts)`):

1. `default` — the public directory endpoint, fetched by the **host** at room creation,
   cached with a 24-hour TTL. Guests never fetch a map; they get their relay from the
   invite.
2. `custom` — any endpoint serving the same format (self-hosted fleet).
3. `list` — a plain list of relay hostnames synthesized into a single-region map
   (zero-infrastructure LAN/office mode).

**Fallback ladder (never a hard failure):**

```
live fetch  →  local cache  →  baked verbatim copy in the app  →  built-in seed regions
```

Nothing fetches lazily; a directory refresh happens only on an intentional host action.
When the directory module is absent, a small built-in seed (a handful of regions) keeps the
client self-contained.

**Relay selection (host, at room creation only — never mid-session):** guess locality from
the time zone → pick the 5 nearest regions by great-circle distance → probe each
(`fetch('https://'+host+'/derp/probe', {mode:'no-cors', cache:'no-store'})`, 2 attempts, first
discarded as warmup, 3 s timeout, timing only) → bake the winner's region code into the
invite. A custom relay in settings skips probing and sets `flags` bit1 + the host string.

---

## 13. Protocol version & compatibility

- **The protocol version is the app-envelope version byte = `1`** ([§7.1](#71-app-envelope-s--0x53)).
  It is the single number that gates compatibility. A frame whose envelope `ver ≠ 1` is
  dropped + struck.
- **HELLO version negotiation.** HELLO carries `protoMin`/`protoMax`. The host requires
  overlap with its own supported range (`[1,1]` today). No overlap → the join is refused
  (silent drop in this snapshot; a `BYE(reason=3)` "update to play together" in a later
  stage). `protoMin > protoMax` is itself a strike.
- **Forward-compatibility contract (both directions MUST honor):**
  - Decoders ignore trailing bytes beyond the fields they know.
  - Decoders default fields absent from a shorter (older) frame.
  - Unknown *core-range* frame types are ignored silently.
  - Reserved (`0x40`–`0x7F`) and experimental (`0x80`–`0xFF`) frame types are ignored
    silently and never striked.
  - Capabilities negotiate via the HELLO/WELCOME bitfield; a client never assumes a peer
    supports a feature it did not advertise.
- **Versioned side tables** (wordlists, emote sets, relay maps) evolve independently; an
  unknown index falls back safely (P-number, default cosmetic, nearest region).
- This means a v1 client and a future v1-compatible client that adds reserved-range frames
  and new capabilities can share a room: the older client ignores what it doesn't understand
  and is never penalized for doing so.

---

## 14. Conflicts between code and prior spec

The design notes predate several code changes. **Where they disagree, the code (this
snapshot) is authoritative.** Discrepancies found:

1. **PRES length.** Prior spec labels PRES "17B" (and repeats "presence is 17B" in its
   decisions log). The actual frame is **21 bytes** (1 type + 20 body). The spec's *own*
   field table sums to 20 body bytes, so the "17B" label was already internally
   inconsistent. **Authoritative: 21 bytes.**
2. **SNAP entry / header size.** Prior spec says each SNAP entry is "16B" built from a
   "PRES-body minus seq (15B)", and max size "3 + 11×16 = 179B". A PRES body minus `seq` is
   **18 bytes**, so an entry is **19 bytes** (1 `P` + 18), the header is **4 bytes**
   (type + tick + count), and the max is **4 + 11×19 = 213 bytes**. **Authoritative: entry
   19 B, header 4 B, max 213 B.**
3. **HELLO length.** Prior spec header says HELLO is "62B"; its own field table sums to a
   36-byte core. The code ships a **43-byte** HELLO (36-byte core + `role` + `caps(4)` +
   `adjIdx` + `nounIdx`, per addenda A/C/D). **Authoritative: 43 bytes** (36 accepted for
   legacy decode).
4. **WELCOME length & tail.** Prior spec says "22B … reserved 8B". The code ships **23
   bytes** total and repurposes the reserved tail as `hostEpoch(1)` + `caps(4)` +
   `reserved(3)` (addenda D/F.1). **Authoritative: 23 bytes** with the epoch/caps tail.
5. **ROSTER entry size.** Prior spec says the entry is "38B" (`P|pub|tag|suit|hat`). The
   code entry is **41 bytes**, appending `role` + `adjIdx` + `nounIdx` (addenda A/C).
   **Authoritative: 41 bytes.**
6. **ROLE frame (0x0c).** Not present in the original frame catalog or Appendix A; added by
   addendum A and implemented in code as a 4-byte `type|seq(u16)|newRole` frame.
   **Authoritative: implemented as documented in [§10.6](#106-role-0x0c).**
7. **hostEpoch vs crypto epoch.** The design uses "epoch" for the rotate-link key epoch. The
   code adds a *second*, independent `hostEpoch` for control-frame authority ([§10.7](#107-control-frame-envelope-hostepochseq-gate)).
   Both exist; they are not the same field. Documented separately here.
8. **Control frames "signed by host key".** Addendum F.1 describes control frames as "signed
   by the current host key". The code has **no separate signature**; authenticity comes from
   the per-pair AES-GCM AEAD (only the host holds a given guest's pair key). The `roomId /
   hostEpoch / seq` envelope adds anti-replay only. Functionally equivalent for a two-party
   pair, but a client author should not look for an Ed25519-style signature field — there
   isn't one.
9. **EMOTE / BYE / ROUND / EMOTEB now implemented; MOMENT / LEAVE / MIGRATE still reserved.**
   The emote and host-control frames landed ([§10.8](#108-frames-now-implemented-emote--host-control-stage));
   the remainder are still design-only ([§10.9](#109-frames-specified-but-not-in-this-snapshot)).
   The host still drops *rejected HELLOs* silently rather than sending BYE with a reason code;
   `BYE` is used for the kick path (reason `0`).
10. **Region code data.** The design example map uses `chi` for Chicago; the code's built-in
    seed uses `ord`. Region codes are directory data, not protocol; a client MUST take
    region codes from the active directory / invite, not hardcode them.
11. **Probe method.** The design once said "HTTPS HEAD"; the code issues a `no-cors` GET to
    `/derp/probe` (timing only). Non-normative (probing is host-side selection), noted for
    completeness.

---

## 15. Strikes, bans & rate limits a client MUST enforce

A host enforces these against guests; a guest enforces the same discipline against the host
and rejects host frames that violate the AEAD/replay/gate rules.

### 15.1 Strikes → ban

**3 strikes bans a key for the room lifetime** (`STRIKE_LIMIT = 3`): all further frames from
that key are silently dropped and its roster entry is removed. Ban survives reconnect of the
same key. **Strike-able (S) events:**

- AEAD `size` (wire > 256 B, pre-decrypt), `ver` (bad envelope), `dir`, `replay`, `aead`.
- HELLO too short (`short`), HELLO/re-hello proof mismatch (`proof`).
- PRES with NaN/Inf position (`nan`).
- Anti-cheat hard teleport (`teleport`, [§15.3](#153-anti-cheat-envelope)).
- PRES from a spectator (`spectator-pres`).
- ROSTER `count` overrun.

Clamps (**C**) and whitelist fallbacks (**W**) are **never** strikes.

Pre-join (before a HELLO is accepted) a host tracks provisional strikes per key in a bounded
table (evict-oldest under key-spray); 3 pre-join strikes ban the key too.

### 15.2 Rate limits

| Limiter | Limit | On exceed |
|---|---|---|
| HELLO per key | 1 / 5 s, and ≤ 5 / session | drop |
| Joins per room | 10 / min | drop (queue then drop) |
| PRES per key | token bucket refill **14/s**, burst **20** | drop frame (no strike) |
| Role change per key | ≤ 1 / 10 s | ignore |
| CODEREQ replies (host) | ≤ 6 / min **and** ≤ 64 / room life | silence |
| Roster | 32 players + 16 spectators | reject join |

The guest's HELLO retry loop deliberately spaces retries at ~5.5 s (outside the host's
1-per-5-s HELLO limiter) and stops after 5 tries or on WELCOME.

### 15.3 Anti-cheat envelope (advisory)

A client MAY apply the physics envelope (capability `ANTICHEAT`). It derives inequalities
from fixed sim constants:

- Horizontal cap `VMAX = 9.5 px/step × 60 = 570 px/s`; vertical cap `VYMAX = 14 × 60 = 840
  px/s`; `10 px = 1 m`; generous score ceiling `60 pts/m`.
- A position delta beyond `VMAX·dt · 4 + 1500 px` (or the vertical equivalent) is a
  **hard teleport → strike**.
- A softer `dist`-vs-time or `score`-vs-`dist` inconsistency does **not** strike — the row
  renders **dimmed "unverified"** (visible but discounted). A laggy honest client must be
  allowed to live; the dim flag resets each new run.

---

## 16. Security invariants (conformance requirements)

A conforming client MUST uphold these (condensed from the reference security review, NET-SPEC
§5 plus addenda F.1 and G.1). "Remote input" means any byte that crossed the wire.

### 16.1 Isolation

- **No socket, no key material, no crypto call before the user opts in** (taps "Run
  Together" or "Join"). Reading the URL fragment is free; everything else is lazy.
- **Remote input cannot reach the simulation.** Net-derived values may write only ghost
  render state, the roster/board, toasts, and the room card. They MUST NOT write the local
  player, enemies, world, RNG, or input.
- **Guests hear the host only.** Drop any application `RecvPacket` whose source key is not
  the current host (or, transiently, the short-code listener). No guest-to-guest traffic
  exists.
- **No peer IP disclosure.** All traffic is relay-only: no WebRTC, no STUN, no direct fetch
  of a peer-supplied URL. Peers cannot learn each other's IPs.

### 16.2 Validation (every field that crosses the wire)

| Field | Rule | Action on violation |
|---|---|---|
| envelope `ver` | = 1 | strike |
| envelope `dir` | matches sender role (0x01 G→H / 0x02 H→G) | strike |
| envelope `counter` | `> highSeen(pair, dir)` | drop + strike |
| wire size | ≤ 256 B | drop + strike (pre-decrypt) |
| HELLO `protoMin/Max` | overlap [1,1], `min ≤ max` | refuse join / strike |
| tag (HELLO/ROSTER) | `[A-Z0-9]{3}` | force `"AAA"` (**W**) |
| suit/hat | index in local cosmetic tables | force 0 (**W**) |
| HELLO `proof` | HMAC match | silent drop + strike |
| HELLO `rejoin8` | HMAC match when `wantP ≠ 0` | treat as fresh join |
| ROSTER `op` | 0–3 | drop frame |
| ROSTER `count` | ≤ 5 and fits body | strike |
| P (ROSTER/SNAP) | 1–32 | drop entry |
| PRES `x` | finite, `[-1e6, 4e6]` | clamp; NaN → strike |
| PRES `y` | finite, `[-4000, 4000]` | clamp; NaN → strike |
| PRES `vx` | i8 | clamp |
| PRES `state` | mask `& 0x1f` | mask |
| PRES `chain` | 0–4 | clamp |
| PRES `score` | ≤ 9 999 999, monotonic/runId | clamp to previous |
| PRES `dist` | ≤ 60 000, monotonic/runId | clamp to previous |
| PRES `runId` | known runId | else 0 (render-only ghost) |
| ROLE `newRole` | 0/1 | any other → player |
| control frame | `roomId` match, `hostEpoch ≥ gate`, `seq > gate.seq` | reject stale/replay |
| CODERESP `len` | ≤ 200, box authenticated by `codePub` | abort code join |
| invite `relayHost` | `[A-Za-z0-9.\-]` host, optional `:port`, 4–64 chars | refuse invite |

### 16.3 Room-hygiene & anti-abuse

- **Tags/callsigns are canvas-rendered only**, never inserted into DOM `innerHTML`. A
  hostile tag like `"<b>"` MUST render as `"AAA"`, not execute.
- **Room secret never leaves the invite/code channel**, is never logged, never appears in
  PRES/SNAP.
- **Expired invite** (`expiry < now`) is refused client-side; the host also checks its own
  issued expiry.
- **Rotate-link** issues a new secret + epoch; joins under the old secret fail the proof
  (epoch mismatch) → drop. Existing vetted pairs keep their established keys.
- **Kicked key cannot rejoin** (ban list by public key). Host migration proof (when MIGRATE
  ships) is accepted only with a valid HMAC **and** a locally-consistent successor
  (lowest-alive join order the receiver itself observes).
- **HIDE / BLOCK.** A client MAY maintain a local drop set: HIDE is session-only, BLOCK is
  persisted (`{pubkey, callsign, room, ts}`, capped at 512). Both drop a key's frames on
  receipt with a single membership check at frame entry, before any other processing.
- **sessionStorage identity expires ≤ 15 min** and never touches localStorage.
- **Mobility (M2, guest-enforced when it ships):** reject > 1 relay move / 5 min per epoch
  and > 1 handoff / 2 min regardless of host claims; 2 failed/rejected moves in 10 min →
  "unstable room"; auto-follow only relays already in the consented directory; jittered
  0–2 s reconnect on a move.

---

## 17. Worked example: an annotated HELLO

A guest with tag `KAG`, suit 3, hat 1, callsign indices `(5, 17)`, capabilities `0x1F`,
joining fresh (no rejoin token), producing a HELLO **plaintext** (43 bytes):

```
offset  bytes                                            field
------  -----------------------------------------------  ----------------------------------
0x00    01                                               type = HELLO (0x01)
0x01    01                                               protoMin = 1
0x02    01                                               protoMax = 1
0x03    4B 41 47                                          tag = "KAG"  (ASCII K,A,G)
0x06    03                                               suit = 3
0x07    01                                               hat = 1
0x08    00 00 00 00 00 00 00 00                          rejoin8 = 0  (fresh join)
0x10    00                                               wantP = 0
0x11    00 00 00                                         reserved
0x14    9F 12 4C A8 03 E1 55 7B 
        BD 2A 66 90 DF 04 C8 31                          proof16 = HMAC-SHA256(secret,
                                                           "join1"||roomId||epoch||gPub||hPub)[0:16]
0x24    00                                               role = 0 (player)
0x25    1F 00 00 00                                       caps = 0x0000001F  (u32 LE)
0x29    05                                               adjIdx = 5
0x2A    11                                               nounIdx = 17  (0x11)
```

Full 43-byte plaintext, contiguous:

```
01 01 01 4B 41 47 03 01 00 00 00 00 00 00 00 00
00 00 00 00 9F 12 4C A8 03 E1 55 7B BD 2A 66 90
DF 04 C8 31 00 1F 00 00 00 05 11
```

**Sealing it** (guest → host, first frame so `counter = 0`, `dir = 0x01`) yields the `'S'`
envelope. The 11-byte cleartext header is:

```
53 01 01 00 00 00 00 00 00 00 00
│  │  │  └──────────────────────┘ counter = 0  (u64 LE)
│  │  └ dir = 0x01 (guest→host)
│  └ envelope version = 1
└ 'S' (0x53)
```

followed by the AES-GCM ciphertext of the 43-byte plaintext plus a 16-byte tag (opaque,
non-deterministic — depends on the pair key and the random-free counter nonce
`01 00 00 00 00 00 00 00 00 00 00 00`, AAD `01 <roomId·8> <epoch> 01`). Total sealed wire:
11 + 43 + 16 = **70 bytes**. This whole envelope becomes the `SendPacket` payload prefixed
by the 32-byte host public key, itself wrapped in the 5-byte relay frame header:

```
04 00 00 00 66  <hostPub·32>  53 01 01 00 00 00 00 00 00 00 00  <ct+tag·59>
│  └─────────┘  └──────────┘  └───── 'S' envelope (70 B) ───────────────────┘
│  len=0x66=102 relay dst key
└ relay frameType = SendPacket (0x04)
```

(`102 = 32 + 70`.) The relay header length is **big-endian**; every field inside the `'S'`
envelope is little-endian.

---

## 18. Constant reference

| Constant | Value | Meaning |
|---|---|---|
| `PROTO` | 1 | app-envelope / protocol version |
| `ROOM_CAP` / `PLAYER_CAP` | 32 | player slots |
| `SPECTATOR_CAP` | 16 | spectator slots |
| `WIRE_MAX` | 256 | max app packet wire size (pre-decrypt gate) |
| plaintext cap | 229 | max app frame plaintext (256 − 27 overhead) |
| `RELAY_FRAME_MAX` | 65536 | max declared relay frame length |
| `RX_RING` | 131072 | reassembly buffer size |
| envelope overhead | 27 | 11 header + 16 AES-GCM tag |
| `T_CONNECT` | 8000 ms | connect timeout |
| `T_HANDSHAKE` | 5000 ms | handshake timeout |
| `T_DEAD` | 90000 ms | silence → dead socket |
| `T_PING_IDLE` | 25000 ms | send-idle → ping |
| `BACKOFF_BASE / CAP / RESET` | 500 / 10000 / 30000 ms | reconnect backoff |
| `RECONNECT_JITTER` | 2000 ms | reconnect spread |
| `STRIKE_LIMIT` | 3 | strikes → ban |
| PRES bucket | 14/s, burst 20 | per-key presence rate |
| Role min interval | 10000 ms | ≤ 1 role change / 10 s |
| Move / handoff min | 300000 / 120000 ms | M2 mobility (reserved) |
| Relay magic | `44 45 52 50 F0 9F 94 91` | fixed 8-byte hello constant |
| App envelope marker | `0x53` (`'S'`) | AES-GCM app frame |
| Code envelope marker | `0x43` (`'C'`) | NaCl-box code channel |
| `DIR_G2H` / `DIR_H2G` | `0x01` / `0x02` | envelope direction |
| Frame core / reserved / experimental | `≤0x3F` / `0x40–0x7F` / `0x80–0xFF` | type-space partition |
| `CALLSIGN_NONE` | `0xff` | "no callsign, use P-number" |
| `CAPS` | `0x1F` | full capability mask |

**Frame type values.** Relay: `01` ServerKey, `02` ClientInfo, `03` ServerInfo, `04`
SendPacket, `05` RecvPacket, `06` KeepAlive, `07` NotePreferred, `08` PeerGone, `12` Ping,
`13` Pong, `14` Health, `15` Restarting. App (implemented): `01` HELLO, `02` WELCOME, `03`
ROSTER, `04` PRES, `05` SNAP, `0c` ROLE. App (specified, not in this snapshot): `06` EMOTE,
`07` MOMENT, `08` LEAVE, `09` BYE, `0a` ROUND, `0b` MIGRATE, `16` EMOTEB. Code channel: `01`
CODEREQ, `02` CODERESP.

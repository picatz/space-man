/* Race browser coordinator. Transport authenticates peers; race-online owns
 * gameplay. A host pause is shared. No migration or persisted match restoration. */
(function (root) {
  "use strict";
  function create(options) {
    const opts = options || {},
      net = opts.net,
      online = root.SpaceManRaceOnline,
      sim = root.SpaceManRace;
    let host = null,
      client = online.createClient(),
      active = false,
      busy = false,
      serial = 0,
      timer = null,
      off = null;
    let lastPublish = -Infinity,
      lastInput = -Infinity,
      lastReceived = 0,
      steps = 0,
      pending = null,
      error = "",
      closedReason = "",
      connection = "";
    const now = () => root.performance.now(),
      info = () => net.info();
    function roster() {
      return net
        .roster()
        .map((r) =>
          Object.assign({}, r, {
            identity: r.p === 1 ? "host" : r.pubHex || "peer-" + r.p,
          }),
        );
    }
    function status() {
      return {
        active,
        busy,
        error,
        closedReason,
        connection,
        host: !!host,
        info: info(),
        roster: roster(),
        current: client.current,
        stale: active && !host && now() - lastReceived > 1500,
      };
    }
    function changed() {
      if (opts.onChange) opts.onChange(status());
    }
    function present(snapshot) {
      const s = sim.snapshot(snapshot.state),
        local = info(),
        myP = local.myP;
      for (const a of s.actors) {
        const seat = snapshot.seats.find((p) => p.actorId === a.id);
        const own = seat && seat.p === myP && local.role === 0 && seat.connected && !seat.forfeited;
        a.controller = seat ? (own ? "human" : "remote") : "cpu";
        if (seat) {
          a.name = net.callsignText(seat.adjIdx,seat.nounIdx) || "PLAYER " + (seat.displayP || seat.p);
          a.appearance = seat.connected && !seat.forfeited ? net.roster().find(r => r.p === seat.p && r.role === 0)?.appearance : undefined;
          a.peerP = seat.p;
          a.connected = seat.connected;
          a.forfeited = !!seat.forfeited;
        }
      }
      if (s.results)
        for (const r of s.results) {
          const actor = s.actors.find((a) => a.id === r.id);
          if (actor) r.name = actor.name;
        }
      if (opts.onSnapshot)
        opts.onSnapshot(
          Object.assign({}, snapshot, {
            state: s,
            receivedAt: now(),
            isHost: !!host,
          }),
        );
    }
    function publish(force) {
      if (
        !active ||
        !host ||
        (!force && now() - lastPublish < online.SNAPSHOT_MS)
      )
        return;
      lastPublish = now();
      const bytes = host.packet(),
        snapshot = client.accept(bytes, 1);
      if (snapshot) {
        lastReceived = now();
        if (
          force ||
          host.status !== "running" ||
          host.state.phase === "finished"
        )
          present(snapshot);
      }
      net.sendRace(bytes).catch(() => {});
      changed();
    }
    function sync() {
      if (host) {
        host.syncRoster(roster(), now());
        publish(true);
      }
      changed();
    }
    function cleanup(leave = true) {
      serial++;
      active = false;
      busy = false;
      pending = null;
      connection = "";
      host = null;
      client = online.createClient();
      if (timer) {
        root.clearInterval(timer);
        timer = null;
      }
      if (off) {
        off();
        off = null;
      }
      if (leave) net.leave();
    }
    function subscribe() {
      off = net.onEvent((event, data) => {
        if (!active && !busy) return;
        if (event === "race-data") {
          if (host)
            host.receive(
              data.p,
              data.p === 1 ? "host" : data.pubHex,
              data.bytes,
              now(),
            );
          else {
            const snapshot = client.accept(data.bytes, data.p);
            if (snapshot) {
              lastReceived = now();
              connection = "";
              present(snapshot);
              changed();
            }
          }
        } else if (
          [
            "join",
            "rejoin",
            "roster",
            "role",
            "leave",
            "kick",
            "banned",
            "welcomed",
            "ok",
          ].includes(event)
        )
          sync();
        else if (event === "reconnecting" || event === "hostaway") {
          connection = host
            ? "Connection lost · match paused"
            : "Reconnecting · controls released";
          pending = null; client.cancel(true);
          if (host) host.pause(true);
          publish(true);
          changed();
        } else if (event === "reconnected" || event === "hostback") {
          connection = "";
          sync();
        } else if (event === "bye") {
          const message =
            data && data.reason === 3 && data.detail === 32
              ? "This room uses a newer racing version. Leave the room, refresh all games, then ask the host for a new invite."
              : data && data.reason === 4
              ? "This race room is full."
              : data && data.reason === 3 && data.detail === 16
                ? "This invite is for a different game mode."
                : data && data.away
                  ? "The host stayed away, so this room ended."
                  : data && data.reason === 1
                    ? "The host closed the room."
                    : "The host ended your race connection.";
          if (busy) error = message;
          else closedReason = message;
          cleanup();
          changed();
        }
      });
      timer = root.setInterval(() => {
        publish(false);
        if (active && !host && now() - lastReceived > 1500) changed();
      }, 50);
    }
    async function hosting(config) {
      if (active || busy || net.active) return false;
      const mine = ++serial;
      busy = true;
      error = "";
      closedReason = "";
      connection = "";
      client = online.createClient();
      subscribe();
      changed();
      try {
        await net.openRoom(
          Object.assign(
            {},
            typeof opts.hostOptions === "function" ? opts.hostOptions() : {},
            typeof opts.identity === "function" ? opts.identity() : {},
            {
              mode: "race",
              code: !(opts.build && opts.build.preview),
              baseUrl:
                typeof opts.baseUrl === "function"
                  ? opts.baseUrl()
                  : opts.baseUrl,
            },
          ),
        );
        if (mine !== serial) return false;
        host = online.createHost(config);
        active = true;
        busy = false;
        host.syncRoster(roster(), now());
        publish(true);
        changed();
        return true;
      } catch (e) {
        if (mine === serial) {
          error = (e && e.message) || "Could not reach the room relay.";
          cleanup();
          changed();
        }
        return false;
      }
    }
    async function join(target, role, trustedPayload = false) {
      if (active || busy || net.active) return false;
      const mine = ++serial;
      busy = true;
      error = "";
      closedReason = "";
      connection = "";
      client = online.createClient();
      subscribe();
      changed();
      try {
        let payload;
        if (trustedPayload) payload = target;
        else {
          const resolved = opts.build
            ? opts.build.resolveJoin(target)
            : { value: target };
          if (resolved.error) throw new Error(resolved.error);
          const parsed = net.parseJoin(resolved.value);
          if (parsed.kind === "invite") payload = parsed.payload;
          else if (parsed.kind === "code")
            payload = (await net.lookupCode(resolved.value)).invite;
          else
            throw new Error(
              "Paste your friend’s race invite link or room code.",
            );
        }
        if (mine !== serial) return false;
        const peek = net.peekInvite(payload);
        if (peek.err)
          throw new Error(
            peek.err === "expired"
              ? "This race invite has expired."
              : "This invite is not compatible. Refresh both games.",
          );
        if (peek.mode !== "race")
          throw new Error(
            "That invite is for " +
              (peek.mode === "arena" ? "Arena" : "Run Together") +
              ". Join it from its own game mode.",
          );
        if (net.blocklist().some((b) => b.pubkey === peek.hostHex))
          throw new Error(
            "This host is blocked. Manage blocked hosts in the runner settings first.",
          );
        await net.acceptJoin(
          payload,
          Object.assign(
            {},
            typeof opts.identity === "function" ? opts.identity() : {},
            { mode: "race", role: role === 1 ? 1 : 0 },
          ),
        );
        if (mine !== serial) return false;
        active = true;
        busy = false;
        lastReceived = now();
        if (client.current) present(client.current);
        changed();
        return true;
      } catch (e) {
        if (mine === serial) {
          error = (e && e.message) || "Could not join this race.";
          cleanup();
          changed();
        }
        return false;
      }
    }
    function submit(command, time = now(), released = false) {
      if (!active || connection || (!host && now() - lastReceived > 1500))
        return;
      const packet = released ? client.release(info().myP) : client.input(command, info().myP);
      if (!packet) return;
      if (host) host.receive(1, "host", packet, time);
      else {
        pending = packet;
        if (released || time - lastInput >= 30) {
          lastInput = time;
          net.sendRace(pending).catch(() => {});
          pending = null;
        }
      }
    }
    function step(command, time = now()) {
      if (!active) return;
      submit(command, time);
      if (host && !connection) {
        host.step(time);
        steps++;
        present({
          state: host.state,
          seats: host.seats,
          status: host.status,
          epoch: host.epoch,
          revision: host.revision,
        });
        if (steps % 3 === 0) publish(false);
      }
    }
    function release() {
      client.cancel();
      if (active) {
        submit(sim.command(), now(), true);
        if (pending) {
          net.sendRace(pending).catch(() => {});
          pending = null;
        }
      }
    }
    function configure(config) {
      if (!host) return false;
      const ok = host.configure(config);
      publish(true);
      return ok;
    }
    function start(seed) {
      if (!host || connection) return false;
      host.syncRoster(roster(), now());
      const ok = host.start(seed);
      if (ok) {
        net.setRaceRoleLock(true);
        publish(true);
      }
      return ok;
    }
    function pause(on) {
      release();
      if (host && !on && connection) return false;
      if (host) {
        host.pause(on);
        publish(true);
      }
      return !!host;
    }
    function lobby() {
      if (!host) return false;
      host.lobby();
      net.setRaceRoleLock(false);
      host.syncRoster(roster(), now());
      publish(true);
      return true;
    }
    async function role(value) {
      if (!active) return false;
      const ok = await net.setRole(value);
      sync();
      return ok;
    }
    function close() {
      cleanup();
      closedReason = "";
      error = "";
      connection = "";
      changed();
    }
    return Object.freeze({
      hosting,
      join,
      configure,
      start,
      pause,
      lobby,
      role,
      step,
      release,
      observeWarnings: serials => client.observeWarnings(serials),
      close,
      status,
      get active() {
        return active;
      },
      get busy() {
        return busy;
      },
      get isHost() {
        return !!host;
      },
      get current() {
        return client.current;
      },
    });
  }
  root.SpaceManRaceRoom = Object.freeze({ create });
})(typeof window !== "undefined" ? window : globalThis);

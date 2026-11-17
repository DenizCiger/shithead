# Shithead

Online multiplayer Shithead (2-6 players) with custom rules.

    npm install
    npm start   # http://localhost:3000 (PORT env var supported)
    npm test    # rule tests + random-playout fuzz

Share the 4-letter room code or invite link. Rooms live in server memory; players reconnect via a token in localStorage.
Rules are in src/engine.ts (pure); src/server.ts is the authoritative WebSocket server; src/events.ts turns each
accepted action into presentation events (what to animate) that ride along with the state snapshot.

Client (public/): `game.js` is the Slam-style table (card sprites, impact frames, hit-stop), `net.js` the connection plus
home/lobby screens, `rules.js` the rule catalogue (rule wall + how-to-play modal), `sfx.js` the synthesized sound packs (Arcade, Lethal). Settings (effects intensity, game speed, sound pack, volume)
live in the gear menu and are stored in localStorage.

Joker rule: the caster picks who takes the pile. If the target holds a Joker in their hand they may parry: the stack flies back
at the caster (the parry Joker is burned), who may parry again if they hold one, and so on. Otherwise the target takes the pile.
Decks: one 54-card deck per two players, rounded up (the host can override 1-4).

## Rooms

The host runs the lobby: bots (`addbot`/`rmbot`), table <-> bench moves, crown hand-over, kicks, and room settings (`settings`
patch, lobby only). Anyone can `leave`; a leaving host picks an heir or closes the room, and a player leaving a running game
is replaced by a bot. Spectators (the bench) see the table but no hands.

Room settings: max players (2-6), decks, rules and assists.

- Rules (`E.Rules`): jokers, parry, 3 transparent, 4 reverse, 8 skip, 10 burn, four-of-a-kind burn, 67 combo, random joker target.
  Presets: **Classic** (jokers, 10 and x4 burn) and **AHIF** (everything but random joker). 2, 7, J and picking up are always on.
- Difficulty: *Assisted* dims unplayable cards, *Normal* does not (illegal throws are blocked), *Expert* takes the pile for an illegal throw.
- Assists (enforced for the whole room, server side): auto-take when nothing is playable, auto-play a lone legal play, auto-stack a rank.

## Deploy (Docker + Caddy)

    docker compose up -d --build

Caddyfile (WebSockets are proxied automatically):

    shithead.example.com {
        reverse_proxy 127.0.0.1:3000
    }

If Caddy itself runs in Docker, replace `127.0.0.1:3000` with the container name (e.g. `shithead:3000`) and put both on the same Docker network.

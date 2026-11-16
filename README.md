# Shithead

Online multiplayer Shithead (2-6 players) with custom rules.

    npm install
    npm start   # http://localhost:3000 (PORT env var supported)
    npm test    # rule tests + random-playout fuzz

Share the 4-letter room code or invite link. Rooms live in server memory; players reconnect via a token in localStorage.
Rules are in src/engine.ts (pure); src/server.ts is the authoritative WebSocket server; src/events.ts turns each
accepted action into presentation events (what to animate) that ride along with the state snapshot.

Client (public/): `game.js` is the Slam-style table (card sprites, impact frames, hit-stop), `net.js` the connection plus
home/lobby screens, `sfx.js` the synthesized sound packs (Arcade, Lethal). Settings (effects intensity, sound pack, volume,
card back) live in the gear menu and are stored in localStorage.

Joker rule: the caster picks who takes the pile. If the target holds a Joker in their hand they may parry: the stack flies back
at the caster (the parry Joker is burned), who may parry again if they hold one, and so on. Otherwise the target takes the pile.
Decks: one 54-card deck per two players, rounded up.

## Deploy (Docker + Caddy)

    docker compose up -d --build

Caddyfile (WebSockets are proxied automatically):

    shithead.example.com {
        reverse_proxy 127.0.0.1:3000
    }

If Caddy itself runs in Docker, replace `127.0.0.1:3000` with the container name (e.g. `shithead:3000`) and put both on the same Docker network.

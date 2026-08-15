# BGN Game Template

The shared framework that gives every game in the Boardgame Network the same premium theme.

## What's here

| File | Purpose |
|---|---|
| `style.css` | The BGN design system — the hosted stylesheet every game links to. **This is the source.** To update the theme for all games, edit this file and re-upload it. |
| `game-index.html` | The game-page shell (nav → hub, hero, content area, footer) + a demo dice-roller to delete. Copy this into a new generator's `index.html`. |
| `game-main.pjs` | The game-page config. Copy into a new generator's `main.pjs` and fill in your game's details. |
| `audio/bgn-audio.js` | The shared audio system (SFX + background music + mute toggle) — see `audio/README.md`. |
| `chat/` | The **BGN Lounge** — one shared chat across every BGN game (see below). |
| `README.md` | This file. |

## How to make a new BGN game (for members)

1. Create a new generator on Perchance.
2. Paste `game-main.pjs` into its **main.pjs** and `game-index.html` into its **index.html**.
3. In main.pjs, fill in the config:
   - `hubUrl` ← **the hub's URL** (back-to-the-hub link in the nav)
   - `gameTitle`, `gameTagline`, `gameKicker`, `gameGenre`, `gamePlayers`
   - `accentColor` (optional) re-tints the whole theme to your game's color
   - `heroImage` (optional) sets a background photo on the hero
4. In index.html, **delete the demo dice-roller** inside `<main>` and build your game there. Use the component classes (`.panel`, `.btn-gold`, `.field`, `.chip`, `.die-show`, `.grid-2`, `.stat-row`, …) so it matches.
5. When it's live, the hub owner adds it to the `games` list in the hub's main.pjs — `slug` = your generator's URL name.

## Making the game self-contained (optional)

The template links the hosted `style.css` so all games stay identical automatically.
If you'd rather a game carry its own theme (fully standalone, tweakable), paste the
contents of `style.css` into a `<style>` block in that game's index.html instead.

## BGN Lounge (shared chat)

Every BGN generator has its **own** socket server, so in-game/match chat is per-game (that's
intentional — only that match's players see it). For a chat shared by the WHOLE network there's
one extra generator, `bgn-chat` (a "Lounge") that all games embed.

How it works:
- `chat/main.pjs` + `chat/index.html` → the **bgn-chat generator** (a single public chat room;
  server rate-limits per connection + per network group, filters banned words, shows N-online).
  To set it up: create a generator named `bgn-chat` (exactly), paste those two files in, and save.
  Its chat is visible in every BGN game at once because they all embed it.
- `chat/lounge-snippet.html` → the "💬 Lounge" floating button + overlay + iframe embed to paste
  into the END of any BGN generator's index.html. It opens the lounge, and plays the chat blip
  (`window.BGN.sfx.play("draw")`) when a new message arrives via postMessage. The iframe src is
  `https://perchance.org/bgn-chat?embed=1` — change that one line if the generator is named differently.
- Match chat (Blank, Non-Std Deck online rooms) is separate code living in each game's index.html
  and stays per-match.

## Leaderboards (shared top-10)

Score-based games (Non-Std Deck, Strategy) ship with a persistent leaderboard. The top ~50 scores
live in the server-plugin's durable `state` bytes (a fixed binary region reserved at the very end of
`state`, so it survives restarts and never collides with room state). The server exposes two RPCs,
`submitScore` (rate-limited per connection + per network group) and `getScores` (top 10), and the
client auto-submits the result of every finished local/AI game (online: host only), keeps a
leaderboard name in `localStorage` (`bgn_lb_name`), and shows a 🏆 Leaderboard modal. Non-Std ranks
by higher points; Strategy ranks by fewer turns to victory. A lightweight background socket
(`lbConnect`) is opened lazily so the leaderboard works even in offline/solo modes.

## Updating the theme

This file (`style.css`) is the source of truth. When it changes:
1. Edit `src/template/style.css` in the hub.
2. Re-upload with `upload_file` to get a new hosted URL.
3. Update the `<link rel="stylesheet">` URL in `game-index.html` here, and let members know to refresh their link (or re-copy the template).

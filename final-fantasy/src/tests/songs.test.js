// Task #228: soundtrack data validation — every song parses, every row is a
// valid token, voices are balanced, loops are sane, and the region map covers
// every map in the game with a song that actually exists.

import { SONGS, SONGS_LABELS } from "../data/songs.js";
import { parseSong, noteToFreq, VOICE_ORDER } from "../engine/music-engine.js";
import { classifyMap, REGION_SONGS, songForMap, allMapIds } from "../data/music-regions.js";
import { MAPS } from "../data/maps.js";

const NOTE_LIKE = /^[A-Ga-g][#b]?[2-6](\*\d+)?$/;

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ids = Object.keys(SONGS);
  check("soundtrack has all 8 songs", ids.length === 8, ids.join(","));
  check("every id has a label", ids.every((id) => SONGS_LABELS[id] && typeof SONGS_LABELS[id] === "string"));
  check("labels are unique", new Set(Object.values(SONGS_LABELS)).size === ids.length);

  for (const id of ids) {
    const def = SONGS[id];
    let parsed = null;
    let err = null;
    try {
      parsed = parseSong(def);
    } catch (e) {
      err = String(e.message ?? e);
    }
    check(id + ": parses", parsed !== null, err);
    if (!parsed) continue;

    check(id + ": tempo in range", parsed.tempo >= 40 && parsed.tempo <= 220, parsed.tempo);
    check(id + ": rowsPerBar in range", parsed.rowsPerBar >= 4 && parsed.rowsPerBar <= 32, parsed.rowsPerBar);
    check(id + ": volume in (0,1.2]", parsed.volume > 0 && parsed.volume <= 1.2, parsed.volume);
    check(id + ": loopTo > loopFrom", parsed.loopTo > parsed.loopFrom, parsed.loopFrom + ".." + parsed.loopTo);
    check(id + ": loopTo <= totalRows", parsed.loopTo <= parsed.totalRows, parsed.loopTo + "/" + parsed.totalRows);
    check(id + ": whole bars only", parsed.totalRows % parsed.rowsPerBar === 0, parsed.totalRows + " % " + parsed.rowsPerBar);
    check(id + ": full-length loop", parsed.loopTo === parsed.totalRows, parsed.loopTo);

    // Every token in every voice is valid, and rests aren't the only content.
    let hasNote = false;
    let tokenIssues = [];
    for (const voice of VOICE_ORDER) {
      const rows = parsed.rows[voice];
      if (rows.length !== parsed.totalRows) {
        tokenIssues.push(voice + " len " + rows.length);
        continue;
      }
      for (let r = 0; r < rows.length; r++) {
        const tok = rows[r];
        if (tok === "r" || tok === "=") continue;
        if (NOTE_LIKE.test(tok)) {
          hasNote = true;
          if (noteToFreq(tok.split("*")[0]) === null) tokenIssues.push(voice + "@" + r + " bad note " + tok);
        } else if (!/^(K|S|H|C)(\*\d+)?$/.test(tok)) {
          tokenIssues.push(voice + "@" + r + " bad token " + tok);
        }
      }
    }
    check(id + ": all tokens valid", tokenIssues.length === 0, tokenIssues.join("; "));
    check(id + ": has actual notes", hasNote);
  }

  // Non-looping songs end (the controller depends on onEnd for jingles).
  check("victory is one-shot", SONGS.victory.loop === false);
  check("gameover is one-shot", SONGS.gameover.loop === false);
  check("menu/town/overworld/dungeon/battle/boss loop", ["menu", "town", "overworld", "dungeon", "battle", "boss"].every((id) => SONGS[id].loop !== false));

  // --- region mapping ---
  check("classifyMap overworld", classifyMap("overworld") === "overworld");
  for (const town of ["cornelia", "cornelia_inn", "cornelia_shop", "cornelia_castle", "pravog", "pravog_house", "elfheim_royal", "windfall", "windfall_shop", "dwarfholm_inn", "glacierport", "glacierport_house"]) {
    check("classifyMap town " + town, classifyMap(town) === "town", classifyMap(town));
  }
  for (const cave of ["caves_of_cornelia", "caves_of_cornelia_b2", "marsh_cave", "mount_gulg_b2", "chaos_shrine", "gnome_tunnels", "wind_shrine_b2", "sea_vault", "lighthouse_top", "ember_sanctum_core", "forge_core", "frozen_upper", "time_rift", "time_labyrinth", "chrono_throne", "trial_hall"]) {
    check("classifyMap dungeon " + cave, classifyMap(cave) === "dungeon", classifyMap(cave));
  }

  const mapIds = new Set(allMapIds());
  check("region data covers maps data", mapIds.size === MAPS.length, mapIds.size + "/" + MAPS.length);
  let uncovered = [];
  for (const id of mapIds) {
    const region = classifyMap(id);
    if (!REGION_SONGS[region]) uncovered.push(id + "->" + region);
  }
  check("every map maps to a region with a song", uncovered.length === 0, uncovered.join(", "));

  let badSong = [];
  for (const id of mapIds) {
    const song = songForMap(id);
    if (!SONGS[song]) badSong.push(id + "->" + song);
  }
  check("every region song exists", badSong.length === 0, badSong.join(", "));

  check("region songs point at real songs", Object.values(REGION_SONGS).every((s) => SONGS[s]));

  return out;
}

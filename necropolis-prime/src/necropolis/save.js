// Persistent progress for Necropolis Prime.
//
// A run's state (seed, collected sigils, finale state, last position) is a
// small JSON object stored in a kv-plugin folder (IndexedDB under the hood),
// so it survives reloads and browser restarts. The same shape is what the
// save-file export/import feature reads and writes, so a save is portable.

const FOLDER = "necropolisSave";
const KEY = "progress";

function folderFor(kv){
  return (kv && kv[FOLDER]) ? kv[FOLDER] : null;
}

// Coerce an untrusted object (from IndexedDB or an imported file) into a safe,
// well-shaped save — rejecting anything without a usable numeric seed.
export function sanitizeSave(raw){
  if (!raw || typeof raw !== "object") return null;
  const seed = Number(raw.seed);
  if (!Number.isFinite(seed)) return null;
  const takenRaw = Array.isArray(raw.sigilsTaken) ? raw.sigilsTaken : [];
  const sigilsTaken = [...new Set(
    takenRaw
      .map(n => Math.floor(Number(n)))
      .filter(n => Number.isInteger(n) && n >= 0 && n < 100000)
  )].sort((a, b) => a - b);
  let position = null;
  if (raw.position && Number.isFinite(Number(raw.position.x)) && Number.isFinite(Number(raw.position.z))){
    position = {
      x: Number(raw.position.x),
      z: Number(raw.position.z),
      yaw: Number(raw.position.yaw) || 0,
    };
  }
  return {
    version: 1,
    generator: typeof raw.generator === "string" ? raw.generator : "",
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
    seed: seed | 0,
    sigilsTaken,
    finaleTriggered: !!raw.finaleTriggered,
    finaleLit: !!raw.finaleLit,
    position,
  };
}

export function parseSaveText(text){
  let obj;
  try { obj = JSON.parse(text); }
  catch (e) { throw new Error("that file isn't valid JSON"); }
  const save = sanitizeSave(obj);
  if (!save) throw new Error("that file isn't a Necropolis Prime save");
  return save;
}

export function serializeSave(save){
  return JSON.stringify(save, null, 2);
}

export async function loadSave(kv){
  const folder = folderFor(kv);
  if (!folder) return null;
  try { return sanitizeSave(await folder.get(KEY)); }
  catch (e) { return null; }
}

export async function writeSave(kv, save){
  const folder = folderFor(kv);
  if (!folder) return false;
  try { await folder.set(KEY, save); return true; }
  catch (e) { return false; }
}

export async function clearSave(kv){
  const folder = folderFor(kv);
  if (!folder) return false;
  try { await folder.delete(KEY); return true; }
  catch (e) { return false; }
}

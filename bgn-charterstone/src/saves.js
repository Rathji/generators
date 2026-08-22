// src/saves.js — Phase 15 save slots & continue campaign (Task 72).
// Campaign autosave + manual named slots over the kv-plugin, plus a
// "continue campaign" flow that resumes a mid-game board (a saved game
// state) or an between-games state (a saved campaign record, ready to
// beginNextGame). Everything round-trips through the real serializers.

import { campaignStateToJSON, campaignStateFromJSON } from "./campaignState.js";

export const SAVES_VERSION = 1;
export const SAVES_FOLDER = "charterstone-saves";
export const AUTOSAVE_SLOT = "autosave";

function resolveKv(kv) {
  if (kv) return kv;
  if (typeof window === "undefined") return null;
  if (window.kv) return window.kv;
  if (window.root && window.root.kv) return window.root.kv;
  return null;
}

export function createSaves(opts = {}) {
  const kv = resolveKv(opts.kv);
  const folder = opts.folder ?? SAVES_FOLDER;
  if (!kv) throw new Error("saves: kv-plugin is not available");

  async function readIndex() {
    const v = await kv[folder].get("index");
    return v && v.slots && typeof v.slots === "object" ? v.slots : {};
  }
  async function writeIndex(slots) {
    await kv[folder].set("index", { version: SAVES_VERSION, slots });
  }

  function metaOf(slotName, payload) {
    const meta = payload.meta ?? {};
    return {
      kind: payload.campaign ? "campaign" : "game",
      savedAt: Date.now(),
      gameNumber: (payload.state && payload.state.gameNumber) ?? (payload.campaign && payload.campaign.gameNumber) ?? null,
      campaignId: (payload.state && payload.state.campaignId) ?? (payload.campaign && payload.campaign.id) ?? null,
      slot: slotName,
      hasState: !!payload.state,
      ...meta,
    };
  }

  const saves = {
    async list() {
      const slots = await readIndex();
      return Object.entries(slots)
        .map(([name, m]) => ({ name, ...m }))
        .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    },
    async save(slotName, payload = {}, meta = {}) {
      const name = String(slotName || AUTOSAVE_SLOT);
      const record = {
        kind: "charterstone-save",
        version: SAVES_VERSION,
        state: payload.state ? payload.state.toJSON() : undefined,
        campaign: payload.campaign ? campaignStateToJSON(payload.campaign) : undefined,
        meta,
      };
      await kv[folder].set("slot:" + name, record);
      const slots = await readIndex();
      slots[name] = metaOf(name, { ...payload, meta });
      await writeIndex(slots);
      return slots[name];
    },
    async load(slotName) {
      const record = await kv[folder].get("slot:" + String(slotName));
      if (!record) return null;
      return {
        kind: record.kind ?? "charterstone-save",
        version: record.version,
        state: record.state ?? null,
        campaign: record.campaign ? campaignStateFromJSON(record.campaign) : null,
        meta: record.meta ?? {},
        savedAt: record.savedAt,
      };
    },
    async remove(slotName) {
      await kv[folder].delete("slot:" + String(slotName));
      const slots = await readIndex();
      delete slots[String(slotName)];
      await writeIndex(slots);
      return true;
    },
    async autosave(payload = {}, meta = {}) {
      return saves.save(AUTOSAVE_SLOT, payload, meta);
    },
    async latest() {
      const list = await saves.list();
      return list.length ? list[0] : null;
    },
    // Continue the most recent saved state for a campaign — resuming a
    // mid-game board (hasState) or an between-games campaign record.
    async continueCampaign({ campaignId } = {}) {
      const list = await saves.list();
      const entry = list.find(s => s.slot === AUTOSAVE_SLOT) || list.find(s => !campaignId || s.campaignId === campaignId) || list[0];
      if (!entry) return null;
      const record = await saves.load(entry.name);
      return { ...record, slot: entry.name };
    },
  };
  return saves;
}

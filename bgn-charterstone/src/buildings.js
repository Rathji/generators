// src/buildings.js — building definitions (Phase 4: The Commons).
// The six fixed Commons buildings carry their printed effects. Costs may be a
// plain items map or a function `ctx => items` (e.g. "any 1 resource"); a
// function returning null means "not statically determinable" (defer to the
// benefit preflight, e.g. the Zeppelin's card-chosen cost). `influenceCost`
// is a token cost spent to the general supply (discarded), checked before any
// side effects. Benefits may be `{items}` (item transfer), a simple function,
// or `{preflight(ctx), apply(ctx)}`: preflight runs BEFORE the cost is
// committed and returns `{ok:false, reason}` to reject the placement cleanly;
// apply runs after. Constructed-building content data (Task 23/39) extends
// DEFAULT_BUILDING_DEFS — only the six Commons are defined here.

import { RESOURCE_TYPES } from "./economy.js";
import { CARD_TYPES } from "./cards.js";
import { TRACK_REASONS } from "./progress.js";
import { DEFAULT_BUILDING_TILES } from "./buildingTiles.js";
import { applyCrateContents } from "./indexGuide.js";

const RESOURCE_SET = new Set(RESOURCE_TYPES);

function invalidResource() {
  const e = new Error("invalid_resource: not a valid resource");
  e.code = "invalid_resource";
  return e;
}

function anyOneResourceCost(ctx = {}) {
  const res = ctx.resource;
  if (res == null) return { clay: 1 };
  if (res === "coins" || !RESOURCE_SET.has(res)) throw invalidResource();
  return { [res]: 1 };
}

export const COMMONS_BUILDING_DEFS = {
  treasury: {
    id: "treasury", name: "Treasury", slots: 1, commons: true, phase: 4,
    cost: anyOneResourceCost,
    benefit: { items: { coins: 1 } },
  },
  market: {
    id: "market", name: "Market", slots: 1, commons: true, phase: 4,
    cost: ctx => {
      const base = anyOneResourceCost(ctx);
      base.coins = 1;
      return base;
    },
    benefit: {
      preflight(ctx) {
        const st = ctx.state;
        if (!ctx.matCardId || !st.advancement.onMat(ctx.matCardId)) return { ok: false, reason: "no_such_mat_card" };
        if (st.player(ctx.playerId).hasCard(ctx.matCardId)) return { ok: false, reason: "card_already_held" };
        return { ok: true };
      },
      apply(ctx) {
        const st = ctx.state;
        const g = st.advancement.gainCard(ctx.playerId, ctx.matCardId);
        if (!g.ok) return g;
        st.player(ctx.playerId).gainCard(ctx.matCardId);
        return { ok: true, cardId: ctx.matCardId, replacedFrom: g.replacedFrom };
      },
    },
  },
  grandstand: {
    id: "grandstand", name: "Grandstand", slots: 1, commons: true, phase: 4,
    cost: {},
    assistantTriggers: ["scoreObjective"],
    benefit: {
      preflight(ctx) {
        const st = ctx.state;
        const o = st.objectives;
        if (!ctx.objectiveId || !o.isRevealed(ctx.objectiveId)) return { ok: false, reason: "no_such_objective" };
        if (!o.isCompleted(ctx.objectiveId)) return { ok: false, reason: "objective_not_completed" };
        if (o.hasScored(ctx.objectiveId, ctx.playerId)) return { ok: false, reason: "already_scored" };
        if (st.influence.availableOf(ctx.playerId) < 1) return { ok: false, reason: "no_influence" };
        return { ok: true };
      },
      apply(ctx) {
        const st = ctx.state;
        return st.engine.scoreObjective(ctx.playerId, ctx.objectiveId);
      },
    },
  },
  zeppelin: {
    id: "zeppelin", name: "Zeppelin", slots: 1, commons: true, phase: 4,
    influenceCost: 3,
    assistantTriggers: ["construct"],
    cost: ctx => {
      if (!ctx || !ctx.cardId) return null;
      const card = ctx.state && ctx.state.cards ? ctx.state.cards[ctx.cardId] : null;
      if (!card) return null;
      return { ...(card.constructionCost ?? {}) };
    },
    benefit: {
      preflight(ctx) {
        const st = ctx.state;
        const card = st.cards ? st.cards[ctx.cardId] : null;
        if (!card) return { ok: false, reason: "no_such_card" };
        if (!st.player(ctx.playerId).hasCard(ctx.cardId)) return { ok: false, reason: "card_not_in_hand" };
        if (card.type !== CARD_TYPES.UNCONSTRUCTED_BUILDING) return { ok: false, reason: "not_constructable" };
        if (!st.board.isConstructable(ctx.constructionCell)) return { ok: false, reason: "illegal_construction_cell" };
        const charterId = st.turns.playerCharter(ctx.playerId);
        if (!st.board.isLegalConstructionCellForOwner(ctx.playerId, charterId, ctx.constructionCell)) {
          return { ok: false, reason: "illegal_construction_cell" };
        }
        if (!st.economy.canPay(ctx.playerId, card.constructionCost ?? {})) return { ok: false, reason: "cannot_afford_cost" };
        return { ok: true };
      },
      apply(ctx) {
        const st = ctx.state;
        const card = st.cards[ctx.cardId];
        st.player(ctx.playerId).removeCard(ctx.cardId);
        st.economy.pay(ctx.playerId, card.constructionCost);
        const cell = st.board.placeBuilding(ctx.constructionCell, card.buildingId, ctx.playerId);
        const tile = st.buildingTiles ? st.buildingTiles[card.buildingId] : null;
        const crateNumber = tile ? (tile.crateNumber ?? null) : null;
        if (crateNumber != null) {
          const cid = "cbldg-" + card.buildingId;
          // defensive: skip the leftover if a duplicate construction already
          // put it in the Archive (can't re-enter a hand)
          if (st.cards[cid] && !(st.archive && st.archive.has(cid))) st.player(ctx.playerId).gainCard(cid);
        } else {
          st.archive.add(card.id);
        }
        st.player(ctx.playerId).addVp(5);
        st.progress.advance(TRACK_REASONS.CONSTRUCT);
        return { ok: true, buildingId: card.buildingId, cell: cell.key, vp: 5, leftover: crateNumber != null ? "cbldg-" + card.buildingId : "archived" };
      },
    },
  },
  charterstone: {
    id: "charterstone", name: "Charterstone", slots: 1, commons: true, phase: 4,
    cost: { coins: 4 },
    influenceCost: 2,
    benefit: {
      preflight(ctx) {
        const st = ctx.state;
        const card = st.cards ? st.cards[ctx.cardId] : null;
        if (!card) return { ok: false, reason: "no_such_card" };
        if (!st.player(ctx.playerId).hasCard(ctx.cardId)) return { ok: false, reason: "card_not_in_hand" };
        if (card.type !== CARD_TYPES.CONSTRUCTED_BUILDING || !card.crateNumber) return { ok: false, reason: "no_crate" };
        if (st.crates.isUnlocked(ctx.cardId)) return { ok: false, reason: "already_unlocked" };
        return { ok: true };
      },
      apply(ctx) {
        const st = ctx.state;
        const card = st.cards[ctx.cardId];
        st.crates.unlock(ctx.playerId, ctx.cardId, card.crateNumber);
        st.player(ctx.playerId).removeCard(ctx.cardId);
        st.archive.add(ctx.cardId);
        st.player(ctx.playerId).addVp(5);
        st.progress.advance(TRACK_REASONS.CRATE);
        let contents = null;
        try {
          contents = applyCrateContents(st, card.crateNumber, ctx.playerId);
        } catch (err) {
          contents = { ok: false, reason: "crate_content_error", message: err.message };
        }
        return { ok: true, cardId: ctx.cardId, crateNumber: card.crateNumber, vp: 5, archived: true, contents };
      },
    },
  },
  cloudport: {
    id: "cloudport", name: "Cloud Port", slots: 1, commons: true, phase: 4,
    cost: {},
    benefit: {
      preflight(ctx) {
        const st = ctx.state;
        if (!ctx.quotaSpaceId) return { ok: false, reason: "no_such_space" };
        const sp = st.quota.space(ctx.quotaSpaceId);
        if (!sp) return { ok: false, reason: "no_such_space" };
        if (!st.quota.isOpen(ctx.quotaSpaceId)) return { ok: false, reason: "space_closed" };
        if (!st.economy.canPay(ctx.playerId, { [sp.commodity.type]: sp.commodity.quantity })) {
          return { ok: false, reason: "cannot_afford_cost" };
        }
        if (st.influence.availableOf(ctx.playerId) < 1) return { ok: false, reason: "no_influence" };
        return { ok: true };
      },
      apply(ctx) {
        return ctx.state.quota.sell(ctx.playerId, ctx.quotaSpaceId);
      },
    },
  },
};

export const DEFAULT_BUILDING_DEFS = { ...COMMONS_BUILDING_DEFS };
export const DEFAULT_ENGINE_DEFS = { ...COMMONS_BUILDING_DEFS, ...DEFAULT_BUILDING_TILES };

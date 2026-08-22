/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/net.js  (interface stubs; Phase 23)
   Online multiplayer over the server-plugin. Stubs document the
   contracts; the real rooms/sync arrive with the multiplayer phase.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const Dominion = (global.Dominion = global.Dominion || {});
  const net = { connected: false, roomCode: null, role: null };
  Dominion.net = net;

  /* Create or join a room; returns { code, role, snap }. */
  net.connect = async function (code) {
    throw new Error("net.connect arrives with the multiplayer phase");
  };

  /* Submit a move payload for the current turn. */
  net.sendMove = function (payload) {
    return;
  };

  /* Subscribe to state broadcasts; cb(snapshot). */
  net.onState = function (cb) {
    return;
  };

})(typeof self !== "undefined" ? self : globalThis);

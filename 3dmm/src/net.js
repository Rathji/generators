/*
 * net.js — the client half of the shared rig stage.
 *
 * A room is a set of people watching/posing a rig together. The server (see the
 * `text/x-server-plugin` script in index.html) is a thin, authoritative relay:
 *   • it keeps the room roster and each member's rig *description* (bone names +
 *     hierarchy offsets) so every client can draw every other client's skeleton;
 *   • it relays compact binary pose frames (a tag byte + quantised quaternions),
 *     tagging each with the sender's slot so receivers know who moved;
 *   • it remembers the room's *last pose* durably, so a joiner (or a reconnect
 *     tomorrow) sees the pose the room was left in;
 *   • it owns a durable, per-room named-pose library (save / list / load / delete).
 *
 * Everything here is failure-tolerant: the socket reconnects with capped backoff,
 * and nothing is queued for replay across a reconnect (the server may already have
 * processed a frame we never got an ack for).
 */

import { encodePose, decodePose } from "./armature.js";

const MSG_POSE = 1;
const SLOT_ROOM = 0xffff; // frames tagged with this are the room's durable last pose
const MIN_POSE_INTERVAL = 60; // ms between outgoing pose frames
const POSE_EPSILON = 0.0006; // skip a frame when every quaternion moved less than this
const POS_EPSILON = 0.0002; // ...and every position delta moved less than this

function toAB(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

export function createNet({ onEvent } = {}) {
  const listeners = { status: [], roster: [], rig: [], pose: [], poses: [], notice: [] };
  const emit = (type, data) => {
    for (const fn of listeners[type] || []) {
      try { fn(data); } catch (e) { console.warn("net listener", type, e); }
    }
    if (typeof onEvent === "function") {
      try { onEvent(type, data); } catch (e) { console.warn("net onEvent", e); }
    }
  };

  let socket = null;
  let status = "idle";
  let detail = "";
  let room = null;
  let displayName = "";
  let selfSlot = -1;
  let rigInfo = null;
  let poseBuffer = null;
  let lastSentAt = 0;
  let lastSent = null;
  let reconnectTimer = null;
  let reconnectDelay = 800;
  let wantOnline = false;
  let identified = false;

  function setStatus(s, d = "") {
    status = s;
    detail = d;
    emit("status", { state: s, detail: d, room, selfSlot, online: s === "online" });
  }

  function getRoot() {
    return typeof window !== "undefined" ? window.root : null;
  }

  /* --------------------------------------------------------------- lifecycle */

  function connect({ room: r, name, info } = {}) {
    if (r != null) room = String(r).slice(0, 64);
    if (name != null) displayName = String(name).slice(0, 24);
    if (info) rigInfo = info;
    wantOnline = true;
    reconnectDelay = 800;
    open();
  }

  function open() {
    const root = getRoot();
    if (!root || typeof root.createServerSocket !== "function") {
      setStatus("error", "server unavailable");
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    setStatus("connecting");
    let s;
    try {
      s = root.createServerSocket();
    } catch (e) {
      setStatus("error", String((e && e.message) || e));
      scheduleReconnect();
      return;
    }
    socket = s;
    identified = false;
    try { s.binaryType = "arraybuffer"; } catch (e) { /* native only */ }
    s.addEventListener("open", onOpen);
    s.addEventListener("message", onMessage);
    s.addEventListener("close", onClose);
    s.addEventListener("error", () => { });
  }

  function onOpen() {
    reconnectDelay = 800;
    identified = true;
    setStatus("online");
    sendControl({ t: "hi", room, name: displayName });
    if (rigInfo) announceRig(rigInfo, true);
  }

  function onClose(ev) {
    const code = ev && ev.code;
    const reason = (ev && ev.reason) || "";
    socket = null;
    selfSlot = -1;
    if (!wantOnline) {
      setStatus("idle");
      return;
    }
    if (code === 4403) {
      wantOnline = false;
      setStatus("error", "realtime needs the generator opened on perchance.org");
      return;
    }
    // Anything else is transient (1006 network, 1012 restart, 1013 busy, 4429 quarantine).
    setStatus("offline", reason || `closed (${code == null ? "?" : code})`);
    scheduleReconnect(code, reason);
  }

  function scheduleReconnect(code, reason) {
    if (!wantOnline) return;
    let delay = reconnectDelay;
    if (code === 4429 || code === 1013) {
      const m = /(\d+)\s*(ms|s|sec|seconds?)/i.exec(reason || "");
      if (m) delay = Math.max(delay, (Number(m[1]) || 1) * (m[2].toLowerCase().startsWith("ms") ? 1 : 1000));
    }
    reconnectDelay = Math.min(reconnectDelay * 1.7, 15000);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (wantOnline) open();
    }, delay + Math.random() * 400);
  }

  function disconnect() {
    wantOnline = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) {
      try { socket.close(1000, "bye"); } catch (e) { /* ignore */ }
      socket = null;
    }
    selfSlot = -1;
    setStatus("idle");
    emit("roster", []);
  }

  function sendControl(obj) {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  function announceRig(info, force) {
    if (info) rigInfo = info;
    if (!rigInfo) return;
    sendControl({
      t: "rig",
      bones: rigInfo.bones,
      parent: rigInfo.parent,
      offs: Array.from(rigInfo.offs),
      sig: rigInfo.signature,
      sc: rigInfo.scale,
    });
  }

  /* --------------------------------------------------------------- messages */

  function onMessage(ev) {
    const data = ev.data;
    if (typeof data === "string") {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      handleControl(msg);
      return;
    }
    handleBinary(data);
  }

  function handleControl(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === "welcome") {
      selfSlot = msg.slot | 0;
      emit("status", { state: "online", detail: "", room, selfSlot, online: true });
      return;
    }
    if (msg.t === "roster") {
      emit("roster", (msg.users || []).map((u) => ({ slot: u.s, name: u.n, sig: u.g, isSelf: u.s === selfSlot })));
      return;
    }
    if (msg.t === "rig") {
      // The server echoes our own rig description back to us; we already have it.
      if (msg.s === selfSlot) return;
      emit("rig", {
        slot: msg.s,
        name: msg.n,
        sig: msg.g,
        scale: typeof msg.sc === "number" && msg.sc > 0 ? msg.sc : 1,
        bones: msg.b || [],
        parent: msg.p || [],
        offs: Float32Array.from(msg.o || []),
      });
      return;
    }
    if (msg.t === "serverRestart") {
      // Surviving sockets don't get a browser `open` again after a server rebuild.
      if (identified) { sendControl({ t: "hi", room, name: displayName }); if (rigInfo) announceRig(rigInfo); }
      return;
    }
    if (msg.t === "notice") {
      emit("notice", { text: msg.text || "" });
    }
  }

  function handleBinary(data) {
    const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
    if (view.length < 3) return;
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    const slot = dv.getUint16(0, true);
    const payload = view.subarray(2);
    if (payload.length < 4 || payload[0] !== MSG_POSE) return;
    const decoded = decodePose(payload.subarray(1));
    if (!decoded) return;
    if (slot !== SLOT_ROOM && slot === selfSlot) return; // our own echo
    emit("pose", { slot, quats: decoded.quats, deltas: decoded.deltas, boneCount: decoded.boneCount, room: slot === SLOT_ROOM });
  }

  /* --------------------------------------------------------------- publishing */

  function poseMoved(pose) {
    if (!lastSent) return true;
    const q = pose.quats;
    if (lastSent.quats.length !== q.length) return true;
    for (let i = 0; i < q.length; i++) {
      if (Math.abs(q[i] - lastSent.quats[i]) > POSE_EPSILON) return true;
    }
    const d = pose.deltas;
    const pd = lastSent.deltas;
    if (!!d !== !!pd) return true;
    if (d && pd) {
      if (d.length !== pd.length) return true;
      for (let i = 0; i < d.length; i++) {
        if (Math.abs(d[i] - pd[i]) > POS_EPSILON) return true;
      }
    }
    return false;
  }

  function sendPose(pose, { force = false } = {}) {
    if (!socket || socket.readyState !== 1 || !pose || !pose.quats) return false;
    const now = performance.now();
    if (!force && now - lastSentAt < MIN_POSE_INTERVAL) return false;
    if (!force && !poseMoved(pose)) return false;
    let payload;
    try {
      payload = encodePose(pose);
    } catch (e) {
      return false;
    }
    const out = new Uint8Array(1 + payload.length);
    out[0] = MSG_POSE;
    out.set(payload, 1);
    try {
      socket.send(toAB(out));
    } catch (e) {
      return false;
    }
    lastSentAt = now;
    lastSent = {
      quats: pose.quats.slice(),
      deltas: pose.deltas ? pose.deltas.slice() : null,
    };
    return true;
  }

  /* --------------------------------------------------------------- RPC */

  async function rpc(method, arg) {
    if (!socket || socket.readyState !== 1) throw new Error("not connected");
    return socket.rpc[method](arg);
  }

  function packSavePayload(name, author, data) {
    const nb = new Uint8Array(new TextEncoder().encode(name));
    const ab = new Uint8Array(new TextEncoder().encode(author || ""));
    const head = 4;
    const out = new Uint8Array(head + nb.length + ab.length + data.length);
    out[0] = Math.min(nb.length, 255);
    out[1] = Math.min(ab.length, 255);
    new DataView(out.buffer).setUint16(2, data.length, true);
    out.set(nb, 4);
    out.set(ab, 4 + nb.length);
    out.set(data, 4 + nb.length + ab.length);
    return out;
  }

  async function savePose(name, pose) {
    const payload = packSavePayload(name, displayName, encodePose(pose));
    const res = await rpc("savePose", toAB(payload));
    const parsed = typeof res === "string" ? JSON.parse(res) : res;
    if (!parsed || !parsed.ok) throw new Error((parsed && parsed.err) || "save failed");
    return parsed.id;
  }

  async function listPoses() {
    const res = await rpc("listPoses", "");
    const bytes = res instanceof ArrayBuffer ? new Uint8Array(res) : res && res.buffer ? new Uint8Array(res.buffer, res.byteOffset || 0, res.byteLength) : new Uint8Array(0);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 2) return [];
    const n = dv.getUint16(0, true);
    const dec = new TextDecoder();
    const out = [];
    let o = 2;
    for (let i = 0; i < n && o + 12 <= bytes.length; i++) {
      const id = dv.getUint32(o, true);
      const ts = dv.getUint32(o + 4, true);
      const nl = bytes[o + 8];
      const al = bytes[o + 9];
      const dl = dv.getUint16(o + 10, true);
      o += 12;
      const name = dec.decode(bytes.subarray(o, o + nl)); o += nl;
      const author = dec.decode(bytes.subarray(o, o + al)); o += al;
      out.push({ id, ts, name, author, bytes: dl });
    }
    return out;
  }

  async function getPose(id) {
    const res = await rpc("getPose", String(id));
    const bytes = res instanceof ArrayBuffer ? new Uint8Array(res) : res && res.buffer ? new Uint8Array(res.buffer, res.byteOffset || 0, res.byteLength) : new Uint8Array(0);
    return decodePose(bytes);
  }

  async function deletePose(id) {
    const res = await rpc("deletePose", String(id));
    const parsed = typeof res === "string" ? JSON.parse(res) : res;
    return !!(parsed && parsed.ok);
  }

  function on(type, fn) {
    (listeners[type] || (listeners[type] = [])).push(fn);
    return () => off(type, fn);
  }
  function off(type, fn) {
    const arr = listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  return {
    connect,
    disconnect,
    announceRig,
    sendPose,
    savePose,
    listPoses,
    getPose,
    deletePose,
    on,
    off,
    get status() { return status; },
    get detail() { return detail; },
    get room() { return room; },
    set room(r) { room = r == null ? null : String(r).slice(0, 64); },
    get name() { return displayName; },
    set name(n) { displayName = n == null ? "" : String(n).slice(0, 24); },
    get slot() { return selfSlot; },
    get online() { return status === "online"; },
    get wantsOnline() { return wantOnline; },
  };
}

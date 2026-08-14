import { LocalWebSocket } from "./ws";

// Installs the browser-facing shims before any game code runs.
(globalThis as any).WebSocket = LocalWebSocket;
(globalThis as any).process = (globalThis as any).process || {
  env: {},
  argv: [],
  exit: (code: number) => console.log("[openciv] process.exit(" + code + ")"),
};

export {};


import { createApp } from "./ui.js";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const app = createApp({ canvas, ctx });
app.init();
window.swtd = app;

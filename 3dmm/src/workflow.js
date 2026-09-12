/*
 * workflow.js — the guided production pipeline ("Workflow" button).
 *
 * The app is powerful but wide: the prompt, image, reconstruction, look, rig,
 * animation and export each live in their own card or overlay. This turns them
 * into ONE ordered, stateful flow — seven steps from idea to a finished,
 * animated, exported model — with a live status per step (✓ done / ● current /
 * · todo), inline controls for the step you are on, and a Continue that carries
 * you forward.
 *
 * It is not a second source of truth. Every control is a thin mirror of an
 * existing one (the prompt box, resolution, quality, look preset) or a shortcut
 * that calls the very same function the panel button calls, and every status is
 * read from the real app state through the `app` getters main.js passes in. So a
 * step flips to done the instant its result exists — however the user produced
 * it (Workflow, the left panel, a drag-drop, a script). Nothing here needs to be
 * kept in sync by hand.
 *
 * Public API: createWorkflow({ getKv, app, toast }) -> { open, close, toggle,
 *   refresh, go, get step, get isOpen }.
 *
 * `app` (all supplied by main.js — see the createWorkflow call there):
 *   prompt:{get,set}, randomPrompt(), refs()->{image,model,video},
 *   generatedImage(), info()->{hasModel,triangles,quality,mode},
 *   rigInfo()->{bones,clips}|null, motionId(), keyCount(),
 *   resolution:{get,set}, cutout:{get,set}, quality:{get,set},
 *   lookPresets()->[{id,label}], lookPreset:{get,set},
 *   motionList()->[{id,label,category}],
 *   generateImage(), generate3d(), build3d(),
 *   playMotion(id), stopMotion(),
 *   openRig(), openStudio(), openLibrary(), openAiTab(id),
 *   export(kind)->Promise.
 */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const STEPS = [
  { id: "idea", title: "Idea", goal: "Describe what you want, or attach a reference (image, 3D, video)." },
  { id: "image", title: "AI image", goal: "Generate the reference image from your prompt." },
  { id: "mesh", title: "3D model", goal: "Reconstruct a mesh from the image." },
  { id: "look", title: "Look", goal: "Pick the lighting rig and render style.", optional: true },
  { id: "rig", title: "Rig", goal: "Load or inspect a skeleton so the model can move.", optional: true },
  { id: "anim", title: "Animate", goal: "Procedural motion, AI animation, or hand-keyed frames.", optional: true },
  { id: "export", title: "Export", goal: "Export GLB / PLY / STL / OBJ / PNG, or a destination-ready package (3D print, Tabletop Simulator, VTT token, game engine)." },
];

export function createWorkflow({ getKv, app, toast, onChange } = {}) {
  let panel = null;
  let open = false;
  let cur = 0;
  let exported = false;
  let poll = 0;
  let curBody = null; // { el, sync }
  let railEls = [];
  let progressEl = null;
  let progressFill = null;
  let countEl = null;
  let bodyHost = null;
  let footPrimary = null;

  const kv = () => (typeof getKv === "function" ? getKv() : null);

  /* ------------------------------------------------------------------ status */

  function done(i) {
    const id = STEPS[i].id;
    try {
      if (id === "idea") {
        const r = app.refs ? app.refs() : {};
        return !!((app.prompt.get() || "").trim() || r.image || r.model || r.video);
      }
      if (id === "image") return !!app.generatedImage();
      if (id === "mesh") return !!app.info().hasModel;
      if (id === "look") return !!app.info().hasModel;
      if (id === "rig") {
        const r = app.rigInfo();
        return !!(r && r.bones > 0);
      }
      if (id === "anim") return !!(app.motionId() || app.keyCount() > 0);
      if (id === "export") return exported;
    } catch (e) {
      return false;
    }
    return false;
  }

  function doneCount() {
    let n = 0;
    for (let i = 0; i < STEPS.length; i++) if (done(i)) n++;
    return n;
  }

  /* -------------------------------------------------------------- persistence */

  async function loadStep() {
    const f = kv() && kv().workflow;
    if (!f) return;
    try {
      const v = await f.get("step");
      if (Number.isFinite(v)) cur = Math.max(0, Math.min(STEPS.length - 1, v));
    } catch (e) {
      /* ignore */
    }
  }

  function saveStep() {
    const f = kv() && kv().workflow;
    if (f) f.set("step", cur).catch(() => {});
  }

  /* -------------------------------------------------------------------- build */

  function build() {
    panel = el("div", "testsOverlay wfOverlay");
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Workflow");

    const sheet = el("div", "testsSheet wfSheet");
    const head = el("div", "testsHead");
    head.append(el("span", "testsTitle", "Workflow"));
    head.append(el("span", "wfTag", "idea \u2192 model \u2192 rig \u2192 animation \u2192 export"));
    const spacer = el("div", "testsSpacer");
    countEl = el("span", "wfCount", "");
    progressEl = el("div", "wfProgress");
    progressFill = el("i", "");
    progressEl.append(progressFill);
    head.append(countEl, progressEl, spacer);
    const closeBtn = el("button", "btn ghost testsClose", "\u00d7");
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", close);
    head.append(closeBtn);

    const body = el("div", "wfBody");
    const rail = el("nav", "wfRail");
    body.append(rail);
    bodyHost = el("div", "wfMain");
    body.append(bodyHost);

    sheet.append(head, body);
    panel.append(sheet);
    panel.addEventListener("click", (e) => {
      if (e.target === panel) close();
    });
    (document.getElementById("app") || document.body).append(panel);
    return panel;
  }

  function buildRail(rail) {
    rail.innerHTML = "";
    railEls = STEPS.map((s, i) => {
      const b = el("button", "wfRailItem");
      const badge = el("span", "wfRailNum", String(i + 1));
      const texts = el("span", "wfRailText");
      texts.append(el("span", "wfRailTitle", s.title));
      texts.append(el("span", "wfRailGoal", s.goal));
      b.append(badge, texts);
      b.addEventListener("click", () => go(i));
      rail.append(b);
      return b;
    });
  }

  /* ------------------------------------------------------------------- bodies */

  function bodyIdea() {
    const view = el("div", "wfControls");
    const ta = document.createElement("textarea");
    ta.rows = 3;
    ta.className = "aiInput";
    ta.placeholder = "a friendly little robot, clay sculpture, plain background";
    ta.value = app.prompt.get() || "";
    ta.addEventListener("input", () => app.prompt.set(ta.value));
    view.append(ta);

    const row = el("div", "testRow");
    const surprise = el("button", "btn ghost", "\ud83c\udfb2 Surprise me");
    surprise.addEventListener("click", () => {
      app.randomPrompt();
      ta.value = app.prompt.get() || "";
      refreshStatus();
    });
    const clear = el("button", "btn ghost", "Clear");
    clear.addEventListener("click", () => {
      app.prompt.set("");
      ta.value = "";
      refreshStatus();
    });
    row.append(surprise, clear);
    view.append(row);

    const refLine = el("div", "wfNote");
    view.append(refLine);
    const sync = () => {
      const r = app.refs ? app.refs() : {};
      const bits = [];
      bits.push(r.image ? "\u2713 reference image" : "\u00b7 no reference image");
      bits.push(r.model ? "\u2713 3D reference" : "\u00b7 no 3D reference");
      bits.push(r.video ? "\u2713 video reference" : "\u00b7 no video reference");
      refLine.textContent = "Attachments: " + bits.join("   ");
      if (document.activeElement !== ta) ta.value = app.prompt.get() || "";
    };
    return { el: view, sync };
  }

  function bodyImage() {
    const view = el("div", "wfControls");

    const prev = el("div", "wfPreview");
    view.append(prev);

    const mini = el("div", "mini");
    const resField = el("label", "field");
    resField.append(el("span", null, "Image size"));
    const res = document.createElement("select");
    for (const v of ["768x768", "512x512", "768x512", "512x768"]) res.append(new Option(v, v));
    res.value = app.resolution.get();
    res.addEventListener("change", () => app.resolution.set(res.value));
    resField.append(res);
    const cutLabel = el("label", "check");
    const cut = document.createElement("input");
    cut.type = "checkbox";
    cut.checked = !!app.cutout.get();
    cut.addEventListener("change", () => app.cutout.set(cut.checked));
    cutLabel.append(cut, el("span", null, "Cut out subject"));
    mini.append(resField, cutLabel);
    view.append(mini);

    const row = el("div", "testRow");
    const gen = el("button", "btn primary grow", "Generate image");
    gen.addEventListener("click", () => runAction(() => app.generateImage(), 1));
    row.append(gen);
    view.append(row);

    const sync = () => {
      const src = app.generatedImage();
      if (src && prev.dataset.src !== src) {
        prev.dataset.src = src;
        prev.innerHTML = "";
        const img = el("img", "wfPreviewImg");
        img.src = src;
        img.alt = "generated";
        prev.append(img);
        prev.hidden = false;
      } else if (!src) {
        prev.dataset.src = "";
        prev.innerHTML = "";
        prev.append(el("div", "wfNote", "No image yet \u2014 the prompt and any references (or the whole 3D prompt-to-model run) feed this step."));
        prev.hidden = false;
      }
    };
    return { el: view, sync };
  }

  function bodyMesh() {
    const view = el("div", "wfControls");

    const seg = el("div", "seg");
    const mk = (id, label) => {
      const b = el("button", "segBtn", label);
      b.type = "button";
      b.dataset.q = id;
      b.addEventListener("click", () => {
        app.quality.set(id);
        refreshStatus();
      });
      seg.append(b);
      return b;
    };
    const fastBtn = mk("fast", "Fast \u00b7 depth");
    const aiBtn = mk("ai", "Accurate \u00b7 AI");
    view.append(seg);

    const note = el("div", "wfNote", "Rebuilds from your image on the left. Accurate mode needs WebGPU.");
    view.append(note);

    const row = el("div", "testRow");
    const build = el("button", "btn primary grow", "Build from image");
    build.addEventListener("click", () => runAction(() => app.build3d(), 2));
    const gen = el("button", "btn ghost grow", "Generate 3D from prompt");
    gen.addEventListener("click", () => runAction(() => app.generate3d(), 2));
    row.append(build, gen);
    view.append(row);

    const volRow = el("div", "testRow");
    const vol = el("button", "btn ghost grow", "Volume & closed solid");
    vol.title = "Build a watertight solid and estimate its real 3D volume (volume, area, mass)";
    vol.addEventListener("click", () => app.openVolume && app.openVolume());
    const aiVol = el("button", "btn ghost grow", "AI volume (accurate)");
    aiVol.title = "Run the TripoSR neural network to reconstruct a real 3D volume, then measure it";
    aiVol.addEventListener("click", () => runAction(() => app.aiVolume && app.aiVolume(), 2));
    if (typeof app.hasWebgpu === "function" && !app.hasWebgpu()) {
      aiVol.disabled = true;
      aiVol.title = "WebGPU is required for the AI reconstruction - use the fast solid instead";
    }
    volRow.append(vol, aiVol);
    view.append(volRow);

    const stats = el("div", "wfStats");
    view.append(stats);
    const volStats = el("div", "wfStats");
    view.append(volStats);

    const sync = () => {
      const info = app.info();
      const q = info.quality || app.quality.get();
      fastBtn.classList.toggle("active", q === "fast");
      aiBtn.classList.toggle("active", q === "ai");
      build.disabled = !app.generatedImage();
      stats.textContent = info.hasModel
        ? `\u2713 model \u00b7 ${(info.triangles || 0).toLocaleString()} triangles \u00b7 mode: ${info.mode}`
        : "No model yet \u2014 build one from the AI image, upload a file, or drag one in.";
      const vt = app.volumeText && app.volumeText();
      volStats.textContent = vt
        ? `${app.volumeClosed && app.volumeClosed() ? "\u2713 closed solid" : "\u00b7 open mesh (no interior)"} \u00b7 volume ${vt}`
        : "\u00b7 volume not measured yet \u2014 open Volume";
    };
    return { el: view, sync };
  }

  function bodyLook() {
    const view = el("div", "wfControls");
    view.append(el("div", "wfNote", "One-click look presets set lighting, environment and grade together. Fine-tune everything in the Realism card or the Studio."));

    const presets = (app.lookPresets && app.lookPresets()) || [];
    const wrap = el("div", "wfChips");
    for (const p of presets) {
      const c = el("button", "wfChip", p.label || p.id);
      c.addEventListener("click", () => {
        app.lookPreset.set(p.id);
        refreshStatus();
      });
      c.dataset.id = p.id;
      wrap.append(c);
    }
    view.append(wrap);

    const row = el("div", "testRow");
    const studio = el("button", "btn primary grow", "Open Studio");
    studio.addEventListener("click", () => app.openStudio());
    row.append(studio);
    view.append(row);

    const sync = () => {
      const cur = app.lookPreset.get();
      for (const c of wrap.children) c.classList.toggle("active", c.dataset.id === cur);
    };
    return { el: view, sync };
  }

  function bodyRig() {
    const view = el("div", "wfControls");
    const stats = el("div", "wfStats");
    view.append(stats);

    const row = el("div", "testRow");
    const openRig = el("button", "btn primary grow", "Open Rig panel");
    openRig.addEventListener("click", () => app.openRig());
    const lib = el("button", "btn ghost grow", "Load a rigged file");
    lib.addEventListener("click", () => app.openLibrary());
    row.append(openRig, lib);
    view.append(row);

    view.append(
      el(
        "div",
        "wfNote",
        "Rigged models (skeleton + weights) can be posed and animated. GLB / FBX / BLEND keep their skeleton; a plain depth mesh cannot be rigged here.",
      ),
    );

    const sync = () => {
      const r = app.rigInfo();
      if (r && r.bones > 0) {
        stats.textContent = `\u2713 rigged \u00b7 ${r.bones} bones \u00b7 ${r.clips || 0} clip(s) in file`;
      } else {
        stats.textContent = "\u00b7 the current model has no skeleton";
      }
    };
    return { el: view, sync };
  }

  function bodyAnim() {
    const view = el("div", "wfControls");
    const stats = el("div", "wfStats");
    view.append(stats);

    const list = (app.motionList && app.motionList()) || [];
    const wrap = el("div", "wfChips");
    const shown = list.filter((m) => m.category !== "Intimate").slice(0, 10).concat(list.filter((m) => m.category === "Intimate").slice(0, 3));
    for (const m of shown) {
      const c = el("button", "wfChip", m.label || m.id);
      c.dataset.id = m.id;
      c.addEventListener("click", () => {
        app.playMotion(m.id);
        refreshStatus();
        renderBody();
      });
      wrap.append(c);
    }
    view.append(wrap);

    const row = el("div", "testRow");
    const ai = el("button", "btn primary grow", "AI animate \u2728");
    ai.addEventListener("click", () => app.openAiTab("animate"));
    const keys = el("button", "btn ghost grow", "Keyframes");
    keys.addEventListener("click", () => app.openRig());
    const stop = el("button", "btn ghost", "Stop");
    stop.addEventListener("click", () => {
      app.stopMotion();
      refreshStatus();
      renderBody();
    });
    row.append(ai, keys, stop);
    view.append(row);

    const sync = () => {
      const id = app.motionId();
      const kc = app.keyCount();
      const bits = [];
      bits.push(id ? `\u25b6 motion: ${id}` : "\u00b7 no motion playing");
      bits.push(kc ? `\u2713 ${kc} authored key(s)` : "\u00b7 no authored keyframes");
      stats.textContent = bits.join("   \u00b7   ");
      for (const c of wrap.children) c.classList.toggle("active", c.dataset.id === id);
    };
    return { el: view, sync };
  }

  function bodyExport() {
    const view = el("div", "wfControls");
    view.append(el("div", "wfNote", "GLB keeps the colour texture and any skin/animation; PLY keeps vertex colours; STL is watertight for printing. For a destination-ready file — print STL, Tabletop Simulator package, VTT token, game-engine GLB with LODs and collision — use Export."));

    const row = el("div", "testRow wfExportRow");
    for (const kind of ["glb", "ply", "stl", "obj", "png"]) {
      const b = el("button", "btn ghost grow", kind.toUpperCase());
      b.addEventListener("click", () => runAction(() => app.export(kind), -1, true));
      row.append(b);
    }
    view.append(row);

    const row2 = el("div", "testRow");
    const lib = el("button", "btn ghost grow", "Open Library");
    lib.addEventListener("click", () => app.openLibrary());
    const vol = el("button", "btn ghost grow", "Volume report");
    vol.addEventListener("click", () => app.openVolume && app.openVolume());
    row2.append(lib, vol);
    view.append(row2);

    const row3 = el("div", "testRow");
    const targets = el("button", "btn primary grow", "Export targets \u2192 print / tabletop / game");
    targets.title = "One finished file per destination: 3D print STL, miniature, Tabletop Simulator package, VTT token, game-engine GLB/OBJ";
    targets.addEventListener("click", () => app.openTargets && app.openTargets());
    row3.append(targets);
    view.append(row3);

    const stats = el("div", "wfStats");
    view.append(stats);
    const sync = () => {
      const info = app.info();
      const lines = [];
      lines.push(
        info.hasModel
          ? exported
            ? "\u2713 exported at least once this session"
            : "\u00b7 nothing exported yet"
          : "\u00b7 build a model first (step 3)",
      );
      const vt = app.volumeText && app.volumeText();
      lines.push(vt ? `volume ${vt}` : "volume not measured yet");
      stats.textContent = lines.join("  \u00b7  ");
    };
    return { el: view, sync };
  }

  const BUILDERS = { idea: bodyIdea, image: bodyImage, mesh: bodyMesh, look: bodyLook, rig: bodyRig, anim: bodyAnim, export: bodyExport };

  /* ------------------------------------------------------------------ render */

  function renderBody() {
    if (!bodyHost) return;
    bodyHost.innerHTML = "";
    const s = STEPS[cur];

    const head = el("div", "wfStepHead");
    const titleWrap = el("div", "wfTitleWrap");
    titleWrap.append(el("div", "wfStepTitle", `${cur + 1}. ${s.title}`));
    titleWrap.append(el("div", "wfStepGoal", s.goal));
    head.append(titleWrap);
    const chip = el("span", "wfStatusChip");
    chip.dataset.role = "chip";
    head.append(chip);
    bodyHost.append(head);

    const built = (BUILDERS[s.id] || bodyIdea)();
    curBody = built;
    bodyHost.append(built.el);

    const foot = el("div", "wfFoot");
    const back = el("button", "btn ghost", "\u25c2 Back");
    back.disabled = cur === 0;
    back.addEventListener("click", () => go(cur - 1));
    const skip = el("button", "btn ghost", "Skip");
    skip.addEventListener("click", () => go(cur + 1));
    const spacer = el("div", "testsSpacer");
    footPrimary = el("button", "btn primary", cur === STEPS.length - 1 ? "Done" : "Continue \u25b8");
    footPrimary.addEventListener("click", () => {
      if (cur === STEPS.length - 1) close();
      else go(cur + 1);
    });
    foot.append(back, skip, spacer, footPrimary);
    bodyHost.append(foot);

    refreshStatus();
  }

  function refreshStatus() {
    const dc = doneCount();
    if (progressFill) progressFill.style.width = Math.round((dc / STEPS.length) * 100) + "%";
    if (countEl) countEl.textContent = `${dc}/${STEPS.length} done`;
    railEls.forEach((b, i) => {
      const isDone = done(i);
      b.classList.toggle("done", isDone && i !== cur);
      b.classList.toggle("active", i === cur);
      b.classList.toggle("current-done", isDone && i === cur);
      const badge = b.querySelector(".wfRailNum");
      if (badge) badge.textContent = isDone && i !== cur ? "\u2713" : String(i + 1);
    });
    const chip = bodyHost && bodyHost.querySelector('[data-role="chip"]');
    if (chip) {
      const isDone = done(cur);
      const s = STEPS[cur];
      chip.textContent = isDone ? "\u2713 done" : s.optional ? "optional" : "to do";
      chip.className = "wfStatusChip " + (isDone ? "ok" : "todo");
    }
    if (curBody && curBody.sync) {
      try {
        curBody.sync();
      } catch (e) {
        /* a status probe must never break the panel */
      }
    }
  }

  /* ------------------------------------------------------------------- flow */

  function go(i) {
    if (typeof i === "string") {
      const idx = STEPS.findIndex((s) => s.id === i);
      if (idx >= 0) i = idx;
    }
    if (!Number.isFinite(i)) return;
    cur = Math.max(0, Math.min(STEPS.length - 1, i));
    saveStep();
    renderBody();
    if (bodyHost) bodyHost.scrollTop = 0;
  }

  async function runAction(fn, advanceTo = -1, markExport = false) {
    if (typeof fn !== "function") return;
    try {
      const r = fn();
      if (advanceTo >= 0 && footPrimary) footPrimary.disabled = true;
      await r;
      if (markExport) exported = true;
      refreshStatus();
      if (advanceTo >= 0 && done(advanceTo)) go(advanceTo + 1);
    } catch (e) {
      toast && toast((e && e.message) || "That step failed", 3000);
    } finally {
      if (footPrimary) footPrimary.disabled = false;
    }
  }

  function refresh() {
    if (!open) return;
    refreshStatus();
    renderBody();
  }

  function startPoll() {
    stopPoll();
    poll = setInterval(refreshStatus, 700);
  }
  function stopPoll() {
    if (poll) clearInterval(poll);
    poll = 0;
  }

  async function openPanel() {
    if (!panel) {
      build();
      buildRail(panel.querySelector(".wfRail"));
    }
    await loadStep();
    open = true;
    panel.hidden = false;
    renderBody();
    startPoll();
    if (typeof onChange === "function") onChange(true);
  }

  function close() {
    open = false;
    stopPoll();
    if (panel) panel.hidden = true;
    if (typeof onChange === "function") onChange(false);
  }

  function toggle() {
    if (open) close();
    else openPanel();
  }

  return {
    open: openPanel,
    close,
    toggle,
    refresh,
    go,
    get step() {
      return STEPS[cur].id;
    },
    get isOpen() {
      return open;
    },
  };
}

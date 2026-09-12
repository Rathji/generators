/*
 * volume-panel.js — the "Volume" overlay: a real, ordered workflow for measuring and
 * building the 3D volume of the model.
 *
 * It is a thin controller over the app (like workflow.js): every reading comes from the
 * live model through `app`, and every button calls the same function the sidebar would.
 * The six steps are all shown at once so the whole pipeline is visible — source image →
 * 3D shape → closed solid → real-world scale → volume estimate → save — with each step
 * marked done / current / todo from that live state.
 *
 * The heavy lifting lives elsewhere: volume.js (analysis + calibration + formatting),
 * volume-build.js (the watertight solid builder) and img3d-worker.js (the neural
 * reconstruction, including multi-view density fusion).
 */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function btn(label, cls, onClick, title) {
  const b = el("button", "btn " + (cls || "ghost"), label);
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

const STEPS = [
  { id: "source", title: "1 · Source image", hint: "The picture the volume is reconstructed from." },
  { id: "shape", title: "2 · 3D shape", hint: "Neural (TripoSR) reconstruction, or the fast depth relief." },
  { id: "solid", title: "3 · Closed solid", hint: "A watertight mesh — required for a well-defined volume." },
  { id: "scale", title: "4 · Real-world scale", hint: "Calibrate the model against a known real size and material." },
  { id: "estimate", title: "5 · Volume estimate", hint: "Volume, surface area, dimensions, mass and watertightness." },
  { id: "save", title: "6 · Save", hint: "Export the solid mesh, or download the measurement report." },
];

export function createVolume({ app, toast } = {}) {
  let overlay = null;
  let wrapper = null;
  let open = false;
  let tick = 0;

  const fmt = () => (app.formatters ? app.formatters : {});
  const fV = (v) => (fmt().formatVolume ? fmt().formatVolume(v) : String(v));
  const fL = (v) => (fmt().formatLength ? fmt().formatLength(v) : String(v));
  const fA = (v) => (fmt().formatArea ? fmt().formatArea(v) : String(v));
  const fM = (v) => (fmt().formatMass ? fmt().formatMass(v) : String(v));

  function elId(id) {
    return overlay ? overlay.querySelector("#" + id) : null;
  }

  /* --------------------------------------------------------------- building */

  function stepCard(id, badgeText) {
    const card = el("div", "volStep");
    card.dataset.step = id;
    const badge = el("div", "volBadge", badgeText);
    const body = el("div", "volBody");
    card.append(badge, body);
    card._badge = badge;
    card._body = body;
    return card;
  }

  function buildStepSource() {
    const card = stepCard("source", "1");
    const body = card._body;
    body.append(el("div", "volTitle", STEPS[0].title));
    body.append(el("div", "volHint", STEPS[0].hint));
    const thumbRow = el("div", "testRow");
    thumbRow.style.alignItems = "center";
    const img = el("img");
    img.id = "volSrcThumb";
    img.alt = "source";
    img.style.cssText = "width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line);background:#0c0f16;";
    const info = el("div", "volSub");
    info.id = "volSrcInfo";
    info.style.flex = "1";
    thumbRow.append(img, info);
    body.append(thumbRow);
    const row = el("div", "testRow");
    row.append(
      btn("Current image", "ghost", () => {
        const src = app.currentImage && app.currentImage();
        if (!src) return toast("Generate or load an image first", 2400);
        toast("Using the current image", 1600);
        refresh();
      }),
      btn("Library", "ghost", () => app.openLibrary && app.openLibrary()),
      btn("Generate image", "ghost", () => app.generateImage && app.generateImage()),
    );
    body.append(row);
    return card;
  }

  function buildStepShape() {
    const card = stepCard("shape", "2");
    const body = card._body;
    body.append(el("div", "volTitle", STEPS[1].title));
    body.append(el("div", "volHint", STEPS[1].hint));

    const seg = el("div", "seg");
    const mk = (id, label) => {
      const b = el("button", "segBtn", label);
      b.type = "button";
      b.dataset.q = id;
      b.addEventListener("click", () => {
        app.setQuality && app.setQuality(id);
        refresh();
      });
      seg.append(b);
      return b;
    };
    const fast = mk("fast", "Fast · depth");
    const ai = mk("ai", "Accurate · AI");
    body.append(seg);
    card._seg = { fast, ai };

    const row = el("div", "testRow");
    row.append(
      btn("Rebuild from image", "primary", () => run(app.rebuildFromImage, "Rebuilding…"), "Reconstruct the current image with the selected method"),
    );
    body.append(row);

    /* Neural volume: the AI network, optionally fusing the front view with a mirror view
       in canonical space (test-time augmentation) to round out a thin reconstruction. */
    const aiBox = el("div");
    aiBox.style.cssText = "border-top:1px dashed var(--line);padding-top:8px;display:flex;flex-direction:column;gap:7px;";
    aiBox.append(el("div", "volTitle", "AI volume (neural network)"));
    aiBox.append(
      el(
        "div",
        "volHint",
        "Runs the TripoSR net and reads the volume straight off its density field. Multi-view fuses the image with its mirror for a fuller, more symmetric solid (≈2× the run time).",
      ),
    );
    const opts = el("div", "volMini");
    const mv = el("label", "check");
    const mvInput = document.createElement("input");
    mvInput.type = "checkbox";
    mvInput.id = "volMultiView";
    mv.append(mvInput, el("span", null, "Multi-view fusion"));
    opts.append(mv);
    const resField = el("label", "volField", "Resolution");
    const resSel = document.createElement("select");
    resSel.id = "volAiRes";
    for (const r of [96, 128, 160, 192, 256]) {
      const o = document.createElement("option");
      o.value = String(r);
      o.textContent = String(r);
      resSel.append(o);
    }
    resSel.value = "160";
    resField.append(resSel);
    opts.append(resField);
    aiBox.append(opts);
    aiBox.append(
      el(
        "div",
        "volHint",
        "The network reconstructs a real 3D mesh (not a relief); the volume is read from its density field and from the closed solid. After the build, step 3 can cap the surface if it came out open.",
      ),
    );
    const aiRow = el("div", "testRow");
    aiRow.append(btn("Build AI volume", "primary", () => run(() => app.buildAiVolume && app.buildAiVolume({ multiView: mvInput.checked, resolution: Number(resSel.value) }), "Running the AI network…"), "Reconstruct and measure the volume with the neural network"));
    aiBox.append(aiRow);
    const gpu = el("div", "volHint");
    gpu.id = "volGpu";
    aiBox.append(gpu);
    body.append(aiBox);
    card._ai = { mv: mvInput, res: resSel, box: aiBox };
    return card;
  }

  function buildStepSolid() {
    const card = stepCard("solid", "3");
    const body = card._body;
    body.append(el("div", "volTitle", STEPS[2].title));
    body.append(el("div", "volHint", STEPS[2].hint));
    const mini = el("div", "volMini");
    const backField = el("label", "volField", "Back surface");
    const sel = document.createElement("select");
    sel.id = "volBackMode";
    for (const m of app.backModes || []) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.label;
      o.title = m.hint || "";
      sel.append(o);
    }
    sel.addEventListener("change", () => app.setBackMode && app.setBackMode(sel.value));
    backField.append(sel);
    mini.append(backField);

    const thickField = el("label", "volField", "Thickness");
    const thick = document.createElement("input");
    thick.type = "range";
    thick.min = "0.01";
    thick.max = String(app.maxThickness ? app.maxThickness() : 0.3);
    thick.step = "0.005";
    thick.value = String(app.getThickness ? app.getThickness() : 0.06);
    thick.style.width = "160px";
    thick.addEventListener("input", () => {
      if (app.setThickness) app.setThickness(Number(thick.value));
      thickVal.textContent = Number(thick.value).toFixed(3);
    });
    const thickVal = el("b", null, Number(thick.value).toFixed(3));
    thickField.append(thick, thickVal);
    mini.append(thickField);
    body.append(mini);

    const row = el("div", "testRow");
    row.append(
      btn("Build closed solid", "primary", () => run(() => app.makeSolid && app.makeSolid(), "Building the solid..."), "Rebuild the current shape as a watertight solid volume"),
      btn("Flat relief", "ghost", () => run(() => app.makeRelief && app.makeRelief(), "Building relief..."), "Go back to the open relief sheet (no measurable interior)"),
    );
    body.append(row);
    const row2 = el("div", "testRow");
    row2.append(
      btn("Close open mesh", "ghost", () => run(() => app.closeMesh && app.closeMesh(), "Capping the open surface..."), "Cap every boundary loop of the current mesh (an AI iso-surface, a scan, a single-sided sheet) to make it watertight, so its volume is well-defined and it can be printed"),
    );
    body.append(row2);
    body.append(
      el("div", "volHint", "Close open mesh caps the holes of the mesh you already have - use it after an Accurate AI build or on an imported model that came in as an open surface."),
    );
    const stats = el("div", "volSub");
    stats.id = "volSolidStats";
    body.append(stats);
    card._back = sel;
    card._thick = thick;
    card._thickVal = thickVal;
    return card;
  }

  function buildStepScale() {
    const card = stepCard("scale", "4");
    const body = card._body;
    body.append(el("div", "volTitle", STEPS[3].title));
    body.append(el("div", "volHint", STEPS[3].hint));
    const mini = el("div", "volMini");

    const hField = el("label", "volField", "Real height");
    const hWrap = el("div");
    hWrap.style.display = "flex";
    hWrap.style.gap = "4px";
    const h = document.createElement("input");
    h.id = "volHeight";
    h.type = "number";
    h.min = "0";
    h.step = "0.001";
    h.placeholder = "e.g. 1.80";
    h.style.width = "90px";
    const unit = document.createElement("select");
    unit.id = "volUnit";
    for (const [v, t] of [["m", "m"], ["cm", "cm"], ["mm", "mm"], ["in", "in"]]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      unit.append(o);
    }
    unit.value = "m";
    hWrap.append(h, unit);
    hField.append(hWrap);
    mini.append(hField);

    const axisField = el("label", "volField", "Along");
    const axis = document.createElement("select");
    axis.id = "volAxis";
    for (const [v, t] of [["y", "Height (Y)"], ["x", "Width (X)"], ["z", "Depth (Z)"]]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      axis.append(o);
    }
    axisField.append(axis);
    mini.append(axisField);

    const dField = el("label", "volField", "Material");
    const dens = document.createElement("select");
    dens.id = "volDensity";
    for (const d of app.densities || []) {
      const o = document.createElement("option");
      o.value = String(d.kgm3);
      o.textContent = d.label + " · " + d.kgm3 + " kg/m³";
      dens.append(o);
    }
    dField.append(dens);
    mini.append(dField);

    body.append(mini);
    const apply = btn("Apply scale", "ghost", () => {
      const meters = toMeters(Number(h.value), unit.value);
      app.setScale && app.setScale({ height: meters, axis: axis.value, density: Number(dens.value) });
      toast(meters > 0 ? "Scale applied" : "Scale cleared — showing model units", 1800);
      refresh();
    });
    const row = el("div", "testRow");
    row.append(apply);
    body.append(row);
    card._h = h;
    card._unit = unit;
    card._axis = axis;
    card._dens = dens;
    return card;
  }

  function buildStepEstimate() {
    const card = stepCard("estimate", "5");
    const body = card._body;
    body.append(el("div", "volTitle", STEPS[4].title));
    const big = el("div", "volBig", "—");
    big.id = "volBig";
    const sub = el("div", "volSub");
    sub.id = "volBigSub";
    body.append(big, sub);
    const table = el("table", "volReport");
    table.id = "volReport";
    body.append(table);
    const row = el("div", "testRow");
    row.append(btn("Measure now", "ghost", () => run(() => app.measure && app.measure(), "Measuring…")));
    body.append(row);
    return card;
  }

  function buildStepSave() {
    const card = stepCard("save", "6");
    const body = card._body;
    body.append(el("div", "volTitle", STEPS[5].title));
    body.append(el("div", "volHint", STEPS[5].hint));
    const row = el("div", "testRow");
    row.append(
      btn("Export GLB", "primary", () => run(() => app.exportGlb && app.exportGlb(), "Exporting…"), "Export the current mesh as GLB"),
      btn("Save report (.txt)", "ghost", () => app.saveReport && app.saveReport()),
    );
    body.append(row);
    return card;
  }

  function build() {
    overlay = el("div", "testsOverlay volOverlay");
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Volume estimation");
    const sheet = el("div", "testsSheet");
    const head = el("div", "testsHead");
    head.append(el("span", "testsTitle", "Volume — real 3D volume estimation"));
    const spacer = el("div", "testsSpacer");
    head.append(spacer);
    const closeBtn = el("button", "btn ghost testsClose", "\u00d7");
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", close);
    head.append(closeBtn);
    wrapper = el("div", "volWrap");
    wrapper.append(
      buildStepSource(),
      buildStepShape(),
      buildStepSolid(),
      buildStepScale(),
      buildStepEstimate(),
      buildStepSave(),
    );
    sheet.append(head, wrapper);
    overlay.append(sheet);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    (document.getElementById("app") || document.body).append(overlay);
    window.addEventListener("textTo3d:volume", () => {
      if (open) refresh();
    });
    return overlay;
  }

  /* ------------------------------------------------------------------ logic */

  function toMeters(value, unit) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (unit === "cm") return value / 100;
    if (unit === "mm") return value / 1000;
    if (unit === "in") return value * 0.0254;
    return value;
  }

  async function run(fn, label) {
    if (typeof fn !== "function") return;
    try {
      if (label && app.setStatus) app.setStatus(label, true);
      await fn();
      refresh();
    } catch (e) {
      console.warn("volume action failed", e);
      toast((e && e.message) || "That didn't work", 3000);
    } finally {
      if (app.clearStatus) app.clearStatus();
    }
  }

  function reportRow(table, key, value, cls) {
    const tr = el("tr");
    tr.append(el("td", null, key));
    const td = el("td", cls || null, value);
    tr.append(td);
    table.append(tr);
    return td;
  }

  function refresh() {
    if (!overlay) return;
    const info = (app.info && app.info()) || {};
    const report = app.report && app.report();
    const cal = app.calibrated && app.calibrated();
    const real = !!(info.scaleHeight > 0);

    /* step status badges */
    const doneMap = {
      source: !!info.hasImage,
      shape: !!info.hasModel,
      solid: !!(report && report.watertight && report.closed),
      scale: real,
      estimate: !!report,
      save: !!report,
    };
    let firstPending = null;
    for (const s of STEPS) {
      const card = overlay.querySelector('[data-step="' + s.id + '"]');
      if (!card) continue;
      const done = doneMap[s.id];
      card.classList.toggle("done", done);
      card.classList.toggle("cur", !done && firstPending === null);
      if (!done && firstPending === null) firstPending = s.id;
      card._badge.textContent = done ? "\u2713" : String(STEPS.indexOf(s) + 1);
    }

    const srcThumb = elId("volSrcThumb");
    const srcInfo = elId("volSrcInfo");
    if (srcThumb) {
      const src = info.imageSrc;
      if (src) {
        srcThumb.src = src;
        srcThumb.hidden = false;
      } else {
        srcThumb.removeAttribute("src");
        srcThumb.hidden = true;
      }
      srcInfo.textContent = src
        ? (info.label || "image") + (info.hasDepth ? " · depth " + info.depth : "")
        : "No image yet — generate one or pick one from the library.";
    }

    const shapeCard = overlay.querySelector('[data-step="shape"]');
    if (shapeCard && shapeCard._seg) {
      const q = info.quality || "fast";
      shapeCard._seg.fast.classList.toggle("active", q === "fast");
      shapeCard._seg.ai.classList.toggle("active", q === "ai");
    }
    const gpu = elId("volGpu");
    if (gpu) {
      const ok = app.hasWebgpu ? app.hasWebgpu() : true;
      gpu.className = "volHint " + (ok ? "volOk" : "volWarn");
      gpu.textContent = ok
        ? "WebGPU ready — the AI reconstruction runs locally on your GPU."
        : "WebGPU unavailable in this browser — use the fast depth solid instead.";
    }

    const backSel = elId("volBackMode");
    if (backSel) backSel.value = info.backMode || "mirror";
    const thick = elId("volThick") || (overlay.querySelector('[data-step="solid"]') || {})._thick;
    if (thick && document.activeElement !== thick) thick.value = String(info.thickness);

    const solidStats = elId("volSolidStats");
    if (solidStats) {
      if (!info.hasModel) solidStats.textContent = "No model yet.";
      else if (info.solid && report) {
        solidStats.textContent =
          (report.watertight && report.closed
            ? "\u2713 watertight solid · "
            : "\u26a0 not closed (" + report.boundaryEdges + " boundary edges) · ") +
          report.triangles.toLocaleString() +
          " triangles";
      } else {
        solidStats.textContent = "Open relief sheet — tick nothing measurable; switch the checkbox to Solid volume for a closed mesh.";
      }
    }

    /* scale inputs (only reflect external state when not being edited) */
    const hEl = elId("volHeight");
    if (hEl && document.activeElement !== hEl) {
      if (real) {
        const unit = elId("volUnit") ? elId("volUnit").value : "m";
        const m = info.scaleHeight;
        hEl.value = String(unit === "cm" ? m * 100 : unit === "mm" ? m * 1000 : unit === "in" ? m / 0.0254 : m);
      } else if (hEl.value === "" && !hEl.placeholder) {
        hEl.placeholder = "e.g. 1.80";
      }
    }
    const axisEl = elId("volAxis");
    if (axisEl) axisEl.value = info.axis || "y";
    const densEl = elId("volDensity");
    if (densEl && info.density) densEl.value = String(info.density);

    /* estimate */
    const big = elId("volBig");
    const bigSub = elId("volBigSub");
    const table = elId("volReport");
    if (big) {
      if (cal && report) {
        big.textContent = real ? fV(cal.volume) : fV(report.volume) + " (units³)";
        bigSub.textContent = real
          ? "calibrated · " + fV(cal.volume) + " · " + fM(cal.mass) + " at " + (info.density || 0) + " kg/m³"
          : "model units — set a real height in step 4 to convert to m³ / litres / kg";
      } else {
        big.textContent = "—";
        bigSub.textContent = info.hasModel ? "Press Measure now." : "Build a model first.";
      }
    }
    if (table) {
      table.innerHTML = "";
      if (report) {
        const dims = cal && real ? cal.dims : report.dims;
        const u = real ? "" : " u";
        reportRow(table, "Dimensions", dims.map((d) => (real ? fL(d) : d.toFixed(3) + " u")).join(" × "));
        reportRow(table, "Volume", real ? fV(cal.volume) + "  (" + fV(cal.volume).replace(/.*/, "") + ")" : report.volume.toFixed(5) + " u³");
        reportRow(table, "Surface area", real ? fA(cal.surfaceArea) : report.surfaceArea.toFixed(4) + " u²");
        reportRow(table, "Mass", real ? fM(cal.mass) : "—");
        reportRow(
          table,
          "Watertight",
          report.watertight ? "yes · closed" : "no · " + report.boundaryEdges + " boundary, " + report.nonManifoldEdges + " non-manifold",
          report.watertight ? "volOk" : "volWarn",
        );
        reportRow(table, "Shells", report.shells + (report.shells === 1 ? " (single)" : " (disconnected)"));
        reportRow(table, "Triangles", report.triangles.toLocaleString());
        reportRow(table, "Filled box", (report.fillRatio * 100).toFixed(1) + "%");
        if (report.principalExtents) {
          reportRow(table, "Principal extents", report.principalExtents.map((d) => (real ? fL(d * (cal ? cal.scale : 1)) : d.toFixed(3) + " u")).join(" × "));
        }
        if (report.centroid) {
          const c = report.centroid;
          reportRow(table, "Centroid", c.map((v) => (real ? fL(v * (cal ? cal.scale : 1)) : v.toFixed(3))).join(", "));
        }
      } else {
        reportRow(table, "Volume", "—");
      }
    }
  }

  function openPanel() {
    if (!overlay) build();
    overlay.hidden = false;
    open = true;
    refresh();
    clearInterval(tick);
    tick = setInterval(() => {
      if (open) refresh();
    }, 1200);
  }

  function close() {
    open = false;
    if (overlay) overlay.hidden = true;
    clearInterval(tick);
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
    get isOpen() {
      return open;
    },
  };
}

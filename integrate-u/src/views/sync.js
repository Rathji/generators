import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";

const KIND_LABEL = {
  "sync.field": "Sync one field",
  "sync.entity": "Sync a whole entity",
  "link.rebuild": "Rebuild the link graph",
  "link.set": "Set a link by hand",
  "identity.merge": "Merge two records",
  "conflict.resolve": "Resolve a conflict",
  "drift.scan": "Scan for drift",
  "alert.notify": "Raise an alert",
};

const KIND_TARGET = {
  "sync.field": { entity: true, field: true },
  "sync.entity": { entity: true, field: false },
  "conflict.resolve": { entity: true, field: true },
  "link.rebuild": { entity: false, field: false },
  "drift.scan": { entity: false, field: false },
  "alert.notify": { entity: false, field: false, notify: true },
};

function statusClass(status) {
  if (status === "succeeded") return "ok";
  if (status === "failed") return "fail";
  if (status === "running") return "warn";
  return "";
}

function statCard(label, value, hint) {
  const card = el("article.pu-card.pu-stat");
  card.appendChild(el("span.pu-stat-label", { text: label }));
  card.appendChild(el("span.pu-stat-value", { text: String(value) }));
  if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
  return card;
}

function entityOptions(hub, typeId) {
  return hub.identity
    .all(typeId)
    .map((entity) => ({ id: entity.id, name: hub.identity.nameOf(typeId, entity) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function timeOf(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function targetLabel(job) {
  const t = job.target || {};
  if (t.entityType && t.entityId && t.field) return `${t.entityType}:${t.entityId} · ${t.field}`;
  if (t.entityType && t.entityId) return `${t.entityType}:${t.entityId}`;
  if (t.typeId && t.keepId) return `${t.typeId}: ${t.keepId} ← ${t.dropId}`;
  if (t.fromType && t.fromId) return `${t.fromType}:${t.fromId} · ${t.field}`;
  return "—";
}

export const syncView = {
  id: "sync",
  title: "Sync jobs",
  group: "Sync",
  icon: "sync",
  nav: true,
  render({ hub }) {
    const root = el("div");
    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const queueCtn = el("div");
    const effectsCtn = el("div");
    const formCtn = el("div");
    let rerender = () => {};

    function renderStats() {
      const s = hub.jobs.stats();
      mount(
        statsCtn,
        statCard("Queued", s.queued, s.running ? `${s.running} running` : "waiting to run"),
        statCard("Succeeded", s.succeeded, `${s.attempts} attempt${s.attempts === 1 ? "" : "s"} recorded`),
        statCard("Dead letters", s.deadLetters, s.failed ? `${s.failed} failed` : "nothing failed"),
        statCard("Effects ledger", s.effects, `${s.dedupes} deduplicated · ${s.reuse} reused`)
      );
    }

    function buildForm() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Queue a sync job" }));
      card.appendChild(
        el("p.pu-small", {
          text: "Jobs are keyed by kind and target, so queueing the same work twice collapses into one job. Each run records its effect in an idempotency ledger, so replays never apply a change twice.",
        })
      );

      const kindSelect = el("select.pu-select", { "aria-label": "Job kind" });
      for (const kind of hub.jobs.kinds().filter((candidate) => KIND_TARGET[candidate])) {
        kindSelect.appendChild(el("option", { value: kind, text: `${KIND_LABEL[kind] || kind} — ${kind}` }));
      }
      kindSelect.value = "sync.field";

      const typeSelect = el("select.pu-select", { "aria-label": "Entity type" });
      for (const type of hub.registry.entityTypes) typeSelect.appendChild(el("option", { value: type.id, text: type.plural }));

      const entitySelect = el("select.pu-select", { "aria-label": "Entity" });
      const fieldSelect = el("select.pu-select", { "aria-label": "Field" });

      const entityRow = el("div.pu-form-row");
      entityRow.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Entity type" }), typeSelect));
      entityRow.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Entity" }), entitySelect));
      const fieldRow = el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Field" }), fieldSelect);

      const notifyRow = el("div.pu-form-row");
      const titleInput = el("input.pu-input", { type: "text", placeholder: "Alert title", "aria-label": "Alert title" });
      const severitySelect = el("select.pu-select", { "aria-label": "Alert severity" });
      for (const severity of hub.alerts.severities) severitySelect.appendChild(el("option", { value: severity, text: severity }));
      severitySelect.value = "warning";
      notifyRow.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Alert title" }), titleInput));
      notifyRow.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Severity" }), severitySelect));

      function syncEntities() {
        const options = entityOptions(hub, typeSelect.value);
        mount(entitySelect);
        for (const option of options) entitySelect.appendChild(el("option", { value: option.id, text: option.name }));
        syncFields();
      }

      function syncFields() {
        mount(fieldSelect);
        for (const field of hub.registry.fieldsFor(typeSelect.value)) {
          fieldSelect.appendChild(el("option", { value: field.key, text: `${field.label || field.key}${field.owner ? ` · ${field.owner}` : ""}` }));
        }
      }

      function syncShape() {
        const shape = KIND_TARGET[kindSelect.value] || { entity: false, field: false };
        entityRow.hidden = !shape.entity;
        fieldRow.hidden = !shape.field;
        notifyRow.hidden = !shape.notify;
      }

      typeSelect.addEventListener("change", syncEntities);
      kindSelect.addEventListener("change", syncShape);
      syncEntities();
      syncShape();

      const form = el("div.pu-form-grid", { style: { "margin-top": "0.75rem" } });
      form.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Job kind" }), kindSelect));
      form.appendChild(entityRow);
      form.appendChild(fieldRow);
      form.appendChild(notifyRow);
      card.appendChild(form);

      const actions = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "margin-top": "0.75rem" } });
      const queueBtn = el("button.pu-btn", { type: "button", text: "Queue job" });
      const driftBtn = el("button.pu-btn.secondary", { type: "button", text: "Queue jobs for open drift" });
      actions.appendChild(queueBtn);
      actions.appendChild(driftBtn);
      card.appendChild(actions);

      queueBtn.addEventListener("click", async () => {
        const kind = kindSelect.value;
        const shape = KIND_TARGET[kind] || {};
        const target = {};
        if (shape.entity) {
          target.entityType = typeSelect.value;
          target.entityId = entitySelect.value;
        }
        if (shape.field) target.field = fieldSelect.value;
        const payload = shape.notify ? { title: titleInput.value.trim() || "Manual integrity alert", severity: severitySelect.value } : {};
        queueBtn.disabled = true;
        try {
          const result = await hub.jobs.enqueue({ kind, target, payload, note: "queued from the sync screen" });
          if (!result.ok) {
            toast(result.error, { tone: "error" });
            return;
          }
          if (result.deduped) toast(`Identical job already present — deduplicated (×${result.job.dedupeCount + 1})`, { tone: "info" });
          else toast(`Queued ${kind}`, { tone: "success" });
          rerender();
        } finally {
          queueBtn.disabled = false;
        }
      });

      driftBtn.addEventListener("click", async () => {
        driftBtn.disabled = true;
        try {
          const queued = await hub.seedDriftJobs();
          toast(queued ? `Queued ${queued} job${queued === 1 ? "" : "s"} for open drift` : "No new drift jobs to queue", { tone: queued ? "success" : "info" });
          rerender();
        } finally {
          driftBtn.disabled = false;
        }
      });

      return card;
    }

    async function runJob(job, { force = false } = {}) {
      const result = await hub.jobs.execute(job.key, { force });
      if (!result.ok) {
        toast(result.error || "Job failed", { tone: "error" });
      } else if (result.reused) {
        toast(`${job.kind} already applied — reused the recorded effect`, { tone: "info" });
      } else {
        toast(`${KIND_LABEL[job.kind] || job.kind} succeeded${result.changes ? ` (${result.changes} change${result.changes === 1 ? "" : "s"})` : ""}`, { tone: "success" });
      }
      rerender();
    }

    function buildQueue() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Job queue" }));
      const jobs = hub.jobs.list();
      head.appendChild(el("span.pu-chip", { text: `${jobs.length} jobs` }));
      if (hub.jobs.deadLetters().length) head.appendChild(el("span.pu-chip.fail", { text: `${hub.jobs.deadLetters().length} dead` }));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "Newest first. Each row shows how many times the work was enqueued (dedupe) and whether the last run applied a change or reused a recorded effect.",
        })
      );

      const toolbar = el("div.pu-toolbar", { style: { "margin-top": "0.75rem" } });
      const runAllBtn = el("button.pu-btn", { type: "button", text: "Run pending" });
      const pruneBtn = el("button.pu-btn.secondary", { type: "button", text: "Remove succeeded" });
      runAllBtn.addEventListener("click", async () => {
        runAllBtn.disabled = true;
        runAllBtn.textContent = "Running…";
        try {
          const summary = await hub.jobs.executeAll();
          await hub.drift.scan();
          toast(`Ran ${summary.attempted} job${summary.attempted === 1 ? "" : "s"} · ${summary.succeeded} succeeded, ${summary.failed} failed`, { tone: summary.failed ? "error" : "success" });
          rerender();
        } finally {
          runAllBtn.disabled = false;
          runAllBtn.textContent = "Run pending";
        }
      });
      pruneBtn.addEventListener("click", async () => {
        const done = hub.jobs.list({ status: "succeeded" });
        for (const job of done) await hub.jobs.remove(job.key);
        toast(done.length ? `Removed ${done.length} succeeded job${done.length === 1 ? "" : "s"}` : "Nothing to remove", { tone: "info" });
        rerender();
      });
      toolbar.appendChild(runAllBtn);
      toolbar.appendChild(pruneBtn);
      card.appendChild(toolbar);

      if (!jobs.length) {
        card.appendChild(el("div.pu-empty", { text: "No jobs queued. Queue one above, or let drift detection suggest fixes." }));
        mount(queueCtn, card);
        return;
      }

      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Job", "Target", "Status", "Attempts", "Runs", "Dedupe", "Last run", ""]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const job of jobs) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("div", { text: KIND_LABEL[job.kind] || job.kind }), el("span.pu-mono.pu-muted", { text: job.kind })));
        tr.appendChild(el("td", {}, el("span.pu-mono.pu-small", { text: targetLabel(job) })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { class: statusClass(job.status), text: job.status })));
        tr.appendChild(el("td", { text: `${job.attempts}/${job.maxAttempts}` }));
        tr.appendChild(el("td", { text: String(job.runCount) }));
        tr.appendChild(el("td", { text: job.dedupeCount ? `×${job.dedupeCount + 1}` : "—" }));
        tr.appendChild(
          el("td", {}, job.lastRun
            ? el("div", {}, el("span.pu-chip", { class: job.lastRun.applied ? "ok" : "warn", text: job.lastRun.applied ? "applied" : "reused" }), el("span.pu-small.pu-muted", { text: ` ${timeOf(job.lastRun.at)}` }))
            : el("span.pu-small.pu-muted", { text: job.error ? job.error : "—" }))
        );
        const actionCell = el("td");
        const actions = el("div", { style: { display: "flex", gap: "0.35rem", "flex-wrap": "wrap" } });
        if (job.status !== "running") {
          const label = job.status === "succeeded" ? "Run again" : job.status === "failed" || job.status === "cancelled" ? "Retry" : "Run";
          const runBtn = el("button.pu-btn.secondary", { type: "button", text: label });
          runBtn.addEventListener("click", async () => {
            runBtn.disabled = true;
            if (label === "Retry") await hub.jobs.retry(job.key);
            await runJob(hub.jobs.get(job.key), { force: false });
          });
          actions.appendChild(runBtn);
        }
        const removeBtn = el("button.pu-btn.secondary", { type: "button", text: "Remove" });
        removeBtn.addEventListener("click", async () => {
          await hub.jobs.remove(job.key);
          toast("Job removed", { tone: "info" });
          rerender();
        });
        actions.appendChild(removeBtn);
        actionCell.appendChild(actions);
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
      mount(queueCtn, card);
    }

    function buildEffects() {
      const effects = hub.jobs.effectsList();
      mount(effectsCtn);
      if (!effects.length) return;
      const card = el("section.pu-card");
      const details = el("details.pu-details", { open: false });
      const summary = el("summary");
      summary.appendChild(el("span.pu-entity-name", { text: "Idempotency ledger" }));
      summary.appendChild(el("span.pu-chip", { text: `${effects.length} effects` }));
      summary.appendChild(el("span.pu-small.pu-muted", { text: "one recorded outcome per job key" }));
      details.appendChild(summary);
      const body = el("div.pu-details-body");
      body.appendChild(el("p.pu-small", { text: "Before a handler runs, the runner checks this ledger. If the job already recorded an effect, the handler is skipped and the previous result is replayed instead." }));
      const list = el("ul.pu-list", { style: { "margin-top": "0.5rem" } });
      for (const effect of effects.slice(0, 20)) {
        const li = el("li");
        li.appendChild(el("span.pu-mono.pu-id", { text: effect.key }));
        li.appendChild(el("span.pu-chip", { class: effect.changes ? "ok" : "", text: effect.changes ? `${effect.changes} change${effect.changes === 1 ? "" : "s"}` : "no-op" }));
        li.appendChild(el("span.pu-small.pu-muted", { text: timeOf(effect.at) }));
        list.appendChild(li);
      }
      body.appendChild(list);
      details.appendChild(body);
      card.appendChild(details);
      effectsCtn.appendChild(card);
    }

    rerender = () => {
      renderStats();
      mount(formCtn, buildForm());
      buildQueue();
      buildEffects();
    };

    root.appendChild(
      pageHead({
        eyebrow: "Sync",
        title: "Idempotent sync jobs",
        subtitle: "Every cross-tool change runs as a keyed job. Retries, replays and duplicate submissions converge on one recorded effect, so a flaky connector can be retried without ever double-applying a change.",
      })
    );
    root.appendChild(statsCtn);
    root.appendChild(formCtn);
    root.appendChild(queueCtn);
    root.appendChild(effectsCtn);

    rerender();
    return root;
  },
};

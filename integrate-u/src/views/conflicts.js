import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";

const DIRECTION_LABEL = {
  push: "One-way push",
  pull: "Pull on demand",
  bidirectional: "Two-way",
  none: "Hub-local",
};

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

function winnerClass(winner) {
  if (winner === "owner") return "ok";
  if (winner === "derived") return "warn";
  return "";
}

function timeOf(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const conflictsView = {
  id: "conflicts",
  title: "Conflicts",
  group: "Integrity",
  icon: "conflicts",
  nav: true,
  render({ hub }) {
    const root = el("div");
    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const rulesCtn = el("div");
    const simCtn = el("div");
    const openCtn = el("div");
    const historyCtn = el("div");

    function renderStats() {
      const s = hub.conflicts.stats();
      mount(
        statsCtn,
        statCard("Open conflicts", s.open, `${s.sensitive} on sensitive fields`),
        statCard("Auto-resolvable", s.auto, "settled by a registry rule"),
        statCard("Needs review", s.manual, "owner has no value to offer"),
        statCard("Resolved", s.resolved, "settlements recorded")
      );
    }

    function directionCounts() {
      const counts = {};
      for (const type of hub.registry.entityTypes) {
        for (const field of hub.registry.fieldsFor(type.id)) {
          counts[field.direction] = (counts[field.direction] || 0) + 1;
        }
      }
      return counts;
    }

    function buildRules() {
      const counts = directionCounts();
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Settlement rules" }));
      card.appendChild(
        el("p.pu-small", {
          text: "The integration registry decides who wins. Each field's declared sync direction maps to exactly one ownership rule, so conflicts settle the same way every time — not by whoever wrote last.",
        })
      );
      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Rule", "Direction", "How it settles", "Declared fields"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const rule of hub.conflicts.rules) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("div", { text: rule.title }), el("span.pu-mono.pu-muted", { text: rule.id })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { text: DIRECTION_LABEL[rule.direction] || rule.direction })));
        tr.appendChild(el("td", {}, el("span.pu-small", { text: rule.settlement })));
        tr.appendChild(el("td", { text: String(counts[rule.direction] || 0) }));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
      mount(rulesCtn, card);
    }

    function buildSimulator() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Simulate a competing write" }));
      card.appendChild(
        el("p.pu-small", {
          text: "Write a value into the hub as if it arrived from a connector that does not own the field. If it disagrees with the owner, a conflict opens and the settlement rule decides the winner.",
        })
      );

      const typeSelect = el("select.pu-select", { "aria-label": "Entity type" });
      for (const type of hub.registry.entityTypes) typeSelect.appendChild(el("option", { value: type.id, text: type.plural }));
      const entitySelect = el("select.pu-select", { "aria-label": "Entity" });
      const fieldSelect = el("select.pu-select", { "aria-label": "Field" });
      const valueInput = el("input.pu-input", { type: "text", placeholder: "Value to write", "aria-label": "Value" });
      const ownerHint = el("p.pu-small.pu-muted");

      function syncEntities() {
        mount(entitySelect);
        for (const option of entityOptions(hub, typeSelect.value)) entitySelect.appendChild(el("option", { value: option.id, text: option.name }));
        syncFields();
      }

      function syncFields() {
        mount(fieldSelect);
        for (const field of hub.registry.fieldsFor(typeSelect.value)) {
          fieldSelect.appendChild(el("option", { value: field.key, text: `${field.label || field.key} · owned by ${field.owner || "nobody"}` }));
        }
        syncHint();
      }

      function syncHint() {
        const field = hub.registry.field(typeSelect.value, fieldSelect.value);
        const connectors = hub.registry.connectors.map((connector) => connector.id);
        const writer = connectors.find((id) => id !== (field?.owner || "") && id !== "iu") || "iu";
        ownerHint.textContent = field
          ? `${field.label || field.key} is owned by ${field.owner || "nobody"} (${DIRECTION_LABEL[field.direction] || field.direction}). The write will be attributed to ${writer}.`
          : "";
      }

      typeSelect.addEventListener("change", syncEntities);
      fieldSelect.addEventListener("change", syncHint);
      syncEntities();

      const row = el("div.pu-form-row", { style: { "margin-top": "0.75rem" } });
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Entity type" }), typeSelect));
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Entity" }), entitySelect));
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Field" }), fieldSelect));
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Competing value" }), valueInput));
      card.appendChild(row);
      card.appendChild(ownerHint);

      const writeBtn = el("button.pu-btn", { type: "button", text: "Write from another tool", style: { "margin-top": "0.75rem" } });
      writeBtn.addEventListener("click", async () => {
        const value = valueInput.value.trim();
        if (!value) {
          toast("Enter a value to write", { tone: "error" });
          return;
        }
        writeBtn.disabled = true;
        try {
          const result = await hub.conflicts.simulate({ entityType: typeSelect.value, entityId: entitySelect.value, field: fieldSelect.value, value });
          if (!result.ok) {
            toast(result.error, { tone: "error" });
            return;
          }
          if (result.decision) toast(`Conflict opened for ${result.decision.label} — ${result.decision.rule}`, { tone: "error" });
          else toast("Value written — no conflict opened for this field", { tone: "success" });
          valueInput.value = "";
          rerender();
        } finally {
          writeBtn.disabled = false;
        }
      });
      card.appendChild(writeBtn);
      mount(simCtn, card);
    }

    async function resolveDecision(decision) {
      const result = await hub.conflicts.resolve(decision);
      if (result.reused) toast(`${decision.label} was already settled — reused the recorded decision`, { tone: "info" });
      else toast(`Settled ${decision.label} with ${decision.rule}`, { tone: "success" });
      rerender();
    }

    function buildOpen() {
      const decisions = hub.conflicts.plan();
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Open conflicts" }));
      head.appendChild(el("span.pu-chip", { class: decisions.length ? "fail" : "ok", text: String(decisions.length) }));
      card.appendChild(head);
      card.appendChild(el("p.pu-small", { text: "Each row shows what the hub holds beside what the owner reports, the rule that applies, and the value that will win." }));

      if (decisions.length) {
        const resolveAllBtn = el("button.pu-btn.secondary", { type: "button", text: "Resolve all automatic", style: { "margin-top": "0.6rem" } });
        resolveAllBtn.addEventListener("click", async () => {
          resolveAllBtn.disabled = true;
          try {
            const summary = await hub.conflicts.resolveAll();
            toast(`Resolved ${summary.resolved} conflict${summary.resolved === 1 ? "" : "s"}${summary.skipped ? `, ${summary.skipped} need review` : ""}`, { tone: "success" });
            rerender();
          } finally {
            resolveAllBtn.disabled = false;
          }
        });
        card.appendChild(resolveAllBtn);
      }

      if (!decisions.length) {
        card.appendChild(el("div.pu-empty", { text: "No conflicts open. Simulate a competing write above to see the resolver at work." }));
        mount(openCtn, card);
        return;
      }

      const list = el("div", { style: { "margin-top": "0.75rem" } });
      for (const decision of decisions) {
        const row = el("div.pu-test-row");
        row.appendChild(el("span.pu-chip", { class: decision.auto ? "warn" : "", text: decision.auto ? "auto" : "review" }));
        const body = el("div.pu-test-name");
        body.appendChild(el("div", {}, el("strong", { text: decision.entityName }), el("span.pu-muted", { text: " · " }), el("span.pu-small", { text: decision.label })));
        body.appendChild(el("div.pu-small.pu-muted", { text: `hub holds “${decision.held}” · ${decision.ownerName || "owner"} reports “${decision.ownerHeld}”` }));
        body.appendChild(el("div.pu-small.pu-muted", { text: decision.reason }));
        row.appendChild(body);
        row.appendChild(el("span.pu-chip", { text: decision.rule }));
        row.appendChild(el("span.pu-chip", { class: winnerClass(decision.winner), text: `winner: ${decision.winner}` }));
        const resolveBtn = el("button.pu-btn.secondary", { type: "button", text: `Adopt “${decision.value}”` });
        resolveBtn.addEventListener("click", () => {
          resolveBtn.disabled = true;
          resolveDecision(decision);
        });
        row.appendChild(resolveBtn);
        list.appendChild(row);
      }
      card.appendChild(list);
      mount(openCtn, card);
    }

    function buildHistory() {
      const history = hub.conflicts.history();
      mount(historyCtn);
      if (!history.length) return;
      const card = el("section.pu-card");
      const details = el("details.pu-details", { open: false });
      const summary = el("summary");
      summary.appendChild(el("span.pu-entity-name", { text: "Settlement history" }));
      summary.appendChild(el("span.pu-chip", { text: `${history.length} resolutions` }));
      details.appendChild(summary);
      const body = el("div.pu-details-body");
      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["When", "Entity", "Field", "Rule", "Winner", "Value"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const record of history) {
        const tr = el("tr");
        tr.appendChild(el("td", { text: timeOf(record.at) }));
        tr.appendChild(el("td", {}, el("span", { text: record.entityName }), el("span.pu-mono.pu-muted", { text: ` ${record.entityType}:${record.entityId}` })));
        tr.appendChild(el("td", { text: record.label }));
        tr.appendChild(el("td", {}, el("span.pu-chip", { text: record.rule })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { class: winnerClass(record.winner), text: record.winner })));
        tr.appendChild(el("td", { text: record.value == null ? "—" : String(record.value) }));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      body.appendChild(wrap);
      details.appendChild(body);
      card.appendChild(details);
      historyCtn.appendChild(card);
    }

    function rerender() {
      renderStats();
      buildRules();
      buildSimulator();
      buildOpen();
      buildHistory();
    }

    root.appendChild(
      pageHead({
        eyebrow: "Integrity",
        title: "Conflict resolution",
        subtitle: "When two tools disagree about the same field, the registry decides. Ownership, sync direction and computation determine the winner — the hub never guesses and never silently lets the last writer take all.",
      })
    );
    root.appendChild(statsCtn);
    root.appendChild(rulesCtn);
    root.appendChild(simCtn);
    root.appendChild(openCtn);
    root.appendChild(historyCtn);

    rerender();
    return root;
  },
};

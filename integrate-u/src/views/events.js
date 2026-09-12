import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { EVENT_TYPES, EVENT_CATEGORIES, TOPICS } from "../core/event-catalog.js";
import { samplePayload, describePayload } from "../core/event-schema.js";

const STREAM_LIMIT = 60;

function timeOf(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function confirmButton(button, label, action) {
  let armed = false;
  let timer = null;
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = "Click again to confirm";
      timer = setTimeout(() => {
        armed = false;
        button.textContent = label;
      }, 3200);
      return;
    }
    clearTimeout(timer);
    button.disabled = true;
    await action();
    button.disabled = false;
    button.textContent = label;
    armed = false;
  });
  return button;
}

export const eventsView = {
  id: "events",
  title: "Event bus",
  group: "Messaging",
  icon: "events",
  nav: true,
  render({ hub, onDestroy }) {
    const root = el("div");
    const state = { topic: "all", query: "", expanded: new Set() };
    let refreshStreamRows = () => {};
    let refreshSubscriptions = () => {};

    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });

    function statCard(label, value, hint) {
      const card = el("article.pu-card.pu-stat");
      card.appendChild(el("span.pu-stat-label", { text: label }));
      card.appendChild(el("span.pu-stat-value", { text: String(value) }));
      if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
      return card;
    }

    function renderStats() {
      const b = hub.bus.stats();
      const l = hub.log.stats();
      const s = hub.subscriptions.stats();
      mount(
        statsCtn,
        statCard("Events logged", l.size, `seq ${l.lastSeq} · ${l.dropped} pruned`),
        statCard("Published", b.published, b.rejected ? `${b.rejected} rejected` : "all valid"),
        statCard("Subscribers", s.subscriptions, `${s.connectors} connectors listening`),
        statCard("Deliveries", b.deliveryCount, b.failureCount ? `${b.failureCount} failed` : "no handler errors")
      );
    }

    function buildPublishCard() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Publish an event" }));
      card.appendChild(el("p.pu-small", { text: "Compose an envelope and hand it to the bus. Invalid payloads are rejected before any subscriber sees them." }));

      const form = el("div.pu-form-grid", { style: { "margin-top": "0.75rem" } });

      const typeSelect = el("select.pu-select", { "aria-label": "Event type" });
      for (const category of EVENT_CATEGORIES) {
        const group = el("optgroup", { label: category });
        for (const entry of EVENT_TYPES.filter((t) => t.category === category)) {
          group.appendChild(el("option", { value: entry.type, text: entry.type }));
        }
        typeSelect.appendChild(group);
      }
      typeSelect.value = "ticket.opened";

      const sourceSelect = el("select.pu-select", { "aria-label": "Source connector" });
      for (const connector of hub.registry.connectors) sourceSelect.appendChild(el("option", { value: connector.id, text: connector.name }));
      sourceSelect.value = "psa-u";

      const selects = el("div.pu-form-row");
      selects.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Event type" }), typeSelect));
      selects.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Source connector" }), sourceSelect));
      form.appendChild(selects);

      const payloadArea = el("textarea.pu-input.pu-textarea", { rows: 8, spellcheck: "false", "aria-label": "Event payload (JSON)" });
      const schemaHint = el("p.pu-small.pu-muted");
      form.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Payload (JSON)" }), payloadArea));
      form.appendChild(schemaHint);

      function describe(type) {
        const fields = describePayload(type);
        const required = fields.filter((f) => f.required).map((f) => f.key);
        const optional = fields.filter((f) => !f.required).map((f) => f.key);
        const bits = [];
        if (required.length) bits.push(`required: ${required.join(", ")}`);
        if (optional.length) bits.push(`optional: ${optional.join(", ")}`);
        return bits.length ? bits.join(" · ") : "This event carries no payload fields.";
      }

      function syncSample() {
        payloadArea.value = JSON.stringify(samplePayload(typeSelect.value), null, 2);
        schemaHint.textContent = describe(typeSelect.value);
      }
      typeSelect.addEventListener("change", syncSample);
      syncSample();

      const actions = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap" } });
      const publishBtn = el("button.pu-btn", { type: "button", text: "Publish" });
      const sampleBtn = el("button.pu-btn.secondary", { type: "button", text: "Reset to sample" });
      sampleBtn.addEventListener("click", syncSample);
      actions.appendChild(publishBtn);
      actions.appendChild(sampleBtn);
      form.appendChild(actions);
      card.appendChild(form);

      const feedback = el("div", { style: { "margin-top": "0.75rem" } });
      card.appendChild(feedback);

      publishBtn.addEventListener("click", async () => {
        let payload;
        try {
          payload = payloadArea.value.trim() ? JSON.parse(payloadArea.value) : {};
        } catch (error) {
          mount(feedback, el("div.pu-alert.fail", { text: `Payload is not valid JSON: ${error.message}` }));
          return;
        }
        publishBtn.disabled = true;
        publishBtn.textContent = "Publishing…";
        try {
          const result = await hub.publish(typeSelect.value, payload, { source: sourceSelect.value });
          if (!result.ok) {
            const alert = el("div.pu-alert.fail");
            alert.appendChild(el("strong", { text: "Rejected — nothing was delivered." }));
            const list = el("ul", { style: { margin: "0.35rem 0 0", "padding-left": "1.1rem" } });
            for (const issue of result.issues) list.appendChild(el("li.pu-small", { text: `${issue.path || "envelope"}: ${issue.message}` }));
            alert.appendChild(list);
            mount(feedback, alert);
            return;
          }
          const deliveries = result.deliveries.filter((d) => d.ok).length;
          mount(feedback, el("div.pu-alert.ok", { text: `Published ${result.event.id} to ${deliveries} subscriber${deliveries === 1 ? "" : "s"}.` }));
          toast(`Published ${result.event.type}`, { tone: "success" });
        } finally {
          publishBtn.disabled = false;
          publishBtn.textContent = "Publish";
        }
      });

      return card;
    }

    function buildSubscriptionCard() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Subscriptions" }));
      card.appendChild(el("p.pu-small", { text: "Each tool declares the topics it cares about. The manager registers, persists and delivers them; every registration is itself an event." }));

      const form = el("div.pu-form-grid", { style: { "margin-top": "0.75rem" } });
      const connectorSelect = el("select.pu-select", { "aria-label": "Subscribing connector" });
      for (const connector of hub.registry.connectors) connectorSelect.appendChild(el("option", { value: connector.id, text: connector.name }));
      const topicOptions = ["*", ...TOPICS.map((t) => `${t}.*`), ...EVENT_TYPES.map((t) => t.type)];
      const topicSelect = el("select.pu-select", { "aria-label": "Topic" });
      for (const topic of topicOptions) topicSelect.appendChild(el("option", { value: topic, text: topic }));
      const labelInput = el("input.pu-input", { type: "text", placeholder: "Why does this tool care? (optional)", "aria-label": "Subscription note" });

      const row = el("div.pu-form-row");
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Connector" }), connectorSelect));
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Topic" }), topicSelect));
      form.appendChild(row);
      form.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Note" }), labelInput));

      const registerBtn = el("button.pu-btn", { type: "button", text: "Register subscription" });
      form.appendChild(el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap" } }, registerBtn));
      card.appendChild(form);

      const feedback = el("div", { style: { "margin-top": "0.6rem" } });
      card.appendChild(feedback);

      registerBtn.addEventListener("click", async () => {
        registerBtn.disabled = true;
        try {
          const result = await hub.subscriptions.register({ connector: connectorSelect.value, topic: topicSelect.value, label: labelInput.value.trim() });
          if (!result.ok) {
            mount(feedback, el("div.pu-alert.fail", { text: result.issues.map((i) => i.message).join(" ") }));
            return;
          }
          labelInput.value = "";
          mount(feedback, el("div.pu-alert.ok", { text: `Registered ${result.record.connector} → ${result.record.topic}.` }));
          toast("Subscription registered", { tone: "success" });
          renderList();
        } finally {
          registerBtn.disabled = false;
        }
      });

      const listCtn = el("div", { style: { "margin-top": "0.75rem" } });
      card.appendChild(listCtn);
      const deliveryCtn = el("div", { style: { "margin-top": "0.75rem" } });
      card.appendChild(deliveryCtn);

      function renderList() {
        mount(listCtn);
        const records = hub.subscriptions.list();
        const wrap = el("div.pu-table-scroll");
        const table = el("table.pu-table");
        const thead = el("thead");
        const headRow = el("tr");
        for (const label of ["Connector", "Topic", "Note", "Delivered", "Last seq", ""]) headRow.appendChild(el("th", { text: label }));
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = el("tbody");
        for (const record of records) {
          const tr = el("tr");
          tr.appendChild(el("td", {}, el("span.pu-ref", { text: record.connector })));
          tr.appendChild(el("td", {}, el("span.pu-mono", { text: record.topic })));
          tr.appendChild(el("td", { text: record.label || "—" }));
          tr.appendChild(el("td", { text: String(record.delivered || 0) }));
          tr.appendChild(el("td", { text: record.lastSeq == null ? "—" : String(record.lastSeq) }));
          const actionCell = el("td");
          const removeBtn = el("button.pu-btn.secondary", { type: "button", text: "Remove" });
          removeBtn.addEventListener("click", async () => {
            removeBtn.disabled = true;
            await hub.subscriptions.unregister(record.id);
            toast("Subscription removed", { tone: "info" });
            renderList();
          });
          actionCell.appendChild(removeBtn);
          tr.appendChild(actionCell);
          tbody.appendChild(tr);
        }
        if (!records.length) {
          const tr = el("tr");
          tr.appendChild(el("td", { colspan: 6, text: "No subscriptions registered." }));
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        listCtn.appendChild(wrap);
      }

      function renderDeliveries() {
        mount(deliveryCtn);
        const deliveries = hub.subscriptions.recentDeliveries(6);
        if (!deliveries.length) return;
        deliveryCtn.appendChild(el("h3", { text: "Recent deliveries" }));
        const list = el("ul.pu-list", { style: { "margin-top": "0.5rem" } });
        for (const d of deliveries) {
          const li = el("li");
          li.appendChild(el("span.pu-mono.pu-id", { text: `#${d.seq}` }));
          li.appendChild(el("span.pu-ref", { text: d.connector }));
          li.appendChild(el("span.pu-small", { text: d.type }));
          li.appendChild(el("span.pu-small.pu-muted", { text: timeOf(d.at) }));
          list.appendChild(li);
        }
        deliveryCtn.appendChild(list);
      }

      renderList();
      renderDeliveries();
      refreshSubscriptions = () => {
        renderList();
        renderDeliveries();
      };
      return card;
    }

    function buildStreamCard() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Event stream" }));
      const countChip = el("span.pu-chip");
      const rejectChip = el("span.pu-chip.fail");
      head.appendChild(countChip);
      head.appendChild(rejectChip);
      card.appendChild(head);
      card.appendChild(el("p.pu-small", { text: "Newest first. Every envelope carries its type, version, source and a monotonic sequence number so consumers can order and replay them." }));

      const toolbar = el("div.pu-toolbar", { style: { "margin-top": "0.75rem" } });
      const topicSelect = el("select.pu-select", { "aria-label": "Filter by topic" });
      topicSelect.appendChild(el("option", { value: "all", text: "All topics" }));
      for (const topic of TOPICS) topicSelect.appendChild(el("option", { value: topic, text: topic }));
      topicSelect.value = state.topic;
      topicSelect.addEventListener("change", () => {
        state.topic = topicSelect.value;
        renderRows();
      });
      const search = el("input.pu-input", {
        type: "search",
        placeholder: "Filter by type, source or subject…",
        "aria-label": "Filter events",
        value: state.query,
        on: {
          input: (event) => {
            state.query = event.target.value;
            renderRows();
          },
        },
      });
      const clearBtn = confirmButton(el("button.pu-btn.secondary", { type: "button", text: "Clear log" }), "Clear log", async () => {
        await hub.log.clear();
        hub.bus.resetStats();
        state.expanded.clear();
        renderStats();
        renderRows();
        refreshSubscriptions();
        toast("Event log cleared", { tone: "success" });
      });
      toolbar.appendChild(topicSelect);
      toolbar.appendChild(search);
      toolbar.appendChild(clearBtn);
      card.appendChild(toolbar);

      const rowsCtn = el("div", { style: { "margin-top": "0.6rem" } });
      card.appendChild(rowsCtn);

      function matches(event) {
        if (state.topic !== "all" && !String(event.type).startsWith(`${state.topic}.`)) return false;
        const q = state.query.trim().toLowerCase();
        if (!q) return true;
        return [event.type, event.source, event.subject?.entityId, event.subject?.entityType]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      }

      function renderRows() {
        const stats = hub.bus.stats();
        countChip.textContent = `${hub.log.size()} logged`;
        rejectChip.hidden = !stats.rejected;
        rejectChip.textContent = `${stats.rejected} rejected`;
        mount(rowsCtn);
        const events = hub.log
          .recent(STREAM_LIMIT * 4)
          .filter(matches)
          .slice(-STREAM_LIMIT)
          .reverse();
        if (!events.length) {
          rowsCtn.appendChild(
            el("div.pu-empty", {
              text: hub.log.size() ? "No events match the current filter." : "No events yet — publish one, or re-run the demo import from the Canonical identity screen.",
            })
          );
          return;
        }
        for (const event of events) {
          const details = el("details.pu-details", state.expanded.has(event.seq) ? { open: true } : {});
          const summary = el("summary");
          summary.appendChild(el("span.pu-mono.pu-id", { text: `#${event.seq}` }));
          summary.appendChild(el("span.pu-mono.pu-event-type", { text: event.type }));
          summary.appendChild(el("span.pu-chip", { text: event.source }));
          if (event.subject?.entityId) summary.appendChild(el("span.pu-ref", { text: `${event.subject.entityType}:${event.subject.entityId}` }));
          const deliveries = hub.bus.subscribersOf(event.type).length;
          summary.appendChild(el("span.pu-small.pu-muted", { text: `${timeOf(event.time)} · ${deliveries} subscriber${deliveries === 1 ? "" : "s"}` }));
          details.appendChild(summary);
          details.addEventListener("toggle", () => {
            if (details.open) state.expanded.add(event.seq);
            else state.expanded.delete(event.seq);
          });
          const body = el("div.pu-details-body");
          body.appendChild(el("pre.pu-code", { text: JSON.stringify(event, null, 2) }));
          body.appendChild(
            el("p.pu-small.pu-muted", {
              text: `version ${event.version}${event.correlationId ? ` · correlation ${event.correlationId}` : ""}${event.causationId ? ` · caused by ${event.causationId}` : ""}`,
            })
          );
          details.appendChild(body);
          rowsCtn.appendChild(details);
        }
      }

      refreshStreamRows = renderRows;
      renderRows();
      return card;
    }

    let scheduled = null;
    function scheduleRefresh() {
      if (scheduled) return;
      scheduled = setTimeout(() => {
        scheduled = null;
        renderStats();
        refreshStreamRows();
        refreshSubscriptions();
      }, 140);
    }

    root.appendChild(
      pageHead({
        eyebrow: "Messaging",
        title: "Event bus",
        subtitle: "Every tool talks through versioned event envelopes. The bus validates each payload against its schema, delivers it to matching subscribers, and keeps a short-term log for replay and recovery.",
      })
    );
    root.appendChild(statsCtn);
    root.appendChild(buildPublishCard());
    root.appendChild(buildStreamCard());
    root.appendChild(buildSubscriptionCard());

    const subscription = hub.bus.subscribe("*", () => scheduleRefresh(), { label: "Event screen live view", priority: -10 });

    renderStats();

    if (typeof onDestroy === "function") {
      onDestroy(() => {
        subscription.unsubscribe();
        if (scheduled) clearTimeout(scheduled);
      });
    }

    return root;
  },
};

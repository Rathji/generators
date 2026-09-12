import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";

const EXAMPLES = ["northwind", "blue harbor", "T-10471", "IWM-SRV-02", "grace@cedarparksvets.com"];

function secondaryFor(typeId, fields) {
  if (typeId === "company") return fields.domain || fields.city || "";
  if (typeId === "customer") return fields.email || fields.company || "";
  if (typeId === "device") return [fields.serial, fields.os].filter(Boolean).join(" · ");
  if (typeId === "ticket") return [fields.status, fields.priority].filter(Boolean).join(" · ");
  if (typeId === "invoice") return fields.amount != null ? `${fields.status || ""} · ${fields.amount}` : fields.status || "";
  return "";
}

export const searchView = {
  id: "search",
  title: "Cross-tool search",
  group: "Linking",
  icon: "search",
  nav: true,
  render({ hub }) {
    const root = el("div");
    const state = { q: "", type: "", connector: "", only: "" };
    const summaryCtn = el("p.pu-small.pu-muted", { style: { "margin-top": "0.4rem" } });
    const resultsCtn = el("div", { style: { "margin-top": "0.75rem" } });

    const input = el("input.pu-input", {
      type: "search",
      placeholder: "Search every connector by name, ID, reference or field value…",
      "aria-label": "Search the directory",
      on: {
        input: (event) => {
          state.q = event.target.value;
          renderResults();
        },
      },
    });

    const typeSelect = el("select.pu-select", { "aria-label": "Filter by entity type" });
    typeSelect.appendChild(el("option", { value: "", text: "All types" }));
    for (const type of hub.registry.entityTypes) typeSelect.appendChild(el("option", { value: type.id, text: type.plural }));
    typeSelect.addEventListener("change", () => {
      state.type = typeSelect.value;
      renderResults();
    });

    const connectorSelect = el("select.pu-select", { "aria-label": "Filter by connector" });
    connectorSelect.appendChild(el("option", { value: "", text: "All connectors" }));
    for (const connector of hub.registry.connectors) connectorSelect.appendChild(el("option", { value: connector.id, text: connector.name }));
    connectorSelect.addEventListener("change", () => {
      state.connector = connectorSelect.value;
      renderResults();
    });

    const onlySelect = el("select.pu-select", { "aria-label": "Filter by link state" });
    for (const option of [
      { value: "", label: "Any link state" },
      { value: "linked", label: "Linked only" },
      { value: "unlinked", label: "Unlinked only" },
      { value: "unresolved", label: "Unresolved only" },
    ]) {
      onlySelect.appendChild(el("option", { value: option.value, text: option.label }));
    }
    onlySelect.addEventListener("change", () => {
      state.only = onlySelect.value;
      renderResults();
    });

    const toolbar = el("div.pu-toolbar");
    toolbar.appendChild(input);
    toolbar.appendChild(typeSelect);
    toolbar.appendChild(connectorSelect);
    toolbar.appendChild(onlySelect);

    function linkSummary(item) {
      const wrap = el("span.pu-small.pu-muted");
      const outgoing = item.links.outgoing.length;
      const incoming = item.links.incoming.length;
      wrap.textContent = outgoing || incoming ? `${outgoing} out · ${incoming} in` : "no links";
      return wrap;
    }

    function resultRow(item) {
      const details = el("details.pu-details");
      const summary = el("summary");
      summary.appendChild(el("span.pu-mono.pu-id", { text: item.id }));
      summary.appendChild(el("span.pu-entity-name", { text: item.name }));
      const secondary = secondaryFor(item.typeId, item.fields);
      if (secondary) summary.appendChild(el("span.pu-small.pu-muted", { text: secondary }));
      summary.appendChild(el("span.pu-chip", { text: `score ${item.score}` }));
      if (item.unresolved) summary.appendChild(el("span.pu-chip.fail", { text: "unresolved" }));
      for (const name of item.connectorNames) summary.appendChild(el("span.pu-ref", { text: name }));
      summary.appendChild(linkSummary(item));
      details.appendChild(summary);

      const body = el("div.pu-details-body");
      const matches = el("p.pu-small", { text: `Matched ${item.matches.map((m) => `${m.how} ${m.kind} “${m.value}”`).join(", ")}.` });
      body.appendChild(matches);

      const refs = el("div.pu-refs", { style: { "margin-left": "0" } });
      for (const ref of item.refs) refs.appendChild(el("span.pu-ref", { text: `${ref.connector}:${ref.nativeId}` }));
      body.appendChild(refs);

      const table = el("table.pu-table");
      const tbody = el("tbody");
      for (const [key, value] of Object.entries(item.fields)) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("span.pu-small.pu-muted", { text: key })));
        tr.appendChild(el("td", { text: String(value) }));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      const wrap = el("div.pu-table-scroll");
      wrap.appendChild(table);
      body.appendChild(wrap);

      if (item.links.outgoing.length) {
        body.appendChild(el("h3", { style: { "margin-top": "0.5rem" }, text: "Outgoing links" }));
        const list = el("ul.pu-list");
        for (const edge of item.links.outgoing) list.appendChild(el("li", {}, el("span.pu-chip", { text: edge.label }), el("span.pu-small", { text: `${edge.toName} (${edge.toType}:${edge.toId})` })));
        body.appendChild(list);
      }
      if (item.links.incoming.length) {
        body.appendChild(el("h3", { style: { "margin-top": "0.5rem" }, text: "Incoming links" }));
        const list = el("ul.pu-list");
        for (const edge of item.links.incoming) list.appendChild(el("li", {}, el("span.pu-chip", { text: edge.inverseLabel || "Referenced by" }), el("span.pu-small", { text: `${edge.fromName} (${edge.fromType}:${edge.fromId})` })));
        body.appendChild(list);
      }
      details.appendChild(body);
      return details;
    }

    function renderEmpty() {
      mount(resultsCtn);
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Search the whole family" }));
      card.appendChild(el("p.pu-small", { text: "One query reaches every connector at once. Try one of these:" }));
      const chips = el("div", { style: { display: "flex", gap: "0.4rem", "flex-wrap": "wrap", "margin-top": "0.6rem" } });
      for (const example of EXAMPLES) {
        const chip = el("button.pu-chip", { type: "button", text: example, style: { cursor: "pointer" } });
        chip.addEventListener("click", () => {
          input.value = example;
          state.q = example;
          renderResults();
        });
        chips.appendChild(chip);
      }
      card.appendChild(chips);
      resultsCtn.appendChild(card);
    }

    function renderResults() {
      const query = state.q.trim();
      if (!query) {
        summaryCtn.textContent = "";
        renderEmpty();
        return;
      }
      const result = hub.search.query(query, { type: state.type || null, connector: state.connector || null, only: state.only || null });
      summaryCtn.textContent = `${result.total} record${result.total === 1 ? "" : "s"} across ${result.stats.types} type${result.stats.types === 1 ? "" : "s"} and ${result.stats.connectors} connector${result.stats.connectors === 1 ? "" : "s"}${result.stats.unresolved ? ` · ${result.stats.unresolved} unresolved` : ""}.`;
      mount(resultsCtn);
      if (!result.groups.length) {
        resultsCtn.appendChild(el("div.pu-empty", { text: `Nothing matches “${query}”.` }));
        return;
      }
      for (const group of result.groups) {
        const card = el("section.pu-card");
        card.appendChild(el("h2", { text: `${group.plural} (${group.count})` }));
        const list = el("div", { style: { "margin-top": "0.5rem" } });
        for (const item of group.results) list.appendChild(resultRow(item));
        card.appendChild(list);
        resultsCtn.appendChild(card);
      }
    }

    root.appendChild(
      pageHead({
        eyebrow: "Linking",
        title: "Cross-tool search",
        subtitle: "Look up a company, person, device, ticket or invoice and see which connectors know about it, which canonical record it resolves to, and what it links to.",
      })
    );
    root.appendChild(toolbar);
    root.appendChild(summaryCtn);
    root.appendChild(resultsCtn);

    renderResults();
    return root;
  },
};

import { registerModule, moduleShell, h, el, tabs, toast, dateFmt, numFmt } from "../core.js";
import { renderCrud, openDetail } from "../crud.js";
import store from "../store.js";
import { collectionStatusEl } from "../store-ui.js";

const TABS = [{ id: "expenses", label: "Expenses", href: "expenses" }];

function resourceOpts() { return store.getAllRecords("resources").map((r) => ({ value: r.id, label: r.name })); }
function projectOpts() { return store.getAllRecords("projects").map((p) => ({ value: p.id, label: p.name })); }
const types = ["Travel", "Lodging", "Meals", "Software", "Materials", "Subcontractor", "Other"].map((t) => ({ value: t, label: t }));
const currencies = ["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => ({ value: c, label: c }));

const expFields = [
  { key: "projectId", label: "Project", type: "select", options: projectOpts, required: true },
  { key: "taskId", label: "Task", type: "select", options: (fv) => store.getAllRecords("workplans").filter((t) => t.projectId === fv.projectId).map((t) => ({ value: t.id, label: t.name })) },
  { key: "resourceId", label: "Incurred by", type: "select", options: resourceOpts },
  { key: "type", label: "Type", type: "select", options: types, default: "Travel" },
  { key: "amount", label: "Amount", type: "money", required: true },
  { key: "currency", label: "Currency", type: "select", options: currencies, default: "USD" },
  { key: "date", label: "Date", type: "date", required: true, defaultToday: true },
  { key: "billable", label: "Billable", type: "checkbox", default: true },
  { key: "note", label: "Note", type: "text" },
  { key: "receiptRef", label: "Receipt reference", type: "text", placeholder: "Receipt # / vendor / scan reference" },
  { key: "status", label: "Status", type: "select", options: ["draft", "submitted", "approved", "posted", "rejected"].map((s) => ({ value: s, label: s })), default: "draft" },
];

const expColumns = [
  { key: "projectId", label: "Project", render: (r) => { const p = store.getRecord("projects", r.projectId); return h(p ? p.name : "—"); } },
  { key: "type", label: "Type", render: (r) => '<span class="pill">' + h(r.type) + "</span>" },
  { key: "amount", label: "Amount", render: (r) => "<strong>" + numFmt(r.amount, 2) + "</strong> " + h(r.currency || "") },
  { key: "date", label: "Date", render: (r) => h(dateFmt(r.date)) },
  { key: "billable", label: "Billable", render: (r) => r.billable ? '<span class="badge badge-ok">Billable</span>' : '<span class="badge badge-muted">Not billable</span>' },
  { key: "status", label: "Status", render: (r) => {
      const map = { draft: "muted", submitted: "warn", approved: "ok", posted: "accent", rejected: "err" };
      return '<span class="badge badge-' + (map[r.status] || "muted") + '">' + h(r.status) + (r.locked ? " · locked" : "") + "</span>";
    } },
];

function expDetailActions(rec, ctx) {
  const acts = [];
  if (rec.locked) {
    return [{ label: "Locked (posted to billing)", kind: "btn-ghost", onClick: () => {} }];
  }
  if (rec.status === "draft" || rec.status === "rejected") {
    acts.push({ label: "Submit", icon: "arrow", kind: "btn-primary", onClick: async () => {
        await store.saveRecord("expenses", Object.assign({}, rec, { status: "submitted", submittedAt: new Date().toISOString() }));
        toast("Expense submitted"); ctx.refresh();
      } });
  }
  if (rec.status === "submitted") {
    acts.push({ label: "Approve", icon: "check", kind: "btn-primary", onClick: async () => {
        await store.saveRecord("expenses", Object.assign({}, rec, { status: "approved", approvedAt: new Date().toISOString(), approvedBy: "local" }));
        toast("Expense approved"); ctx.refresh();
      } });
  }
  if (rec.status === "approved") {
    acts.push({ label: "Post to billing (locks)", icon: "billing", kind: "btn-primary", onClick: async () => {
        await store.saveRecord("expenses", Object.assign({}, rec, { status: "posted", locked: true, postedAt: new Date().toISOString() }));
        toast("Posted to billing — expense locked for audit"); ctx.refresh();
      } });
  }
  return acts;
}

function expDerive(rec) {
  if (!rec.receiptData) return null;
  return { html: '<div class="receipt-preview"><img src="' + rec.receiptData + '" alt="Receipt"><p class="dim">Receipt attached' + (rec.receiptRef ? " · " + h(rec.receiptRef) : "") + "</p></div>" };
}

registerModule({
  id: "expenses",
  label: "Expenses",
  icon: "expenses",
  async render({ view }) {
    const sec = moduleShell("expenses");
    sec.appendChild(tabs("expenses", TABS));
    await renderCrud(sec, {
      collection: "expenses",
      moduleId: "expenses",
      title: "Expenses",
      subtitle: "Project and client expenses — captured, approved, then locked for the audit trail once posted to billing.",
      singular: "Expense",
      newLabel: "Add expense",
      columns: expColumns,
      fields: expFields,
      searchKeys: ["note", "type", "receiptRef"],
      sortBy: (a, b) => (b.date || "").localeCompare(a.date || ""),
      detailActions: expDetailActions,
      derive: expDerive,
      canDelete: (rec) => !rec.locked,
      deleteBlocked: "This expense is locked because it was posted to billing. Create a credit note to reverse it.",
      afterOpen: (form) => {
        const row = el("div", "psa-field");
        row.appendChild(el("label", "psa-field-label", "Attach receipt (image, ≤ 150 KB)"));
        const inp = el("input", "psa-input", "");
        inp.type = "file";
        inp.accept = "image/*";
        inp.addEventListener("change", () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => {
            const data = String(reader.result);
            if (data.length > 200000) { toast("Receipt image too large — please keep it under ~150 KB", "err"); return; }
            const storeEl = form.querySelector('[data-field="receiptData"]');
            if (storeEl) storeEl.value = data;
            else {
              const hidden = document.createElement("input");
              hidden.type = "hidden";
              hidden.dataset.field = "receiptData";
              hidden.value = data;
              form.appendChild(hidden);
            }
            toast("Receipt attached");
          };
          reader.readAsDataURL(f);
        });
        row.appendChild(inp);
        form.appendChild(row);
      },
      onBeforeSave: (v, rec) => {
        if (!v.receiptData && rec && rec.receiptData) v.receiptData = rec.receiptData;
      },
      emptyState: { title: "No expenses yet", message: "Capture expenses with type, amount, currency and an optional receipt — they'll roll into project actuals and invoicing.", action: { label: "Add expense" } },
    });
    sec.appendChild(await collectionStatusEl("expenses"));
    view.appendChild(sec);
  }
});

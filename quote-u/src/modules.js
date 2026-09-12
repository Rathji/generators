window.QU_MODULES = [
  {
    id: "quotes",
    label: "Quotes",
    tagline: "Every quote, its versions and where each one stands",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
    empty: {
      title: "No quotes yet",
      message: "Quotes you create will appear here with their number, account, current version and lifecycle state — draft through approved."
    }
  },
  {
    id: "builder",
    label: "Quote Builder",
    tagline: "Lines, option groups, pricing and live totals",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>',
    empty: {
      title: "Nothing open in the builder",
      message: "Open a quote to edit its one-time and recurring lines, arrange option groups, capture price snapshots and watch totals update live."
    }
  },
  {
    id: "catalog",
    label: "Catalog",
    tagline: "Products, services and default markup",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
    empty: {
      title: "The catalog is empty",
      message: "The products and services you quote from — SKU, manufacturer part number, description, default markup and kind — live here."
    }
  },
  {
    id: "portal",
    label: "Portal",
    tagline: "Tokenized client approval links",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    empty: {
      title: "No portal links yet",
      message: "When you send a quote, its tokenized client link appears here with its expiry, revocation state and what the client has seen or changed."
    }
  },
  {
    id: "approvals",
    label: "Approvals",
    tagline: "Decisions, signed acceptances and the orchestrator",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
    empty: {
      title: "No decisions recorded",
      message: "Client approvals and declines land here, each with the frozen totals recomputed server-side and the acceptance record."
    }
  },
  {
    id: "invoicing",
    label: "Invoicing",
    tagline: "Invoice intents, paths and finance reconciliation",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/></svg>',
    empty: {
      title: "Nothing invoiced yet",
      message: "Each approved version gets exactly one invoice intent — the hard double-billing guard — and its resulting invoice is reconciled back here."
    }
  },
  {
    id: "connectors",
    label: "Connectors",
    tagline: "The gateway to pricing, PSA, accounting and the pipeline bus",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z"/><path d="M12 17v5"/></svg>',
    empty: {
      title: "No connectors configured",
      message: "Every cross-system call flows through the gateway. Distributor pricing, the PSA, accounting and the pipeline bus are configured here — and every write is gated and audited."
    }
  },
  {
    id: "reports",
    label: "Reports",
    tagline: "Volume, win/loss, margin and cycle time",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-4"/><path d="M3 20h18"/></svg>',
    empty: {
      title: "No reports yet",
      message: "Quote volume, win/loss rate, average margin and cycle time from sent to decided will be reported here, filterable by rep, company and period."
    }
  },
  {
    id: "admin",
    label: "Admin",
    tagline: "Flags, data mode, mappings and the audit log",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    empty: {
      title: "Admin only",
      message: "Operational flags, the data mode, company and product mappings, numbering and the append-only event log are managed here."
    }
  }
];

window.CRM_MODULES = [
  {
    id: "dashboard",
    label: "Dashboard",
    tagline: "Command center for your pipeline and team",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'
  },
  {
    id: "companies",
    label: "Companies",
    tagline: "Accounts, industries and relationships",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14"/><path d="M13 11h4a2 2 0 0 1 2 2v8"/><path d="M9 7v.01"/><path d="M9 11v.01"/><path d="M9 15v.01"/></svg>',
    empty: {
      title: "No companies yet",
      message: "Companies you add will appear here with their contacts, deals and a full activity timeline."
    }
  },
  {
    id: "contacts",
    label: "Contacts",
    tagline: "The people you do business with",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    empty: {
      title: "No contacts yet",
      message: "Contacts you add — linked to a company or standalone — will live here with every interaction recorded."
    }
  },
  {
    id: "leads",
    label: "Leads",
    tagline: "Incoming opportunities to qualify",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    empty: {
      title: "No leads yet",
      message: "New business that reaches you — by hand or from the idea-incubator — flows through here from first contact to qualification."
    }
  },
  {
    id: "deals",
    label: "Deals",
    tagline: "Your sales pipeline, stage by stage",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    empty: {
      title: "No deals yet",
      message: "Won opportunities are tracked here on a configurable pipeline, with expected value, close dates and weighted forecasts."
    }
  },
  {
    id: "activities",
    label: "Activities",
    tagline: "Calls, emails, meetings and follow-ups",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    empty: {
      title: "No activities yet",
      message: "Every call, email, meeting, note and task — plus the timeline of each company, contact and deal — is recorded here."
    }
  },
  {
    id: "reports",
    label: "Reports",
    tagline: "Saved views, exports and forecasts",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-4"/><path d="M3 20h18"/></svg>',
    empty: {
      title: "No reports yet",
      message: "Saved report definitions, CSV exports and printable views of your pipeline and team performance will appear here."
    }
  },
  {
    id: "bus",
    label: "Integrations",
    tagline: "The shared pipeline — ideas in, projects and customers out, payments back",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 17 17 2"/><path d="M2 14 14 2"/><path d="M2 11 11 2"/><circle cx="2" cy="17" r="2"/><circle cx="17" cy="2" r="2"/><circle cx="14" cy="2" r="2"/><circle cx="11" cy="2" r="2"/><path d="M6 18 18 6"/><circle cx="18" cy="6" r="2"/><path d="M4 22h16"/></svg>',
    empty: {
      title: "Integrations not wired yet",
      message: "Connect the idea-incubator and your ledger/ERP here. Ideas flow in as qualified leads, won deals flow out as project seeds, customers flow out to billing, and receivable status flows back onto each company record."
    }
  }
];

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
    id: "services",
    label: "Services",
    tagline: "Internet, VoIP and IT services you provide",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    empty: {
      title: "No services yet",
      message: "The recurring things you provide — internet circuits, VoIP seats, SIP trunks, managed IT and hardware — live here with their charge, term and renewal date, and roll up into MRR on the dashboard."
    }
  },
  {
    id: "sites",
    label: "Sites",
    tagline: "Locations you serve — offices, data centres, towers",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    empty: {
      title: "No sites yet",
      message: "Add the places you serve — head office, branch, data centre, tower, cabinet or customer premises — and link the services, assets and tickets that live there."
    }
  },
  {
    id: "map",
    label: "Map",
    tagline: "Every site and service location on one map",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    empty: {
      title: "Nothing to map yet",
      message: "Add sites with addresses, then locate them on the map yourself or automatically. Pins show the services, assets and tickets at each place."
    }
  },
  {
    id: "assets",
    label: "Assets",
    tagline: "DIDs, IP blocks, circuits, CPE, SIMs and licences",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
    empty: {
      title: "No assets yet",
      message: "Track the numbers, IP blocks, circuits, equipment, SIMs and licences you provide or manage — what you own, who has it and where it sits."
    }
  },
  {
    id: "tickets",
    label: "Tickets",
    tagline: "Service desk with priority-based SLAs",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 5v2"/><path d="M13 11v2"/><path d="M13 17v2"/></svg>',
    empty: {
      title: "No tickets yet",
      message: "Log incidents, service requests, changes and maintenance as they arrive. Each ticket gets a priority-based SLA clock, an assignee and a running journal."
    }
  },
  {
    id: "documents",
    label: "Documents",
    tagline: "Contracts, SLAs, licences and attachments",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>',
    empty: {
      title: "No documents yet",
      message: "File contracts, SLAs, quotes, licences and invoices against the accounts, services, sites and assets they belong to, with renewal dates and an attachment."
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

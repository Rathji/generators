const COMPANIES = [
  {
    ref: "northwind",
    name: "Northwind Dental Group",
    domain: "northwinddental.com",
    phone: "+1 617 555 0142",
    address: "18 Harborview Ave, Boston, MA 02110",
    city: "Boston, MA",
    taxId: "04-2231880",
    tier: "Premium",
    docs: "https://it-u.example/northwind-dental",
    assets: 14,
    openTickets: 1,
  },
  {
    ref: "alderfinch",
    name: "Alder & Finch Bookkeeping",
    domain: "alderfinch.co",
    phone: "+1 503 555 0117",
    address: "220 Alder St, Portland, OR 97204",
    city: "Portland, OR",
    taxId: "93-4410992",
    tier: "Standard",
    docs: "https://it-u.example/alder-finch",
    assets: 6,
    openTickets: 0,
  },
  {
    ref: "blueharbor",
    name: "Blue Harbor Logistics",
    domain: "blueharborlogistics.com",
    phone: "+1 206 555 0188",
    address: "4400 Terminal Way, Seattle, WA 98134",
    city: "Seattle, WA",
    taxId: "91-2208875",
    tier: "Premium",
    docs: "https://it-u.example/blue-harbor",
    assets: 22,
    openTickets: 1,
  },
  {
    ref: "cedarparks",
    name: "Cedar Park Veterinary",
    domain: "cedarparksvets.com",
    phone: "+1 512 555 0173",
    address: "77 Cedar Park Blvd, Austin, TX 78705",
    city: "Austin, TX",
    taxId: "74-3310876",
    tier: "Essential",
    docs: "https://it-u.example/cedar-park",
    assets: 5,
    openTickets: 0,
  },
  {
    ref: "ironwood",
    name: "Ironwood Manufacturing",
    domain: "ironwoodmfg.com",
    phone: "+1 313 555 0164",
    address: "9 Foundry Row, Detroit, MI 48209",
    city: "Detroit, MI",
    taxId: "38-5590213",
    tier: "Standard",
    docs: "https://it-u.example/ironwood",
    assets: 18,
    openTickets: 1,
  },
  {
    ref: "marigold",
    name: "Marigold Bakery Co",
    domain: "marigoldbakery.com",
    phone: "+1 401 555 0126",
    address: "5 Wharf Lane, Providence, RI 02903",
    city: "Providence, RI",
    taxId: "05-7723019",
    tier: "Essential",
    docs: "https://it-u.example/marigold",
    assets: 4,
    openTickets: 1,
  },
];

const PEOPLE = [
  { ref: "dana", fullName: "Dana Whitfield", email: "dana@northwinddental.com", phone: "+1 617 555 0199", jobTitle: "Office Manager", company: "Northwind Dental Group", itNotes: "Primary escalation contact." },
  { ref: "marcus", fullName: "Marcus Lee", email: "marcus.lee@northwinddental.com", phone: "+1 617 555 0143", jobTitle: "IT Coordinator", company: "Northwind Dental Group", itNotes: "Onsite contact for network closet." },
  { ref: "priya", fullName: "Priya Raman", email: "priya@alderfinch.co", phone: "+1 503 555 0121", jobTitle: "Partner", company: "Alder & Finch Bookkeeping", itNotes: "Prefers email over phone." },
  { ref: "tomas", fullName: "Tomás Alvarez", email: "tomas@blueharborlogistics.com", phone: "+1 206 555 0190", jobTitle: "Operations Director", company: "Blue Harbor Logistics", itNotes: "Escalates after-hours incidents." },
  { ref: "grace", fullName: "Grace Chen", email: "grace@cedarparksvets.com", phone: "+1 512 555 0177", jobTitle: "Practice Owner", company: "Cedar Park Veterinary", itNotes: "Weekends only for maintenance windows." },
  { ref: "sam", fullName: "Sam Okafor", email: "sam@ironwoodmfg.com", phone: "+1 313 555 0166", jobTitle: "Plant Manager", company: "Ironwood Manufacturing", itNotes: "Controls plant network access." },
  { ref: "lena", fullName: "Lena Fischer", email: "lena@marigoldbakery.com", phone: "+1 401 555 0129", jobTitle: "Owner", company: "Marigold Bakery Co", itNotes: "Cash register runs on the POS box." },
  { ref: "noah", fullName: "Noah Bennett", email: "noah@blueharborlogistics.com", phone: "+1 206 555 0191", jobTitle: "Dispatch Lead", company: "Blue Harbor Logistics", itNotes: "Uses the dispatch tablet daily." },
];

const DEVICES = [
  { ref: "nwd-lt-01", hostname: "NWD-LT-01", serial: "NWD-2231", os: "Windows 11 Pro", company: "Northwind Dental Group", assignedTo: "Marcus Lee", warrantyEnd: "2027-03-14" },
  { ref: "nwd-lt-02", hostname: "NWD-LT-02", serial: "NWD-2232", os: "Windows 11 Pro", company: "Northwind Dental Group", assignedTo: "Dana Whitfield", warrantyEnd: "2027-03-14" },
  { ref: "alf-lt-04", hostname: "ALF-LT-04", serial: "ALF-8890", os: "macOS 15", company: "Alder & Finch Bookkeeping", assignedTo: "Priya Raman", warrantyEnd: "2026-11-02" },
  { ref: "bhl-srv-01", hostname: "BHL-SRV-01", serial: "BHL-4410", os: "Windows Server 2022", company: "Blue Harbor Logistics", assignedTo: "Noah Bennett", warrantyEnd: "2028-06-30" },
  { ref: "bhl-lt-12", hostname: "BHL-LT-12", serial: "BHL-4412", os: "Windows 11 Pro", company: "Blue Harbor Logistics", assignedTo: "Noah Bennett", warrantyEnd: "2026-09-18" },
  { ref: "cpv-ws-07", hostname: "CPV-WS-07", serial: "CPV-1120", os: "Windows 10 Pro", company: "Cedar Park Veterinary", assignedTo: "Grace Chen", warrantyEnd: "2026-05-22" },
  { ref: "iwm-srv-02", hostname: "IWM-SRV-02", serial: "IWM-7781", os: "Windows Server 2019", company: "Ironwood Manufacturing", assignedTo: "Sam Okafor", warrantyEnd: "2027-01-09" },
  { ref: "mgb-pos-03", hostname: "MGB-POS-03", serial: "MGB-3390", os: "Windows 10 IoT", company: "Marigold Bakery Co", assignedTo: "Lena Fischer", warrantyEnd: "2026-12-01" },
];

const TICKETS = [
  { number: "T-10432", subject: "VPN tunnel down at Northwind", company: "Northwind Dental Group", linkedDevice: "NWD-LT-01", status: "In progress", priority: "High", assignee: "A. Nolan", timeLogged: 95 },
  { number: "T-10455", subject: "New workstation provisioning", company: "Alder & Finch Bookkeeping", linkedDevice: "ALF-LT-04", status: "Closed", priority: "Normal", assignee: "J. Feld", timeLogged: 210 },
  { number: "T-10471", subject: "Server disk alert on BHL-SRV-01", company: "Blue Harbor Logistics", linkedDevice: "BHL-SRV-01", status: "Open", priority: "Critical", assignee: "A. Nolan", timeLogged: 40 },
  { number: "T-10488", subject: "Email migration planning", company: "Marigold Bakery Co", linkedDevice: "", status: "Open", priority: "Normal", assignee: "R. Diaz", timeLogged: 25 },
  { number: "T-10492", subject: "Backup verification failed", company: "Ironwood Manufacturing", linkedDevice: "IWM-SRV-02", status: "In progress", priority: "High", assignee: "J. Feld", timeLogged: 130 },
  { number: "T-10503", subject: "New hire laptop not enrolling", company: "Blue Harbor Logistics", linkedDevice: "BHL-LT-13", status: "Open", priority: "High", assignee: "R. Diaz", timeLogged: 15 },
];

const INVOICES = [
  { number: "INV-2201", company: "Northwind Dental Group", amount: 2400, status: "Paid", dueDate: "2026-08-31", balance: 0 },
  { number: "INV-2202", company: "Alder & Finch Bookkeeping", amount: 850, status: "Open", dueDate: "2026-09-30", balance: 850 },
  { number: "INV-2203", company: "Blue Harbor Logistics", amount: 5200, status: "Overdue", dueDate: "2026-07-31", balance: 5200 },
  { number: "INV-2204", company: "Ironwood Manufacturing", amount: 1300, status: "Open", dueDate: "2026-09-30", balance: 1300 },
];

export function buildDemoFeeds() {
  const companyByName = new Map(COMPANIES.map((c) => [c.name, c]));
  let crmCompanySeq = 1001;
  let psaCompanySeq = 3001;
  let itCompanySeq = 2001;
  let rmmCompanySeq = 9001;
  let crmPersonSeq = 5001;
  let psaPersonSeq = 7001;
  let itPersonSeq = 6001;
  let itDeviceSeq = 4001;
  let rmmDeviceSeq = 8001;

  const crmCompanies = COMPANIES.map((c) => ({
    nativeId: `CRM-C-${crmCompanySeq++}`,
    fields: { name: c.name, domain: c.domain, phone: c.phone, address: c.address, city: c.city, taxId: c.taxId },
  }));

  const crmCustomers = PEOPLE.map((p) => ({
    nativeId: `CRM-P-${crmPersonSeq++}`,
    fields: { fullName: p.fullName, email: p.email, phone: p.phone, jobTitle: p.jobTitle, company: p.company },
  }));

  const psaCompanies = COMPANIES.map((c) => ({
    nativeId: `PSA-C-${psaCompanySeq++}`,
    fields: { name: c.name, accountTier: c.tier, openTicketCount: c.openTickets },
  }));

  const psaCustomers = ["dana", "priya", "tomas", "grace", "sam"].map((ref) => {
    const p = PEOPLE.find((x) => x.ref === ref);
    return { nativeId: `PSA-P-${psaPersonSeq++}`, fields: { fullName: p.fullName, email: p.email, company: p.company, jobTitle: p.jobTitle } };
  });

  const psaTickets = TICKETS.map((t) => ({
    nativeId: `PSA-${t.number}`,
    fields: { number: t.number, subject: t.subject, company: t.company, linkedDevice: t.linkedDevice, status: t.status, priority: t.priority, assignee: t.assignee, timeLogged: t.timeLogged },
  }));

  const psaInvoices = INVOICES.map((i) => ({
    nativeId: `PSA-${i.number}`,
    fields: { number: i.number, company: i.company, amount: i.amount, status: i.status, dueDate: i.dueDate, balance: i.balance },
  }));

  const itCompanies = COMPANIES.slice(0, 5).map((c, index) => ({
    nativeId: `IT-C-${itCompanySeq++}`,
    fields: index === 0 ? { name: c.name, city: c.city, documentationUrl: c.docs } : { name: c.name, domain: c.domain, city: c.city, documentationUrl: c.docs },
  }));

  const itCustomers = [
    { nativeId: `IT-P-${itPersonSeq++}`, fields: { fullName: "Marcus Lee", company: "Northwind Dental Group", itNotes: "Onsite contact; badge access to server room." } },
    { nativeId: `IT-P-${itPersonSeq++}`, fields: { fullName: "Dana Whitfield", email: "dana@northwinddental.com", company: "Northwind Dental Group", itNotes: "Primary escalation contact." } },
    { nativeId: `IT-P-${itPersonSeq++}`, fields: { fullName: "Grace Chen", email: "grace@cedarparksvets.com", company: "Cedar Park Veterinary", itNotes: "Weekend maintenance windows only." } },
  ];

  const itDevices = DEVICES.slice(0, 6).map((d) => ({
    nativeId: `IT-D-${itDeviceSeq++}`,
    fields: { hostname: d.hostname, serial: d.serial, company: d.company, assignedTo: d.assignedTo, warrantyEnd: d.warrantyEnd },
  }));

  const rmmCompanies = [
    { nativeId: `RMM-C-${rmmCompanySeq++}`, fields: { name: "Northwind Dental Group", assetCount: 14 } },
    { nativeId: `RMM-C-${rmmCompanySeq++}`, fields: { name: "Blue Harbor Logistics", assetCount: 22 } },
    { nativeId: `RMM-C-${rmmCompanySeq++}`, fields: { name: "Ironwood Mfg.", assetCount: 18 } },
    { nativeId: `RMM-C-${rmmCompanySeq++}`, fields: { name: "Marigold Bakery Co", assetCount: 4 } },
  ];

  const rmmDevices = [
    { ref: "nwd-lt-01", lastCheckIn: "2026-09-12T08:41:00Z" },
    { ref: "bhl-srv-01", lastCheckIn: "2026-09-12T08:39:00Z" },
    { ref: "iwm-srv-02", lastCheckIn: "2026-09-12T07:58:00Z" },
    { ref: "mgb-pos-03", lastCheckIn: "2026-09-11T22:12:00Z" },
  ].map(({ ref, lastCheckIn }) => {
    const d = DEVICES.find((x) => x.ref === ref);
    return {
      nativeId: `RMM-D-${rmmDeviceSeq++}`,
      fields: { hostname: d.hostname, serial: d.serial, os: d.os, company: d.company, lastCheckIn, openTicketCount: companyByName.get(d.company)?.openTickets ?? 0 },
    };
  });

  return {
    "crm-u": { company: crmCompanies, customer: crmCustomers },
    "psa-u": { company: psaCompanies, customer: psaCustomers, ticket: psaTickets, invoice: psaInvoices },
    "it-u": { company: itCompanies, customer: itCustomers, device: itDevices },
    "rmm-u": { company: rmmCompanies, device: rmmDevices },
  };
}

export function buildFeedIndex() {
  const index = new Map();
  for (const [connectorId, byType] of Object.entries(buildDemoFeeds())) {
    for (const [typeId, records] of Object.entries(byType)) {
      for (const record of records) {
        index.set(`${connectorId}:${typeId}:${record.nativeId}`, record.fields || {});
      }
    }
  }
  return index;
}

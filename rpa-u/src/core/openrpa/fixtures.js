import { OPENRPA_ID } from "./constants.js";

function iso(ms) {
  return new Date(ms).toISOString();
}

function acl(owners = []) {
  return {
    _acl: {
      _id: "acl_demo",
      name: "Restricted",
      ace: [
        { _id: "ace_owner", name: "Administrator", deny: false, rights: 65535 },
        ...owners.map((name, index) => ({ _id: `ace_${index}`, name, deny: false, rights: 65535 })),
      ],
    },
  };
}

function doc(id, type, name, created, modified, createdBy, extra = {}) {
  return {
    _id: id,
    _type: type,
    name,
    _created: created,
    _modified: modified,
    _createdby: createdBy,
    _modifiedby: createdBy,
    _version: 1,
    _encrypt: false,
    _acl: { _id: "acl_default", name: "Default", ace: [{ _id: "ace_everyone", name: "Everyone", deny: false, rights: 65535 }] },
    ...extra,
  };
}

export function buildOpenRpaFixtures({ now = Date.now() } = {}) {
  const day = 86400000;
  const at = (days, hours = 0) => iso(now - days * day - hours * 3600000);

  const roles = [
    { _id: "role_admin", name: "Administrator" },
    { _id: "role_designer", name: "Workflow Designer" },
    { _id: "role_operator", name: "Robot Operator" },
    { _id: "role_auditor", name: "Auditor" },
    { _id: "role_viewer", name: "Viewer" },
  ];

  const users = [
    { _id: "usr_ada", name: "Ada Ops", username: "ada", roles: [roles[0]] },
    { _id: "usr_nils", name: "Nils Design", username: "nils", roles: [roles[1], roles[2]] },
    { _id: "usr_vera", name: "Vera Readonly", username: "vera", roles: [roles[4]] },
  ];

  const workflows = [
    doc("wf_invoice", "workflow", "nightly-invoice-run", at(120), at(3), "ada", {
      filename: "nightly-invoice-run.xaml",
      queue: "qi_invoice",
      rpa: true,
      web: false,
      background: true,
      Serializable: true,
      priority: "normal",
      xaml: '<Activity x:Class="NightlyInvoiceRun" xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities">\n  <Sequence DisplayName="Process invoice">\n    <WriteLine Text="[&quot;Starting invoice run&quot;]" />\n    <InvokeMethod TargetObject="[invoiceId]" MethodName="Submit" />\n  </Sequence>\n</Activity>',
      parameters: [
        { name: "invoiceId", type: "string", direction: "in", required: true },
        { name: "amount", type: "double", direction: "in", required: false },
        { name: "result", type: "string", direction: "out", required: false },
      ],
    }),
    doc("wf_onboard", "workflow", "customer-onboarding", at(90), at(11), "nils", {
      filename: "customer-onboarding.xaml",
      queue: "qi_onboard",
      rpa: true,
      web: true,
      background: false,
      Serializable: true,
      priority: "high",
      parameters: [
        { name: "companyId", type: "string", direction: "in", required: true },
        { name: "seats", type: "int32", direction: "in", required: false, default: 1 },
      ],
    }),
    doc("wf_backup", "workflow", "device-backup", at(60), at(1), "ada", {
      filename: "device-backup.xaml",
      queue: "qi_backup",
      rpa: true,
      web: false,
      background: true,
      Serializable: false,
      priority: "normal",
      parameters: [{ name: "hostname", type: "string", direction: "in", required: true }],
    }),
    doc("wf_report", "workflow", "weekly-report", at(30), at(2), "nils", {
      filename: "weekly-report.xaml",
      queue: null,
      rpa: false,
      web: true,
      background: false,
      Serializable: true,
      priority: "low",
      parameters: [{ name: "week", type: "string", direction: "in", required: false }],
    }),
  ];

  const queues = [
    doc("qi_invoice", "workitemqueue", "invoice-queue", at(120), at(3), "ada", {
      workflowid: "wf_invoice",
      robotqueue: "robot-invoice",
      amqpqueue: "openrpa.invoice",
      maxretries: 3,
      retrydelay: 300,
      initialdelay: 0,
      success_wiqid: null,
      failed_wiqid: "qi_invoice_failed",
      success_wiq: "success",
      failed_wiq: "failed",
    }),
    doc("qi_onboard", "workitemqueue", "onboarding-queue", at(90), at(11), "nils", {
      workflowid: "wf_onboard",
      robotqueue: "robot-onboard",
      amqpqueue: "openrpa.onboard",
      maxretries: 5,
      retrydelay: 120,
      initialdelay: 10,
      success_wiqid: null,
      failed_wiqid: "qi_onboard_failed",
      success_wiq: "success",
      failed_wiq: "failed",
    }),
    doc("qi_backup", "workitemqueue", "backup-queue", at(60), at(1), "ada", {
      workflowid: "wf_backup",
      robotqueue: "robot-backup",
      amqpqueue: "openrpa.backup",
      maxretries: 2,
      retrydelay: 600,
      initialdelay: 30,
      success_wiqid: null,
      failed_wiqid: null,
      success_wiq: null,
      failed_wiq: null,
    }),
  ];

  const workitem = (id, wiq, state, created, payload, extra = {}) =>
    doc(id, "workitem", `${id}_${state}`, created, created, "system", {
      wiqid: wiq,
      wiq,
      state,
      payload: JSON.stringify(payload),
      retries: 0,
      priority: "normal",
      files: [],
      username: "ada",
      userid: "usr_ada",
      lastrun: null,
      nextrun: null,
      errormessage: null,
      errorsource: null,
      errortype: null,
      success_wiqid: null,
      failed_wiqid: null,
      success_wiq: null,
      failed_wiq: null,
      ...extra,
    });

  const workitems = [
    workitem("wi_1001", "qi_invoice", "new", at(0, 2), { invoiceId: "iv_2001" }),
    workitem("wi_1002", "qi_invoice", "new", at(0, 1), { invoiceId: "iv_2002" }),
    workitem("wi_1003", "qi_invoice", "processing", at(0, 4), { invoiceId: "iv_1999" }, { lastrun: at(0, 1), retries: 1, username: "nils", userid: "usr_nils" }),
    workitem("wi_1004", "qi_invoice", "success", at(1), { invoiceId: "iv_1998" }, { lastrun: at(1), success_wiq: "success" }),
    workitem("wi_1005", "qi_onboard", "failed", at(1), { companyId: "co_4400", seats: 12 }, { retries: 5, errormessage: "Timeout waiting for AD group", errorsource: "wf_onboard", errortype: "TimeoutException", failed_wiq: "failed" }),
    workitem("wi_1006", "qi_backup", "new", at(0, 8), { hostname: "northwind-dc01" }),
    workitem("wi_1007", "qi_backup", "new", at(0, 6), { hostname: "northwind-fs02" }, { priority: "high" }),
  ];

  const robots = [
    doc("robot_01", "robot", "ROBOT-A", at(180), iso(now - 45000), "system", {
      hostname: "rpa-node-a.northwind.local",
      version: "1.4.21",
      os: "Windows Server 2022",
      lastseen: iso(now - 45000),
      metrics: { cpu: 12, memory: 41 },
      robotqueue: "robot-invoice",
    }),
    doc("robot_02", "robot", "ROBOT-B", at(180), iso(now - 380000), "system", {
      hostname: "rpa-node-b.northwind.local",
      version: "1.4.21",
      os: "Windows Server 2022",
      lastseen: iso(now - 380000),
      metrics: { cpu: 63, memory: 72 },
      robotqueue: "robot-onboard",
    }),
    doc("robot_03", "robot", "ROBOT-C", at(30), iso(now - 7200000), "system", {
      hostname: "rpa-node-c.northwind.local",
      version: "1.4.18",
      os: "Windows 11",
      lastseen: iso(now - 7200000),
      metrics: { cpu: 0, memory: 18 },
      robotqueue: "robot-backup",
    }),
  ];

  const nodered = [
    doc("nr_01", "nodered", "flow-invoice", at(45), at(2), "ada", {
      url: "https://nodered.northwind.local/invoice",
      instance: "flow-invoice",
      state: "running",
      version: "3.1.0",
    }),
    doc("nr_02", "nodered", "flow-notify", at(45), at(9), "ada", {
      url: "https://nodered.northwind.local/notify",
      instance: "flow-notify",
      state: "stopped",
      version: "3.1.0",
    }),
  ];

  const companies = [
    doc("co_4400", "company", "Northwind Dental", at(200), at(4), "crm-u", { domain: "northwinddental.com", ...acl(["Robot Operator"]) }),
    doc("co_4401", "company", "Contoso Manufacturing", at(200), at(6), "crm-u", { domain: "contoso.example" }),
  ];

  const files = [
    doc("file_01", "file", "invoice-template.docx", at(50), at(50), "ada", { filename: "invoice-template.docx", contenttype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", length: 18432, refid: "wf_invoice", ref: "workflow", version: 1 }),
    doc("file_02", "file", "onboarding-checklist.xlsx", at(40), at(40), "nils", { filename: "onboarding-checklist.xlsx", contenttype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", length: 9216, refid: "wf_onboard", ref: "workflow", version: 1 }),
  ];

  return {
    version: "1.0.0",
    builtAt: iso(now),
    connector: OPENRPA_ID,
    users,
    roles,
    collections: ["workflows", "openrpa_queue", "openrpa_workitem", "openrpa_robot", "nodered", "companies", "files"],
    documents: {
      workflows,
      openrpa_queue: queues,
      openrpa_workitem: workitems,
      openrpa_robot: robots,
      nodered,
      companies,
      files,
    },
  };
}

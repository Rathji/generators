// FortiCloud IAM Planner - portal catalog + validation rule definitions.
// Grounded in the official Fortinet Identity & Access Management (IAM) docs:
// https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/703535
// Portal-specific access types beyond what is documented here come from each
// portal's own administration guide; this catalog is a planning aid and can be
// extended with custom portals.

window.IAMCatalog = (() => {

  const DOC = {
    intro:                    "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/703535/introduction",
    permissionProfiles:       "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/696752/permission-profiles",
    resourcePortals:          "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/64931/portals-with-resource-based-permission",
    permissionScope:          "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/656642/permission-scope",
    creatingProfile:          "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/836213/creating-a-permission-profile",
    managingProfiles:         "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/488605/managing-permission-profiles",
    userGroups:               "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/661231/user-groups",
    updateGroupPermission:    "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/827415/updating-user-group-permission",
    addingIamUsers:           "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/5478/adding-iam-users",
    apiUsers:                 "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/927656/api-users",
    scopeOrganizations:       "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/405081/permission-scope-with-organizations",
    profilesOrganizations:    "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/639962/permission-profiles-within-organizations",
    sharingProfiles:          "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/57631/sharing-permission-profiles-within-an-organization",
    userModels:               "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/510441/user-management-models",
    featureChart:             "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/406640/feature-comparison-chart",
    portal:                   "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/249991/identity-access-management-portal",
    bulkUpdate:               "https://docs.fortinet.com/document/forticloud/latest/identity-access-management-iam/104283/bulk-updating-users"
  };

  // Portals using RESOURCE-based permissions (per-resource access levels).
  const RES_LVLS = ["none", "read", "write"];
  const RESOURCE_PORTALS = [
    {
      id: "asset-management",
      name: "Asset Management",
      model: "resource",
      group: "Assets & Accounts",
      source: DOC.resourcePortals,
      note: "Controls access to account-level products, services and assets.",
      resources: [
        { id: "account-services", name: "Account Services", levels: RES_LVLS,
          note: "Account Services, FortiMeter, ELA Profile." },
        { id: "asset-maintenance", name: "Asset Maintenance", levels: RES_LVLS,
          note: "License downloading, decommissioning, deregistration, TradeUp, transfer, folder management." },
        { id: "entitlement-management", name: "Entitlement Management", levels: RES_LVLS,
          note: "Entitlement (product, contract, license) registration, Pending Registration, Marketplace." },
        { id: "renewal-notice", name: "Renewal Notice", levels: ["none", "read"],
          note: "Read Only or No Access only. The user must have access to the root folder." },
        { id: "vulnerability-list", name: "Vulnerability List", levels: ["none", "read"],
          note: "Read Only or No Access only." }
      ]
    },
    {
      id: "iam",
      name: "IAM",
      model: "resource",
      group: "Assets & Accounts",
      source: DOC.resourcePortals,
      note: "Controls access to the account itself and the creation and management of users.",
      resources: [
        { id: "account", name: "Account", levels: RES_LVLS,
          note: "Account management capabilities, including managing Account Settings." },
        { id: "user-activity-access", name: "User Activity Access", levels: ["none", "read"],
          note: "Access to the User Activity Logs page." },
        { id: "credentials", name: "Credentials", levels: RES_LVLS,
          note: "Control over account Security Credentials." },
        { id: "user-permissions", name: "User/Permissions", levels: RES_LVLS,
          note: "Users, user groups, permission profiles, and migrating sub users." }
      ]
    },
    {
      id: "forticare",
      name: "FortiCare",
      model: "resource",
      group: "Support",
      source: DOC.resourcePortals,
      note: "Controls access to ticketing features.",
      resources: [
        { id: "advanced-service-requests", name: "Advanced Service Requests", levels: RES_LVLS,
          note: "For the page to appear the user must have Read Only/Read & Write, access to the root folder, and a Premium Support entitlement." },
        { id: "customer-service-tickets", name: "Customer Service Tickets", levels: RES_LVLS,
          note: "Tickets pertaining to contracts and account management." },
        { id: "incident-response-ticket", name: "Incident Response Ticket", levels: RES_LVLS,
          note: "For the page to appear the user must have Read Only/Read & Write, access to the root folder, and an Incident Retainer Service entitlement." },
        { id: "rma-tickets", name: "RMA Tickets", levels: RES_LVLS,
          note: "Tickets pertaining to DOA and RMA assets." },
        { id: "support-resources", name: "Support Resources", levels: ["none", "read"],
          note: "Resource documents, firmware downloads, customer support bulletin. Partners can also view the Bug Tracker." },
        { id: "survey-tickets", name: "Survey Tickets", levels: ["none", "write"],
          note: "Read & Write or No Access only." },
        { id: "technical-support-tickets", name: "Technical Support Tickets", levels: RES_LVLS,
          note: "Tickets for technical issues." },
        { id: "web-chat", name: "Web Chat", levels: ["none", "write"],
          note: "Read & Write or No Access only." }
      ]
    }
  ];

  // Portals using ROLE-based permissions (portal-wide access types).
  // Access types generally: Read Only, Read & Write, Admin (some portals add Custom).
  const ROLE_PORTALS = [
    { id: "fortigate-cloud", name: "FortiGate Cloud", model: "role",
      note: "May organize related resources into multiple sections." },
    { id: "fortimanager-cloud", name: "FortiManager Cloud", model: "role", hasCustom: true,
      note: "Access Types: Admin, Read/Write, Read Only, Custom. Custom maps to Super_User / Standard_User / Restricted_User administrator profiles; a user on Custom is auto-assigned Restricted_User until a Super_User reassigns them." },
    { id: "fortianalyzer-cloud", name: "FortiAnalyzer Cloud", model: "role", hasCustom: true,
      note: "Access Types: Admin, Read/Write, Read Only, Custom (same custom-access model as FortiManager Cloud)." },
    { id: "fortisase", name: "FortiSASE", model: "role" },
    { id: "fortitoken-cloud", name: "FortiToken Cloud", model: "role" },
    { id: "fortimonitor", name: "FortiMonitor", model: "role" },
    { id: "fortisandbox-cloud", name: "FortiSandbox Cloud", model: "role" },
    { id: "fortivoice-cloud", name: "FortiVoice Cloud", model: "role" },
    { id: "fortiweb-cloud", name: "FortiWeb Cloud", model: "role" },
    { id: "fortindr-cloud", name: "FortiNDR Cloud", model: "role" }
  ];

  // The default SysAdmin permission profile (present at all times; immutable).
  const SYSADMIN = {
    id: "sysadmin",
    name: "SysAdmin",
    builtin: true,
    type: "local",
    status: "active",
    sysadmin: true,
    description: "Default permission profile. Full access to the Asset Management, IAM, and FortiCare portals. Cannot be edited, disabled, or deleted.",
    portals: [
      { id: "asset-management", enabled: true, resources: {
        "account-services": "write", "asset-maintenance": "write", "entitlement-management": "write",
        "renewal-notice": "read", "vulnerability-list": "read" } },
      { id: "iam", enabled: true, resources: {
        "account": "write", "user-activity-access": "read", "credentials": "write", "user-permissions": "write" } },
      { id: "forticare", enabled: true, resources: {
        "advanced-service-requests": "write", "customer-service-tickets": "write", "incident-response-ticket": "write",
        "rma-tickets": "write", "support-resources": "read", "survey-tickets": "write",
        "technical-support-tickets": "write", "web-chat": "write" } }
    ]
  };

  function findPortal(id) {
    for (const p of RESOURCE_PORTALS) if (p.id === id) return p;
    for (const p of ROLE_PORTALS) if (p.id === id) return p;
    return null;
  }

  function allPortals() {
    return [...RESOURCE_PORTALS, ...ROLE_PORTALS];
  }

  // --- Doc-grounded validation rule metadata (shown as findings) ---
  const RULES = [
    { code: "sysadmin_immutable", severity: "error",
      text: "The default SysAdmin permission profile cannot be edited, disabled, or deleted.",
      ref: DOC.managingProfiles },
    { code: "sysadmin_reserved_name", severity: "warning",
      text: "SysAdmin is a reserved default profile name; creating another profile with this name will conflict.",
      ref: DOC.creatingProfile },
    { code: "profile_in_use_disable", severity: "error",
      text: "A permission profile cannot be disabled if an active IAM user is assigned to it.",
      ref: DOC.managingProfiles },
    { code: "profile_in_use_delete", severity: "error",
      text: "A permission profile cannot be deleted if an active IAM user is assigned to it.",
      ref: DOC.managingProfiles },
    { code: "undefined_portal", severity: "info",
      text: "Excluding a portal from a permission profile does not deny access - its status is undefined, and the user may still reach it via the Services menu if the portal offers open access.",
      ref: DOC.creatingProfile },
    { code: "deny_role", severity: "info",
      text: "To deny a role-based portal, add it to the profile but do not enable Access.",
      ref: DOC.creatingProfile },
    { code: "deny_resource", severity: "info",
      text: "To deny a resource-based portal, add it to the profile but do not enable any resource access.",
      ref: DOC.creatingProfile },
    { code: "sysadmin_coverage", severity: "info",
      text: "SysAdmin covers Assets & Accounts and Support, but does not provide access to Cloud Management or Cloud Services.",
      ref: DOC.creatingProfile },
    { code: "custom_access", severity: "info",
      text: "Custom access: users on this profile are auto-assigned the Restricted_User administrator profile on first login; a Super_User must reassign a different profile in that portal.",
      ref: DOC.creatingProfile },
    { code: "profile_type_immutable", severity: "info",
      text: "The permission profile type (Local / Organization) cannot be changed after the profile is saved.",
      ref: DOC.profilesOrganizations },
    { code: "org_scope_note", severity: "info",
      text: "Organization scope requires OU access to be enabled. If you are logged in to a local account, only Local permission profiles are visible.",
      ref: DOC.scopeOrganizations },
    { code: "one_model_per_portal", severity: "info",
      text: "A portal can only support one permission model at a time; converted portals migrate role-based permissions to resource-based via portal-specific rules.",
      ref: DOC.permissionProfiles },
    { code: "group_single_membership", severity: "info",
      text: "A user can only belong to one group at a time.",
      ref: DOC.userGroups },
    { code: "scope_root_folder", severity: "info",
      text: "Renewal Notice access requires the user to have access to the root folder in their permission scope.",
      ref: DOC.resourcePortals },
    { code: "forticare_entitlement", severity: "info",
      text: "FortiCare Advanced Service Requests / Incident Response require the corresponding entitlement and root-folder access for the page to appear.",
      ref: DOC.resourcePortals }
  ];

  function rule(code) { return RULES.find(r => r.code === code) || { code, severity: "info", text: code }; }

  return {
    DOC, RESOURCE_PORTALS, ROLE_PORTALS, SYSADMIN, RULES,
    findPortal, allPortals, rule
  };
})();

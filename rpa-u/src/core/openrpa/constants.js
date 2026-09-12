export const OPENRPA_ID = "openrpa";
export const OPENRPA_NAME = "OpenRPA";
export const OPENRPA_LABEL = "OpenRPA / OpenFlow agentic automation";
export const OPENRPA_ACCENT = "#c2410c";
export const OPENRPA_STUB = "rpa-u";
export const OPENRPA_TOPIC_PREFIX = "openrpa";
export const OPENRPA_MODULE_PATH = "src/core/openrpa";
export const OPENRPA_PROTOCOL = "openflow-websocket";

export const OPENRPA_CONNECTION_STATES = ["disconnected", "connecting", "connected", "reconnecting", "error"];
export const OPENRPA_MODES = ["emulator", "live"];
export const OPENRPA_SCHEMES = ["ws", "wss"];
export const OPENRPA_DEFAULT_PORT = { ws: 80, wss: 443 };
export const OPENRPA_SCHEME_ALIASES = { http: "ws", https: "wss" };

export const OPENRPA_PROFILE_COLLECTION = "openrpa_profiles";
export const OPENRPA_SESSION_COLLECTION = "openrpa_session";
export const OPENRPA_EMULATOR_COLLECTION = "openrpa_emulator";
export const OPENRPA_BRIDGE_COLLECTION = "openrpa_bridge";
export const OPENRPA_LINKS_COLLECTION = "openrpa_links";
export const OPENRPA_SYNC_COLLECTION = "openrpa_sync";
export const OPENRPA_BUNDLES_COLLECTION = "openrpa_bundles";
export const OPENRPA_COLLECTIONS = [OPENRPA_PROFILE_COLLECTION, OPENRPA_SESSION_COLLECTION, OPENRPA_EMULATOR_COLLECTION, OPENRPA_BRIDGE_COLLECTION, OPENRPA_LINKS_COLLECTION, OPENRPA_SYNC_COLLECTION, OPENRPA_BUNDLES_COLLECTION];

export const OPENRPA_BRIDGE_EXCHANGE = "openrpa.bridge";
export const OPENRPA_BRIDGE_WATCH_COLLECTIONS = ["openrpa_queue", "openrpa_workitem", "openrpa_robot", "nodered", "workflows"];

export const OPENRPA_CAPABILITIES = [
  { id: "collections", label: "Collections & documents", description: "List OpenFlow collections and query, insert, upsert, update and delete documents." },
  { id: "workitems", label: "Work items & queues", description: "Manage work-item queues and enqueue, claim, mutate and route work items." },
  { id: "workflows", label: "Workflows & invocation", description: "Read workflow definitions and invoke a workflow by queue or workflow id." },
  { id: "robots", label: "Robot registry & presence", description: "Discover robot instances and read their heartbeats, versions and metrics." },
  { id: "watch", label: "Document watch", description: "Subscribe to OpenFlow change streams for configured document filters." },
  { id: "nodered", label: "Node-RED instances", description: "Ensure, restart and delete the Node-RED instances a tenant owns." },
  { id: "files", label: "File storage", description: "Upload, list, download and delete the files that workflow assets and work items reference." },
];

export const OPENRPA_CONNECTION_FIELDS = [
  { key: "url", label: "WebSocket URL", kind: "url", required: false, placeholder: "wss://openflow.example.com:443", hint: "A full ws:// or wss:// endpoint. Overrides scheme, host, port and path." },
  { key: "scheme", label: "Scheme", kind: "enum", required: false, values: OPENRPA_SCHEMES, hint: "wss keeps the connection encrypted; ws is for a trusted local network." },
  { key: "host", label: "Host", kind: "text", required: true, placeholder: "openflow.example.com", hint: "Hostname or IP address of the OpenFlow endpoint." },
  { key: "port", label: "Port", kind: "number", required: false, hint: "Left blank, defaults to 443 for wss and 80 for ws." },
  { key: "path", label: "Path", kind: "text", required: false, placeholder: "/", hint: "Optional path, must begin with a slash." },
  { key: "organization", label: "Organization / tenant", kind: "text", required: false, hint: "Recorded on the profile so a multi-tenant Hub can be told apart." },
  { key: "insecure", label: "Allow insecure TLS", kind: "boolean", required: false, hint: "Accept a self-signed certificate. Off is strongly recommended." },
  { key: "restBase", label: "REST base URL", kind: "url", required: false, placeholder: "https://openflow.example.com", hint: "Optional HTTP endpoint for the parts of OpenFlow that are not on the socket." },
];

export const OPENRPA_COMMANDS = {
  client: [
    "signin",
    "refreshtoken",
    "signout",
    "ping",
    "listcollections",
    "query",
    "count",
    "insertone",
    "insertorupdateone",
    "insertmany",
    "updateone",
    "deleteone",
    "deletemany",
    "getmachines",
    "getusers",
    "getroles",
    "registerqueue",
    "registerexchange",
    "queuemessage",
    "createworkflowinstance",
    "watch",
    "unwatch",
    "ensureNoderedInstance",
    "restartNoderedInstance",
    "deleteNoderedInstance",
    "addworkitem",
    "addworkitems",
    "popworkitem",
    "updateworkitem",
    "deleteworkitem",
    "addworkitemqueue",
    "updateworkitemqueue",
    "deleteworkitemqueue",
    "uploadfile",
    "getfile",
    "listfiles",
    "deletefile",
    "pushmetrics",
  ],
  server: ["ping", "refreshtoken", "queueclosed", "queuemessage", "watchevent", "workflowinstance", "workitem", "robot", "collectionchanged", "error"],
};

export const OPENRPA_HEALTH_THRESHOLDS = { degradedMs: 600, downMs: 4000, errorRate: 0.5, reconnectWarn: 2 };

export const OPENRPA_OPENFLOW_ROLE_MAP = {
  Administrator: "admin",
  "OpenRPA Administrator": "admin",
  "Workflow Designer": "dispatcher",
  "Robot Operator": "technician",
  Auditor: "auditor",
  Viewer: "viewer",
};

export const OPENRPA_DESCRIPTOR = {
  id: OPENRPA_ID,
  name: OPENRPA_NAME,
  label: OPENRPA_LABEL,
  accent: OPENRPA_ACCENT,
  kind: "openrpa",
  protocol: OPENRPA_PROTOCOL,
  realtime: true,
  hub: false,
  entityTypes: ["company", "customer", "device", "ticket", "invoice"],
  connectionState: "disconnected",
  capabilities: OPENRPA_CAPABILITIES.map((entry) => entry.id),
  connectionFields: OPENRPA_CONNECTION_FIELDS.map((entry) => entry.key),
};

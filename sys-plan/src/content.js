import { pick, shuffle, mulberry32, uid } from "./util.js";
import { addNode, addWire } from "./model.js";

export const CATEGORIES = {
  electrical: { label: "Electrical", color: "#d97706", badge: "E", dot: "#f59e0b" },
  electronics: { label: "Electronics", color: "#db2777", badge: "IC", dot: "#ec4899" },
  software: { label: "Software", color: "#2563eb", badge: "SW", dot: "#3b82f6" },
  data: { label: "Data", color: "#7c3aed", badge: "DB", dot: "#8b5cf6" },
  network: { label: "Network", color: "#0891b2", badge: "NET", dot: "#06b6d4" },
  mechanical: { label: "Mechanical", color: "#b45309", badge: "MECH", dot: "#d97706" },
  fluid: { label: "Fluid", color: "#0284c7", badge: "FL", dot: "#0ea5e9" },
  thermal: { label: "Thermal", color: "#dc2626", badge: "T", dot: "#ef4444" },
  energy: { label: "Energy", color: "#65a30d", badge: "PWR", dot: "#84cc16" },
  control: { label: "Control", color: "#475569", badge: "CTL", dot: "#64748b" },
  human: { label: "People / process", color: "#9333ea", badge: "OPS", dot: "#a855f7" },
};

export const PORT_TYPES = {
  power: { label: "Power", color: "#f59e0b" },
  signal: { label: "Signal", color: "#ef4444" },
  control: { label: "Control", color: "#64748b" },
  data: { label: "Data", color: "#3b82f6" },
  status: { label: "Status", color: "#10b981" },
  network: { label: "Network", color: "#06b6d4" },
  fluid: { label: "Fluid", color: "#0ea5e9" },
  motion: { label: "Motion", color: "#d97706" },
  media: { label: "Media", color: "#a855f7" },
  heat: { label: "Heat", color: "#ef4444" },
};

/* A palette item: {t:[titles], d:[descs], kind, in:[[label,type],...], out:[[...]]} */
export const PALETTE = {
  electrical: [
    { t: ["Battery pack", "9V battery", "Power supply", "AC adapter"], d: ["Stores and delivers DC power to the rail", "Turns mains AC into a stable DC supply", "Small form-factor portable power source"], kind: "source", in: [], out: [["+V", "power"], ["common", "power"]] },
    { t: ["Motor", "Servo motor", "Stepper motor", "DC gear motor"], d: ["Turns electrical energy into rotation", "Precise angular position under closed-loop control", "Controlled rotation in discrete steps"], kind: "actuator", in: [["power", "power"], ["command", "control"]], out: [["shaft", "motion"], ["tach", "status"]] },
    { t: ["Relay", "Solid-state relay", "Contactor"], d: ["Isolated switch driven by a control signal", "Switches mains loads without moving parts"], kind: "switch", in: [["coil+", "power"], ["coil-", "power"], ["control", "control"]], out: [["contact", "power"]] },
    { t: ["Fuse", "Breaker", "Polyfuse"], d: ["Protects the circuit from overcurrent", "Trip-and-reset overcurrent protection"], kind: "protection", in: [["line", "power"]], out: [["protected", "power"]] },
    { t: ["LED strip", "Lighting driver", "PWM dimmer"], d: ["Addressable lighting strip", "Constant-current LED driver with dimming"], kind: "load", in: [["power", "power"], ["PWM", "control"]], out: [] },
    { t: ["Heater element", "Resistive load", "Peltier cell"], d: ["Converts power to heat", "Solid-state thermoelectric cooler / heater"], kind: "load", in: [["power", "power"]], out: [["heat", "heat"]] },
    { t: ["Buck converter", "Boost converter", "Buck-boost module", "DC-DC converter"], d: ["Steps a voltage rail down efficiently", "Steps up a low rail to a higher level", "Regulates a rail from a variable input"], kind: "power", in: [["in", "power"]], out: [["out", "power"], ["enable", "control"]] },
    { t: ["LDO regulator", "Linear regulator", "Zener shunt"], d: ["Clean low-noise fixed voltage rail", "Simple fixed-voltage reference"], kind: "power", in: [["in", "power"]], out: [["out", "power"]] },
    { t: ["Load switch", "MOSFET switch", "High-side driver"], d: ["Low-loss enable/disable of a rail", "Logic-level gate driver for loads"], kind: "switch", in: [["in", "power"], ["gate", "control"]], out: [["out", "power"]] },
    { t: ["Capacitor bank", "Supercap", "Bulk decoupling"], d: ["Energy reservoir that smooths rail transients", "High-capacity storage for short power gaps"], kind: "passive", in: [["+", "power"], ["-", "power"]], out: [] },
    { t: ["Inductor", "Choke", "Ferrite bead"], d: ["Filters ripple on a supply rail", "Blocks high-frequency noise"], kind: "passive", in: [["in", "power"]], out: [["out", "power"]] },
    { t: ["Current sensor", "Hall-effect sensor", "Shunt monitor"], d: ["Measures current drawn by a branch", "High-side current sensing with alert output"], kind: "sensor", in: [["load+", "power"], ["load-", "power"]], out: [["measure", "data"], ["alert", "status"]] },
    { t: ["Wire harness", "Bus bar", "Cable gland"], d: ["Routed bundle of power and signal wires", "Low-impedance distribution spine"], kind: "passive", in: [["in", "power"]], out: [["out", "power"]] },
    { t: ["Ground bus", "Chassis ground", "Star ground point"], d: ["Common reference plane for all rails", "Single-point grounding to avoid loops"], kind: "passive", in: [["tie", "power"]], out: [] },
  ],
  electronics: [
    { t: ["Microcontroller", "MCU module", "Raspberry Pi Pico", "Arduino board"], d: ["Runs the firmware and coordinates subsystems", "General-purpose dev board with ADC/PWM/I2C", "Low-power MCU with wireless stack"], kind: "brain", in: [["power", "power"], ["sensor in", "signal"], ["cmd", "control"]], out: [["logic out", "signal"], ["PWM", "control"], ["UART", "data"], ["I²C", "data"]] },
    { t: ["Op-amp", "Instrumentation amp", "Comparator"], d: ["Amplifies and conditions sensor signals", "Precise differential measurement front end"], kind: "signal", in: [["+", "signal"], ["-", "signal"], ["power", "power"]], out: [["out", "signal"]] },
    { t: ["ADC module", "Sensor conditioner", "Signal chain"], d: ["Converts analog sensor voltages to numbers", "Filters and scales a raw sensor signal"], kind: "signal", in: [["analog", "signal"], ["ref", "power"]], out: [["digital", "data"]] },
    { t: ["DAC", "PWM→analog filter", "Voltage source"], d: ["Generates a precise analog output level", "Smooths a PWM stream into a DC level"], kind: "signal", in: [["word", "data"], ["power", "power"]], out: [["analog", "signal"]] },
    { t: ["Logic gate", "Level shifter", "Buffer IC"], d: ["Combinational logic or glue logic", "Converts between 3.3V and 5V domains"], kind: "signal", in: [["a", "signal"], ["b", "signal"]], out: [["q", "signal"]] },
    { t: ["Sensor", "Temperature sensor", "Proximity sensor", "IMU", "Camera module"], d: ["Measures the physical world for the system", "Ambient or contact temperature", "Detects nearby objects without touching", "Accelerometer + gyroscope fusion"], kind: "sensor", in: [["power", "power"]], out: [["value", "signal"], ["bus", "data"]] },
    { t: ["Buzzer", "Speaker amp", "E-stop LED", "Display module"], d: ["Audible alert driven by the controller", "Annunciates state to the operator"], kind: "output", in: [["signal", "signal"], ["power", "power"]], out: [] },
    { t: ["RF module", "BLE module", "Wi-Fi module", "LoRa radio"], d: ["Wireless link back to a hub", "Low-power radio link for telemetry"], kind: "radio", in: [["uart", "data"], ["power", "power"]], out: [["antenna", "network"]] },
  ],
  software: [
    { t: ["API gateway", "Edge service", "BFF"], d: ["Single entry point that routes and authenticates requests", "Front-end-specific aggregation layer"], kind: "service", in: [["HTTP", "network"]], out: [["routed", "network"], ["authz", "status"]] },
    { t: ["Auth service", "Identity provider", "Token service"], d: ["Issues and validates credentials and sessions", "Central identity and access control"], kind: "service", in: [["requests", "network"], ["users", "data"]], out: [["tokens", "data"], ["session", "data"]] },
    { t: ["Worker pool", "Job queue consumer", "Batch processor"], d: ["Processes async jobs off a queue", "Scales horizontally with message volume"], kind: "service", in: [["jobs", "data"]], out: [["results", "data"], ["metrics", "status"]] },
    { t: ["Database", "Primary DB", "Replica", "Search index"], d: ["Durable store for system state", "Read-replica off the primary", "Full-text and vector search service"], kind: "store", in: [["writes", "data"], ["reads", "data"]], out: [["query result", "data"], ["replication", "data"]] },
    { t: ["Cache", "Redis cluster", "CDN edge"], d: ["In-memory hot path that offloads the DB", "Geographic caching of static assets"], kind: "store", in: [["get", "data"], ["set", "data"]], out: [["hit", "data"]] },
    { t: ["Message queue", "Event bus", "Pub/sub broker", "Stream log"], d: ["Decouples producers and consumers", "Fan-out of events to many subscribers", "Append-only ordered event history"], kind: "service", in: [["produce", "data"]], out: [["consume", "data"]] },
    { t: ["Frontend app", "Web client", "Mobile app", "CLI tool"], d: ["The surface humans interact with", "Serves the SPA and static shell"], kind: "client", in: [["api", "network"], ["events", "data"]], out: [["requests", "network"], ["telemetry", "data"]] },
    { t: ["Scheduler", "Cron service", "Orchestrator"], d: ["Triggers periodic and event-driven jobs", "Coordinates multi-step workflows"], kind: "service", in: [["tick", "status"]], out: [["jobs", "data"]] },
    { t: ["Monitoring", "Log aggregator", "Metrics store", "Alert manager"], d: ["Collects metrics, logs and traces", "Detects anomalies and pages humans"], kind: "ops", in: [["telemetry", "data"], ["logs", "data"]], out: [["alerts", "status"]] },
    { t: ["Config service", "Feature flags", "Secrets vault"], d: ["Serves live configuration to services", "Gate features without redeploys"], kind: "ops", in: [["read", "data"]], out: [["config", "data"]] },
    { t: ["ML model", "Inference service", "Embedding service"], d: ["Serves model predictions over an API", "Converts text/images to vectors"], kind: "service", in: [["features", "data"]], out: [["predictions", "data"]] },
  ],
  data: [
    { t: ["ETL pipeline", "Data warehouse", "Data lake"], d: ["Extracts, transforms and loads raw data", "Columnar store for analytics queries"], kind: "store", in: [["raw", "data"]], out: [["clean", "data"], ["tables", "data"]] },
    { t: ["Analytics dashboard", "BI layer", "Reporting service"], d: ["Presents KPIs to stakeholders", "Scheduled and ad-hoc report generation"], kind: "client", in: [["queries", "data"]], out: [["reports", "data"], ["view", "media"]] },
    { t: ["Backup store", "Archive", "Cold storage"], d: ["Long-term retention and restore", "Cheap durable copy of hot data"], kind: "store", in: [["snapshot", "data"]], out: [["restore", "data"]] },
    { t: ["Feature store", "Stream processor", "Real-time join"], d: ["Serves consistent ML features", "Consumes events and emits derived signals"], kind: "service", in: [["stream", "data"], ["lookup", "data"]], out: [["features", "data"]] },
    { t: ["File transfer", "SFTP relay", "Batch ingest"], d: ["Moves files between partners securely", "Pulls files from external systems on schedule"], kind: "service", in: [["files", "data"]], out: [["landed", "data"]] },
  ],
  network: [
    { t: ["Router", "Edge router", "Core switch"], d: ["Routes traffic between segments", "High-throughput packet forwarding"], kind: "infra", in: [["uplink", "network"]], out: [["downlink", "network"], ["mgmt", "network"]] },
    { t: ["Firewall", "WAF", "NAT gateway"], d: ["Enforces network security policy", "Filters web traffic at the edge"], kind: "infra", in: [["untrusted", "network"]], out: [["trusted", "network"]] },
    { t: ["Load balancer", "Reverse proxy", "API router"], d: ["Distributes traffic across backends", "Terminates TLS and forwards requests"], kind: "infra", in: [["client", "network"]], out: [["backend", "network"]] },
    { t: ["Switch", "Access point", "Bridge"], d: ["Connects devices on a LAN", "Wireless access for clients"], kind: "infra", in: [["ports", "network"]], out: [["ports", "network"]] },
    { t: ["VPN concentrator", "Zero-trust gateway", "Remote access"], d: ["Secure tunnel for remote clients", "Application-level access control"], kind: "infra", in: [["internet", "network"]], out: [["intranet", "network"]] },
    { t: ["DNS", "CDN origin", "Proxy cache"], d: ["Resolves names and policies", "Serves and caches content near users"], kind: "infra", in: [["queries", "network"]], out: [["answers", "network"]] },
  ],
  mechanical: [
    { t: ["Gearbox", "Reduction drive", "Belt drive", "Chain drive"], d: ["Trades speed for torque", "Takes rotation at a chosen ratio"], kind: "drive", in: [["input", "motion"]], out: [["output", "motion"]] },
    { t: ["Pump", "Hydraulic pump", "Gear pump"], d: ["Moves fluid to create pressure and flow", "Pressure source for the hydraulic circuit"], kind: "actuator", in: [["drive", "motion"], ["power", "power"]], out: [["out", "fluid"]] },
    { t: ["Actuator", "Linear actuator", "Pneumatic cylinder"], d: ["Converts motion or pressure into force", "Precise linear position output"], kind: "actuator", in: [["drive", "motion"], ["cmd", "control"]], out: [["force", "motion"], ["pos", "status"]] },
    { t: ["Motor mount", "Bracket", "Frame", "Chassis"], d: ["Structural home for a subsystem", "Rigid reference for moving parts"], kind: "structure", in: [["load", "motion"]], out: [["mount", "motion"]] },
    { t: ["Encoder", "Limit switch", "Position sensor"], d: ["Reports shaft angle or position", "End-of-travel detection"], kind: "sensor", in: [["shaft", "motion"], ["power", "power"]], out: [["angle", "signal"], ["count", "data"]] },
    { t: ["Brake", "Clutch", "Damper"], d: ["Holds or slows a load", "Engages/disengages drive power"], kind: "actuator", in: [["drive", "motion"], ["ctrl", "control"]], out: [["hold", "motion"]] },
    { t: ["Lead screw", "Ball screw", "Rack & pinion"], d: ["Converts rotary to linear motion", "Low-friction precision linear drive"], kind: "drive", in: [["rotary", "motion"]], out: [["linear", "motion"]] },
  ],
  fluid: [
    { t: ["Valve", "Solenoid valve", "Ball valve", "Proportional valve"], d: ["Controls flow through a line", "Electrically switched flow path", "Analog flow control"], kind: "actuator", in: [["in", "fluid"], ["ctrl", "control"]], out: [["out", "fluid"], ["pos", "status"]] },
    { t: ["Tank", "Reservoir", "Buffer tank"], d: ["Stores working fluid", "Smooths demand spikes in the loop"], kind: "store", in: [["fill", "fluid"]], out: [["drain", "fluid"]] },
    { t: ["Filter", "Strainer", "Regulator", "Dryer"], d: ["Removes contamination from the fluid", "Maintains downstream pressure"], kind: "passive", in: [["in", "fluid"]], out: [["out", "fluid"]] },
    { t: ["Heat exchanger", "Radiator", "Chiller"], d: ["Transfers heat out of the fluid loop", "Dissipates waste heat to ambient"], kind: "thermal", in: [["hot", "fluid"], ["coolant", "fluid"]], out: [["cooled", "fluid"], ["waste", "heat"]] },
    { t: ["Flow meter", "Pressure sensor", "Level sensor"], d: ["Measures fluid throughput", "Reports line pressure", "Reports tank fill level"], kind: "sensor", in: [["line", "fluid"], ["power", "power"]], out: [["flow", "data"], ["pressure", "signal"]] },
    { t: ["Manifold", "Header", "Piping run"], d: ["Distributes fluid to several branches", "Route bundle connecting components"], kind: "passive", in: [["in", "fluid"]], out: [["branch", "fluid"]] },
    { t: ["Compressor", "Blower", "Fan"], d: ["Moves air or gas through the system", "Adds pressure to the air circuit"], kind: "actuator", in: [["drive", "motion"], ["power", "power"]], out: [["air", "fluid"]] },
  ],
  thermal: [
    { t: ["Heat sink", "Cold plate", "Heat pipe"], d: ["Spreads and dissipates component heat", "Passively conducts heat to a bigger surface"], kind: "passive", in: [["junction", "heat"]], out: [["ambient", "heat"]] },
    { t: ["TEC cooler", "Refrigeration unit", "Chiller"], d: ["Actively pumps heat from a target", "Holds a chamber at a set temperature"], kind: "actuator", in: [["power", "power"], ["cmd", "control"]], out: [["cold", "heat"], ["reject", "heat"]] },
    { t: ["Thermostat", "Thermal fuse", "Temp controller"], d: ["Senses and reacts to temperature", "Cut-off protection on over-temperature"], kind: "sensor", in: [["sense", "heat"], ["power", "power"]], out: [["trip", "status"]] },
    { t: ["Insulation", "Thermal barrier"], d: ["Slows unwanted heat exchange"], kind: "passive", in: [["in", "heat"]], out: [["out", "heat"]] },
  ],
  energy: [
    { t: ["Solar panel", "Wind turbine", "Fuel cell", "Generator"], d: ["Primary source of system energy", "Converts ambient energy into electricity"], kind: "source", in: [["irradiance", "signal"]], out: [["DC out", "power"]] },
    { t: ["MPPT charge controller", "Grid inverter", "Rectifier"], d: ["Extracts max power from the source", "Converts DC to AC and syncs to grid"], kind: "power", in: [["in", "power"]], out: [["out", "power"], ["mppt", "status"]] },
    { t: ["Battery bank", "UPS", "Storage array"], d: ["Stores energy for when the source dips", "Ride-through for power loss"], kind: "store", in: [["charge", "power"]], out: [["discharge", "power"], ["soc", "status"]] },
    { t: ["Busbar", "Distribution panel", "PDU"], d: ["Spines power to every subsystem", "Managed distribution with breakers"], kind: "power", in: [["feed", "power"]], out: [["branch", "power"]] },
    { t: ["Smart meter", "Power monitor", "EMS"], d: ["Logs energy production and consumption", "Optimizes when to store vs use"], kind: "ops", in: [["measure", "power"]], out: [["energy data", "data"], ["alerts", "status"]] },
  ],
  control: [
    { t: ["PLC", "PID controller", "Motion controller"], d: ["Runs the machine control loop", "Closed-loop regulation of a process variable"], kind: "brain", in: [["setpoint", "control"], ["feedback", "signal"], ["power", "power"]], out: [["drive", "control"], ["out", "signal"]] },
    { t: ["HMI", "Operator panel", "SCADA"], d: ["Lets operators watch and command the process", "Trends, alarms and manual control"], kind: "client", in: [["telemetry", "data"]], out: [["setpoints", "control"]] },
    { t: ["Safety relay", "E-stop chain", "Interlock"], d: ["Catches faults and cuts power safely", "Fails safe on wiring or logic fault"], kind: "protection", in: [["power", "power"], ["guards", "status"]], out: [["safe power", "power"], ["fault", "status"]] },
    { t: ["Alarm system", "Annunciator", "Beacon"], d: ["Turns conditions into operator alerts", "Visual/audible state indication"], kind: "output", in: [["conditions", "status"]], out: [] },
    { t: ["Remote IO", "Fieldbus gateway", "IO link master"], d: ["Brings field signals to the controller", "Bridges field devices onto the control bus"], kind: "infra", in: [["field", "signal"], ["bus", "data"]], out: [["bus", "data"], ["power", "power"]] },
  ],
  human: [
    { t: ["Operator", "Maintenance crew", "Support team"], d: ["Runs, monitors and maintains the system", "Responds to alerts and does manual steps"], kind: "role", in: [["alerts", "status"], ["work orders", "data"]], out: [["actions", "control"], ["feedback", "status"]] },
    { t: ["Onboarding", "Training", "Runbook"], d: ["Turns humans into competent operators", "Documented procedures for fault response"], kind: "process", in: [["docs", "data"]], out: [["trained", "status"]] },
    { t: ["Incident response", "SLA tracking", "Change board"], d: ["Process for handling failures with humans", "Escalation and communication during outages"], kind: "process", in: [["incidents", "status"]], out: [["resolved", "status"]] },
  ],
};

export const FALLBACK_PALETTE = [
  { t: ["Component"], d: ["A building block of the system"], kind: "", in: [["in", "data"]], out: [["out", "data"]] },
];

/* ---------- starting demo board (first-run welcome) ---------- */
export function demoBoard() {
  const plan = { nodes: [], wires: [], meta: {} };
  const add = (patch) => addNode(plan, patch);
  const ctl = add({ category: "control", title: "Controller", kind: "brain", desc: "Runs the closed loop and the mode logic.", x: 20, y: 90, inputs: [["setpoint", "control"], ["feedback", "signal"]], outputs: [["drive", "control"], ["status", "status"]] });
  const sens = add({ category: "electronics", title: "Sensor", kind: "sensor", desc: "Measures the process variable.", x: 20, y: 300, inputs: [["power", "power"]], outputs: [["signal", "signal"]] });
  const act = add({ category: "electrical", title: "Actuator", kind: "actuator", desc: "Applies control effort to the process.", x: 560, y: 140, inputs: [["power", "power"], ["command", "control"]], outputs: [["effort", "motion"], ["tach", "status"]] });
  const ps = add({ category: "electrical", title: "Power supply", kind: "source", desc: "Provides the main and logic rails.", x: 560, y: 340, inputs: [], outputs: [["main", "power"], ["logic", "power"]] });
  const load = add({ category: "electrical", title: "Process / load", kind: "load", desc: "The thing being controlled.", x: 1120, y: 90, inputs: [["power", "power"]], outputs: [] });
  const note = add({ category: "human", title: "Wiring: twist & heatshrink", kind: "note", desc: "", x: 20, y: 500, note: true, inputs: [], outputs: [] });

  const wire = (a, ao, b, bi) => {
    const na = plan.nodes.find((n) => n.title === a), nb = plan.nodes.find((n) => n.title === b);
    if (na && nb) {
      const srcPort = na.outputs.findIndex((p) => p.label === ao);
      const dstPort = nb.inputs.findIndex((p) => p.label === bi);
      if (srcPort >= 0 && dstPort >= 0) addWire(plan, na.id, srcPort, nb.id, dstPort);
    }
  };
  wire("Controller", "drive", "Actuator", "command");
  wire("Sensor", "signal", "Controller", "feedback");
  wire("Power supply", "logic", "Controller", "setpoint");
  wire("Power supply", "main", "Actuator", "power");
  wire("Power supply", "main", "Sensor", "power");
  wire("Actuator", "effort", "Process / load", "power");
  wire("Actuator", "tach", "Controller", "feedback");
  void ctl; void sens; void act; void ps; void load; void note;
  return plan;
}

/* ---------- blueprint (starter system) generation ---------- */
function span(a, b, rnd) { return a + rnd() * (b - a); }

function textFor(variants, fallback, rnd) {
  if (variants && variants.length) return pick(variants, rnd);
  return fallback;
}

function slotFor(def, idx, nSlots, rnd) {
  const category = pick(def.categories, rnd);
  const items = PALETTE[category] || FALLBACK_PALETTE;
  const it = pick(items, rnd);
  const ports = (sides) =>
    (sides || []).map(([label, type]) => ({ label: label + (it.kind === "note" ? "" : ""), type }));
  const slot = {
    category,
    title: pick(it.t, rnd),
    kind: it.kind || def.kind || "",
    desc: pick(it.d, rnd),
    inputs: ports(it.in),
    outputs: ports(it.out),
    note: it.kind === "note",
  };
  return slot;
}

const CONNECTOR_HINTS = {
  power: { srcOut: ["+V", "main", "out", "protected", "DC out", "charge", "feed", "discharge", "contact"], dstIn: ["power", "+V", "in", "load+", "charge", "coil+", "power"] },
  control: { srcOut: ["drive", "PWM", "command", "setpoints", "cmd", "actions", "ctrl", "gate"], dstIn: ["cmd", "command", "control", "PWM", "ctrl", "gate", "setpoint"] },
  signal: { srcOut: ["signal", "out", "value", "pos", "angle", "analog", "feedback"], dstIn: ["sensor in", "in", "feedback", "+", "signal", "analog"] },
  data: { srcOut: ["data", "tokens", "results", "consume", "features", "predictions", "clean", "landed"], dstIn: ["data", "writes", "reads", "produce", "features", "jobs", "raw", "queries"] },
  status: { srcOut: ["status", "alerts", "fault", "soc", "trip", "trained", "resolved", "metrics", "tick"], dstIn: ["alerts", "conditions", "status", "guards", "incidents", "telemetry"] },
  network: { srcOut: ["routed", "downlink", "trusted", "backend", "intranet", "answers", "antenna"], dstIn: ["untrusted", "uplink", "requests", "HTTP", "queries", "api", "client", "internet"] },
  motion: { srcOut: ["shaft", "output", "force", "linear", "rotary", "effort", "hold", "mount"], dstIn: ["input", "drive", "load", "rotary", "shaft", "drive"] },
  fluid: { srcOut: ["out", "drain", "branch", "cooled", "air"], dstIn: ["in", "fill", "hot", "line", "in"] },
  heat: { srcOut: ["heat", "waste", "reject", "ambient", "junction", "cold"], dstIn: ["junction", "ambient", "hot", "in", "sense"] },
};

function tryWire(rnd, plan, from, to) {
  const src = typeof from === "string" ? plan.nodes.find((n) => n.title === from) : from;
  const dst = typeof to === "string" ? plan.nodes.find((n) => n.title === to) : to;
  if (!src || !dst || !src.outputs.length || !dst.inputs.length) return null;
  const srcPort = src.outputs[Math.floor(rnd() * src.outputs.length)];
  const dstPort = dst.inputs[Math.floor(rnd() * dst.inputs.length)];
  const addWireRes = addWire(plan, src.id, src.outputs.indexOf(srcPort), dst.id, dst.inputs.indexOf(dstPort));
  if (addWireRes) return { src, dst, type: srcPort.type };
  return null;
}

export function composeTheme(themeDef, opts = {}) {
  const { seed } = opts;
  const rnd = seed != null ? mulberry32(seed) : Math.random;
  const plan = { nodes: [], wires: [], meta: { name: themeDef.name, generated: true } };
  const bySlot = [];
  const slots = themeDef.slots.map((s, i) => ({ ...s, _idx: i, _n: themeDef.slots.length }));
  const place = (s, col, nCols) => {
    const margin = 40, cw = 232, rowH = 150;
    const y = margin + (s._idx % (nCols + 1)) * rowH + span(-8, 8, rnd);
    const x = margin + col * cw + span(-6, 6, rnd);
    const node = addNode(plan, {
      category: s.cat || s.category,
      title: s.title != null ? s.title : textFor(s.t, "Component", rnd),
      kind: s.kind || "",
      desc: s.desc != null ? s.desc : textFor(s.d, "Part of the " + themeDef.name, rnd),
      inputs: (s.in || []).map(([label, type]) => ({ label, type })),
      outputs: (s.out || []).map(([label, type]) => ({ label, type })),
      x, y,
    });
    if (s._idx != null) bySlot[s._idx] = node;
    return node;
  };
  const resolve = (ref) => {
    if (!ref) return null;
    const exact = plan.nodes.find((n) => n.title === ref);
    if (exact) return exact;
    const matches = themeDef.slots
      .map((s, i) => ((s.t || []).includes(ref) ? bySlot[i] : null))
      .filter(Boolean);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return pick(matches, rnd);
    return null;
  };

  for (const s of slots) place(s, s._idx, 6);

  let nextCol = Math.max(...slots.map((s) => s._idx)) + 1;
  for (const c of themeDef.connectors || []) {
    const cat = c.category || pick(["electrical", "data", "control"], rnd);
    const hint = CONNECTOR_HINTS[cat] || { srcOut: [], dstIn: [] };
    if (rnd() < (c.optional === false ? 1 : 0.6)) {
      const fromN = resolve(c.from);
      const toN = resolve(c.to);
      if (!fromN || !toN || !fromN.outputs.length || !toN.inputs.length) continue;
      const slot = slotFor({ categories: [cat], kind: "" }, nextCol, 1, rnd);
      const node = place(slot, nextCol, 6);
      nextCol++;
      plan.meta[c.name] = { from: c.from, to: c.to, via: node.title };
      const w1 = tryWire(rnd, plan, fromN, node);
      const w2 = tryWire(rnd, plan, node, toN);
      if (!w1 || !w2) {
        const idx = plan.nodes.indexOf(node);
        if (idx >= 0) {
          plan.nodes.splice(idx, 1);
          plan.wires = plan.wires.filter((w) => w.src.n !== node.id && w.dst.n !== node.id);
        }
      }
    }
  }

  for (const w of themeDef.wires || []) {
    const from = resolve(w[0]);
    const to = resolve(w[1]);
    if (!from || !to) continue;
    const srcPort = (w[2] != null ? from.outputs.findIndex((p) => p.label === w[2]) : -1);
    const dstPort = (w[3] != null ? to.inputs.findIndex((p) => p.label === w[3]) : -1);
    if (srcPort >= 0 && dstPort >= 0) addWire(plan, from.id, srcPort, to.id, dstPort);
  }

  return plan;
}

export const THEMES = [
  {
    id: "lighting",
    name: "Smart lighting",
    blurb: "A dimmable lighting system: mains → driver → LED strip, with a controller and occupancy sensor in the loop.",
    emoji: "💡",
    color: "#d97706",
    slotGroups: [
      { label: "Power", cats: ["electrical"] },
      { label: "Logic", cats: ["electronics", "control"] },
      { label: "Output", cats: ["electrical"] },
      { label: "Sense", cats: ["electronics"] },
    ],
    slots: [
      { t: ["Power supply", "LED driver"], d: ["Converts mains to a constant-current LED rail", "Smooth dimmable power stage"], kind: "power", cat: "electrical", in: [["power", "power"], ["dim", "control"]], out: [["out", "power"]] },
      { t: ["Controller", "Lighting hub"], d: ["Runs scenes, schedules and the occupancy logic", "Central brain for the lighting system"], kind: "brain", cat: "control", in: [["power", "power"], ["occupancy", "signal"]], out: [["dim", "control"], ["status", "status"]] },
      { t: ["LED strip", "Luminaire"], d: ["The light output of the system", "Addressable warm-white strip"], kind: "load", cat: "electrical", in: [["+V", "power"]], out: [] },
      { t: ["Occupancy sensor", "Motion detector"], d: ["Tells the controller when the room is occupied", "PIR sensor with daylight input"], kind: "sensor", cat: "electronics", in: [["power", "power"]], out: [["occupancy", "signal"]] },
    ],
    connectors: [{ from: "Power supply", to: "Controller", category: "power" }],
    wires: [
      ["Power supply", "LED strip", "out", "+V", 1],
      ["Controller", "LED strip", "dim", "+V"],
      ["Controller", "Power supply", "dim", "dim"],
      ["Occupancy sensor", "Controller", "occupancy", "occupancy"],
      ["Controller", "LED strip", "status", "+V"],
    ],
  },
  {
    id: "robot",
    name: "Robot arm",
    blurb: "A servo robot arm: MCU → motor driver → joint motors, with encoders feeding position back to the controller.",
    emoji: "🦾",
    color: "#db2777",
    slotGroups: [
      { label: "Brain", cats: ["electronics", "control"] },
      { label: "Power", cats: ["electrical", "energy"] },
      { label: "Drive", cats: ["electrical", "mechanical"] },
      { label: "Sense", cats: ["electronics", "mechanical"] },
    ],
    slots: [
      { t: ["MCU", "Robot controller"], d: ["Runs the kinematics and servo loop", "Command receiver for the arm"], kind: "brain", cat: "electronics", in: [["power", "power"], ["cmd", "control"], ["position", "signal"]], out: [["PWM", "control"], ["target", "control"], ["status", "status"]] },
      { t: ["Battery", "Power supply"], d: ["Portable power for the whole arm", "Regulated rail for logic and motors"], kind: "source", cat: "energy", in: [], out: [["main", "power"], ["logic", "power"]] },
      { t: ["Motor driver", "ESC"], d: ["Converts PWM into motor drive current", "Handles stall and over-current"], kind: "power", cat: "electrical", in: [["power", "power"], ["PWM", "control"]], out: [["drive", "power"], ["fault", "status"]] },
      { t: ["Joint motor", "Servo"], d: ["Moves one arm joint", "Position-controlled gearmotor"], kind: "actuator", cat: "electrical", in: [["power", "power"], ["cmd", "control"]], out: [["shaft", "motion"], ["tach", "status"]] },
      { t: ["Encoder", "Joint sensor"], d: ["Measures the joint angle for closed-loop control", "Quadrature encoder on the output shaft"], kind: "sensor", cat: "mechanical", in: [["shaft", "motion"], ["power", "power"]], out: [["position", "signal"], ["count", "data"]] },
    ],
    connectors: [{ from: "Battery", to: "Motor driver", category: "power" }, { from: "Joint motor", to: "Encoder", category: "motion" }],
    wires: [
      ["Battery", "MCU", "logic", "power"],
      ["Battery", "Motor driver", "main", "power"],
      ["MCU", "Motor driver", "PWM", "PWM"],
      ["Motor driver", "Joint motor", "drive", "power"],
      ["MCU", "Joint motor", "target", "cmd"],
      ["Encoder", "MCU", "position", "position"],
    ],
  },
  {
    id: "webapp",
    name: "Web app",
    blurb: "A modern web architecture: browser → gateway → services, with a queue, database and monitoring around them.",
    emoji: "🌐",
    color: "#2563eb",
    slotGroups: [
      { label: "Edge", cats: ["network", "software"] },
      { label: "Services", cats: ["software"] },
      { label: "Data", cats: ["data", "software"] },
      { label: "Ops", cats: ["software", "data"] },
    ],
    slots: [
      { t: ["Browser", "Mobile app"], d: ["The user's entry point into the system", "Client that talks to the gateway"], kind: "client", cat: "software", in: [["api", "network"]], out: [["requests", "network"]] },
      { t: ["API gateway", "Edge router"], d: ["Routes, rate-limits and authenticates", "Single entry point for all clients"], kind: "service", cat: "network", in: [["client", "network"]], out: [["backend", "network"], ["mgmt", "network"]] },
      { t: ["Auth service", "Identity provider"], d: ["Issues and validates sessions and tokens", "Handles login and consent"], kind: "service", cat: "software", in: [["requests", "network"]], out: [["tokens", "data"]] },
      { t: ["API service", "Core service"], d: ["Implements the business logic", "Serves the main application API"], kind: "service", cat: "software", in: [["routed", "network"], ["users", "data"], ["jobs", "data"]], out: [["responses", "network"], ["events", "data"]] },
      { t: ["Database", "Primary DB"], d: ["Durable storage for system state", "Transactional source of truth"], kind: "store", cat: "data", in: [["writes", "data"], ["reads", "data"]], out: [["results", "data"]] },
      { t: ["Queue", "Event bus"], d: ["Decouples API from background work", "Holds jobs for the workers"], kind: "service", cat: "software", in: [["produce", "data"]], out: [["consume", "data"]] },
      { t: ["Worker", "Batch processor"], d: ["Runs async jobs off the queue", "Sends email and builds reports"], kind: "service", cat: "software", in: [["jobs", "data"]], out: [["results", "data"], ["metrics", "status"]] },
      { t: ["Monitoring", "Log store"], d: ["Collects metrics, logs and traces", "Dashboard for the whole system"], kind: "ops", cat: "software", in: [["telemetry", "data"], ["logs", "data"]], out: [["alerts", "status"]] },
    ],
    connectors: [{ from: "Auth service", to: "API service", category: "data" }],
    wires: [
      ["Browser", "API gateway", "requests", "client"],
      ["API gateway", "API service", "backend", "routed"],
      ["API gateway", "Auth service", "backend", "requests"],
      ["API service", "Database", "events", "writes"],
      ["API service", "Queue", "events", "produce"],
      ["Queue", "Worker", "consume", "jobs"],
      ["Worker", "Database", "results", "reads"],
      ["API service", "Monitoring", "responses", "telemetry"],
      ["Worker", "Monitoring", "metrics", "telemetry"],
    ],
  },
  {
    id: "solar",
    name: "Solar install",
    blurb: "An off-grid solar system: panels → charge controller → battery bank → inverter, with the home loads on the AC side.",
    emoji: "☀️",
    color: "#65a30d",
    slotGroups: [
      { label: "Source", cats: ["energy"] },
      { label: "Store", cats: ["energy", "electrical"] },
      { label: "Convert", cats: ["energy", "electrical"] },
      { label: "Loads", cats: ["electrical"] },
    ],
    slots: [
      { t: ["Solar array", "Panel string"], d: ["Converts sunlight into DC power", "Series string of panels facing the sun"], kind: "source", cat: "energy", in: [["sun", "signal"]], out: [["DC out", "power"]] },
      { t: ["Charge controller", "MPPT"], d: ["Extracts max power and protects the battery", "Manages the charge curve"], kind: "power", cat: "energy", in: [["in", "power"]], out: [["out", "power"], ["soc", "status"]] },
      { t: ["Battery bank", "Lithium pack"], d: ["Stores energy for night and clouds", "12V battery bank with BMS"], kind: "store", cat: "energy", in: [["charge", "power"]], out: [["discharge", "power"], ["soc", "status"]] },
      { t: ["Inverter", "Hybrid inverter"], d: ["Converts DC into household AC", "Grid or off-grid AC output"], kind: "power", cat: "energy", in: [["DC", "power"], ["enable", "control"]], out: [["AC", "power"]] },
      { t: ["House loads", "Appliance"], d: ["Everything that consumes the AC power", "Lights, fridge, outlets"], kind: "load", cat: "electrical", in: [["AC", "power"]], out: [] },
    ],
    connectors: [{ from: "Solar array", to: "Charge controller", category: "power" }],
    wires: [
      ["Solar array", "Charge controller", "DC out", "in"],
      ["Charge controller", "Battery bank", "out", "charge"],
      ["Battery bank", "Inverter", "discharge", "DC"],
      ["Inverter", "House loads", "AC", "AC"],
    ],
  },
  {
    id: "hydraulic",
    name: "Hydraulic press",
    blurb: "A hydraulic press: motor → pump → valves → cylinder, with pressure and position feedback to the controller.",
    emoji: "⚙️",
    color: "#0284c7",
    slotGroups: [
      { label: "Drive", cats: ["mechanical", "electrical"] },
      { label: "Fluid", cats: ["fluid"] },
      { label: "Work", cats: ["fluid", "mechanical"] },
      { label: "Sense", cats: ["fluid", "electronics"] },
    ],
    slots: [
      { t: ["Motor", "Drive motor"], d: ["Powers the hydraulic pump", "Three-phase or DC drive"], kind: "actuator", cat: "electrical", in: [["power", "power"], ["start", "control"]], out: [["shaft", "motion"]] },
      { t: ["Pump", "Hydraulic pump"], d: ["Turns shaft rotation into fluid pressure", "Variable displacement pump"], kind: "actuator", cat: "fluid", in: [["drive", "motion"]], out: [["out", "fluid"]] },
      { t: ["Valve", "Proportional valve"], d: ["Directs flow to the cylinder", "Electrically controlled spool valve"], kind: "actuator", cat: "fluid", in: [["in", "fluid"], ["ctrl", "control"]], out: [["out", "fluid"], ["pos", "status"]] },
      { t: ["Cylinder", "Ram"], d: ["Converts fluid pressure into linear force", "The pressing element"], kind: "actuator", cat: "fluid", in: [["A port", "fluid"], ["B port", "fluid"]], out: [["force", "motion"], ["pos", "status"]] },
      { t: ["Pressure sensor", "Flow meter"], d: ["Reports line pressure to the controller", "Verifies flow through the circuit"], kind: "sensor", cat: "fluid", in: [["line", "fluid"], ["power", "power"]], out: [["pressure", "signal"]] },
      { t: ["PLC", "Press controller"], d: ["Runs the press cycle sequence", "Supervises the whole process"], kind: "brain", cat: "control", in: [["power", "power"], ["pressure", "signal"], ["pos", "status"]], out: [["ctrl", "control"], ["start", "control"]] },
    ],
    connectors: [{ from: "Pump", to: "Valve", category: "fluid" }, { from: "Pressure sensor", to: "PLC", category: "signal" }],
    wires: [
      ["Motor", "Pump", "shaft", "drive"],
      ["Pump", "Valve", "out", "in"],
      ["Valve", "Cylinder", "out", "A port"],
      ["Cylinder", "Pressure sensor", "pos", "line"],
      ["Pressure sensor", "PLC", "pressure", "pressure"],
      ["PLC", "Valve", "ctrl", "ctrl"],
      ["PLC", "Motor", "start", "start"],
    ],
  },
];

export const THEME_DEFAULTS = {
  lighting: "Smart lighting",
  robot: "Robot arm",
  webapp: "Web app",
  solar: "Solar install",
  hydraulic: "Hydraulic press",
};

// ai.js — turns a plain-language brief into a diagram spec: builds the prompt
// for the text model and parses/repairs its JSON reply.

export const SCHEMA = `You convert a plain-language description into a structured diagram.

Reply with ONE single JSON object only. No markdown fences, no commentary, no trailing prose — the entire reply must be one valid JSON object, nothing else. Do not wrap it in a code block.

THE JSON SHAPE (for every diagram EXCEPT sequence):
{
  "title": "short diagram title",
  "type": "flowchart | tree | mindmap | architecture | network | sequence",
  "nodes": [
    {"id": "a1", "label": "Short label", "sub": "optional small caption", "kind": "process"}
  ],
  "edges": [
    {"from": "a1", "to": "a2", "label": "optional", "style": "solid"}
  ]
}

PICK TYPE BY WHAT THE DESCRIPTION ASKS FOR:
- flowchart — a process, workflow, algorithm, decision procedure, or steps that happen in order (left to right).
- tree — an org chart, taxonomy, hierarchy, dependency tree, or anything that branches strictly top-down with one clear parent per item.
- mindmap — brainstorming, exploring one central topic/idea with subtopics (root concept with free branches).
- architecture — a system, app, platform or deployment: components talking to each other across layers/zones.
- network — a topology of entities and connections (office network, cloud services, data entities, relationships), where nothing is inherently sequential.
- sequence — actors exchanging messages over time (API calls, user actions, protocols, order flows).

NODE KINDS (choose the shape that fits each node): start, end, process, decision, data, database, document, note, cloud, person, server, device.
- start/end for first/last steps in flows; decision for yes/no or question points; data for inputs/outputs; database for stored data; person for users/clients/humans; cloud for the internet/external services; server for machines/services; note for a remark.

RULES:
- 8 to 26 nodes. For very simple descriptions fewer is fine. Do not invent irrelevant steps — follow the description.
- Labels: short (2–4 words), lowercase, no trailing punctuation, no quotes. Put details in "sub" (1–6 words) as a second line instead.
- Every "from"/"to" must reference an existing node id. Ids: short letters+numbers, unique.
- Keep edges acyclic (flow forward). Edges may use "style": "dashed" for optional/async/return paths, else "solid".
- For architecture, add "band": "Presentation layer" etc to each node when the description implies distinct tiers/zones (users / frontend / backend / data / third-party...). Keep band names short, repeated exactly across nodes.
- mindmap/tree/network diagrams need few or no edges unless relations are explicit: mindmap = one central topic node with edges to subtopics.
- When the description says "as a flowchart/mindmap/org chart/..." use that type.

SEQUENCE DIAGRAMS instead use:
{"title":"...","type":"sequence",
 "actors":[{"id":"u","label":"User"},{"id":"s","label":"Server"}],
 "messages":[{"from":"u","to":"s","label":"GET /login","style":"solid"},{"from":"s","to":"u","label":"200 OK","style":"dashed"}]}
- 2–6 actors, 4–12 messages in chronological order. "from"/"to" are actor ids. style "solid" for requests/calls, "dashed" for replies/results.`;

export function buildPrompt(description, typeHint) {
  const hint = typeHint && typeHint !== "auto"
    ? `\nThe user explicitly wants the type "${typeHint}", so use "type": "${typeHint}" (unless they asked for a sequence with actors — then keep type sequence).\n`
    : "";
  return `${SCHEMA}

THE DESCRIPTION TO DIAGRAM:
<DESCRIPTION>
${description}
</DESCRIPTION>${hint}
Convert that description into the JSON object now. Remember: reply with only the JSON object.`;
}

export function buildRetryPrompt(description, typeHint, badText, errorMsg) {
  return `${buildPrompt(description, typeHint)}

Your previous reply could not be parsed as JSON (${errorMsg}). It was:
"""
${String(badText).slice(0, 600)}
"""
Send only valid JSON this time.`;
}

export function buildRegeneratePrompt(description, typeHint, currentGraph) {
  const cur = currentGraph ? JSON.stringify(currentGraph).slice(0, 2600) : "(none)";
  return `${buildPrompt(description, typeHint)}\n\nThe user pressed "regenerate": they want a new version of this diagram. Here is the previous draft as JSON:\n"""\n${cur}\n"""\nProduce an improved draft of the SAME topic: clearer short labels, a sensible node set and structure for the type, and no clutter. Keep the same overall subject. Reply with only the JSON object.`;
}

// ---- tolerant JSON extraction ---------------------------------------------

function extractJSON(text) {
  const t = String(text ?? "");
  const noFence = t.replace(/```(?:json)?/gi, "").replace(/```/g, "");
  const start = noFence.indexOf("{");
  if (start === -1) throw new Error("no { found in the reply");
  // balanced scan
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < noFence.length; i++) {
    const c = noFence[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return noFence.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced braces in the reply");
}

function unquoteKeys(s) {
  return s.replace(/([,{]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
}

function stripComments(s) {
  return s.replace(/\/\/[^\n"]*?(?=\n|$)/g, "");
}

function swapSingleQuotes(s) {
  // Convert single-quoted strings to double-quoted, tracking whether we're
  // inside a string; apostrophes inside words survive because they are not
  // between a delimiter boundary pair.
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"') {
      out += c; i++;
      while (i < n) { const d = s[i]; out += d; i++; if (d === "\\") { if (i < n) { out += s[i]; i++; } } else if (d === '"') break; }
      continue;
    }
    if (c === "'") {
      // find the closing quote — allow contractions by scanning to the next
      // "'" that is followed by ",", "}", "]", ":", or whitespace + ,/}
      const nextQ = s.indexOf("'", i + 1);
      const probe = nextQ === -1 ? "" : s.slice(nextQ + 1, nextQ + 3);
      const closes = probe[0] === undefined || /[,}\]:\s]/.test(probe[0]) || (probe[0] === " " && /[,}\]:]/.test(probe.trim()[0] || ""));
      if (nextQ !== -1 && closes) {
        out += '"' + s.slice(i + 1, nextQ).replace(/"/g, '\\"') + '"';
        i = nextQ + 1;
      } else {
        out += c; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function applyRepairs(s) {
  let r = stripComments(s);
  r = r.replace(/,\s*([}\]])/g, "$1"); // trailing commas
  r = unquoteKeys(r);
  r = r.replace(/\b(True|False|None)\b/g, (m) => m.toLowerCase() === "true" ? "true" : m.toLowerCase() === "false" ? "false" : "null");
  r = r.replace(/([{,]\s*)("?)([^"{}:,\s]+)("?)\s*:/g, '$1"$3":'); // any remaining unquoted key form
  r = swapSingleQuotes(r);
  return r;
}

export function parseDiagramJSON(text) {
  let candidate = null, err = null;
  try {
    candidate = extractJSON(text);
    return JSON.parse(candidate);
  } catch (e) {
    err = e.message;
  }
  try {
    const repaired = applyRepairs(candidate || text);
    return JSON.parse(repaired);
  } catch (e2) {
    throw new Error(`${err} (repair also failed: ${e2.message})`);
  }
}

// ---- sample graphs (used for offline testing & instant examples) ----------

export function sampleGraph(kind) {
  if (kind === "sequence") {
    return {
      title: "Placing an order online",
      type: "sequence",
      actors: [
        { id: "u", label: "Shopper" },
        { id: "w", label: "Web app" },
        { id: "a", label: "Payments API" },
        { id: "d", label: "Database" },
      ],
      messages: [
        { from: "u", to: "w", label: "press 'place order'", style: "solid" },
        { from: "w", to: "d", label: "reserve stock", style: "solid" },
        { from: "d", to: "w", label: "stock reserved", style: "dashed" },
        { from: "w", to: "a", label: "POST /charge", style: "solid" },
        { from: "a", to: "w", label: "charge ok", style: "dashed" },
        { from: "w", to: "u", label: "order confirmed", style: "dashed" },
      ],
    };
  }
  if (kind === "mindmap") {
    return {
      title: "A good morning routine",
      type: "mindmap",
      nodes: [
        { id: "r", label: "Morning routine", kind: "start" },
        { id: "a", label: "Wake up early", kind: "process" },
        { id: "b", label: "Move your body", kind: "process" },
        { id: "c", label: "Feed the brain", kind: "process" },
        { id: "d", label: "Plan the day", kind: "process" },
        { id: "b1", label: "Stretch", kind: "process" },
        { id: "b2", label: "Walk outside", kind: "process" },
        { id: "c1", label: "Read 10 pages", kind: "process" },
        { id: "c2", label: "Journal", kind: "process" },
        { id: "d1", label: "Top 3 tasks", kind: "process" },
        { id: "a1", label: "No phone first", kind: "note" },
      ],
      edges: [
        { from: "r", to: "a", label: "" }, { from: "r", to: "b", label: "" },
        { from: "r", to: "c", label: "" }, { from: "r", to: "d", label: "" },
        { from: "a", to: "a1", label: "" }, { from: "b", to: "b1", label: "" },
        { from: "b", to: "b2", label: "" }, { from: "c", to: "c1", label: "" },
        { from: "c", to: "c2", label: "" }, { from: "d", to: "d1", label: "" },
      ],
    };
  }
  if (kind === "tree") {
    return {
      title: "Game studio studio",
      type: "tree",
      nodes: [
        { id: "ceo", label: "Studio head", kind: "person" },
        { id: "prod", label: "Production", kind: "process" },
        { id: "art", label: "Art", kind: "process" },
        { id: "eng", label: "Engineering", kind: "process" },
        { id: "pm", label: "Producer", kind: "person" },
        { id: "qa", label: "QA lead", kind: "person" },
        { id: "2d", label: "2D artists", kind: "person" },
        { id: "3d", label: "3D artists", kind: "person" },
        { id: "anim", label: "Animators", kind: "person" },
        { id: "cl", label: "Client team", kind: "person" },
        { id: "sv", label: "Server team", kind: "person" },
        { id: "tools", label: "Tools", kind: "person" },
      ],
      edges: [
        { from: "ceo", to: "prod" }, { from: "ceo", to: "art" }, { from: "ceo", to: "eng" },
        { from: "prod", to: "pm" }, { from: "prod", to: "qa" },
        { from: "art", to: "2d" }, { from: "art", to: "3d" }, { from: "art", to: "anim" },
        { from: "eng", to: "cl" }, { from: "eng", to: "sv" }, { from: "eng", to: "tools" },
      ],
    };
  }
  if (kind === "architecture") {
    return {
      title: "Chat app deployment",
      type: "architecture",
      nodes: [
        { id: "u", label: "Visitors", kind: "person", band: "Users" },
        { id: "dns", label: "CDN", kind: "cloud", band: "Edge" },
        { id: "web", label: "Web app", kind: "server", band: "Edge" },
        { id: "api", label: "API service", kind: "server", band: "Application" },
        { id: "ws", label: "Realtime hub", kind: "server", band: "Application" },
        { id: "worker", label: "Job workers", kind: "server", band: "Application" },
        { id: "pg", label: "Postgres", kind: "database", band: "Data" },
        { id: "redis", label: "Redis cache", kind: "database", band: "Data" },
        { id: "s3", label: "Object storage", kind: "cloud", band: "Data" },
        { id: "push", label: "Push service", kind: "cloud", band: "Third party" },
      ],
      edges: [
        { from: "u", to: "dns", label: "https" },
        { from: "dns", to: "web" },
        { from: "web", to: "api" },
        { from: "api", to: "ws" },
        { from: "ws", to: "worker", label: "events" },
        { from: "api", to: "pg" },
        { from: "api", to: "redis" },
        { from: "worker", to: "s3" },
        { from: "ws", to: "push", style: "dashed" },
      ],
    };
  }
  if (kind === "network") {
    return {
      title: "Small office network",
      type: "network",
      nodes: [
        { id: "modem", label: "Modem / router", kind: "server" },
        { id: "switch", label: "Switch", kind: "server" },
        { id: "wifi", label: "Wi-Fi AP", kind: "cloud" },
        { id: "file", label: "File server", kind: "database" },
        { id: "printer", label: "Printer", kind: "device" },
        { id: "desks", label: "Desk computers", kind: "server" },
        { id: "laptops", label: "Laptops", kind: "device" },
        { id: "nas", label: "NAS backup", kind: "database" },
        { id: "isp", label: "Internet", kind: "cloud" },
      ],
      edges: [
        { from: "modem", to: "isp" },
        { from: "modem", to: "switch" },
        { from: "switch", to: "wifi" },
        { from: "switch", to: "file" },
        { from: "switch", to: "printer" },
        { from: "switch", to: "desks" },
        { from: "wifi", to: "laptops" },
        { from: "file", to: "nas", style: "dashed" },
      ],
    };
  }
  return {
    title: "Support ticket triage",
    type: "flowchart",
    nodes: [
      { id: "a", label: "Ticket arrives", kind: "start" },
      { id: "b", label: "Auto-classify", kind: "process" },
      { id: "c", label: "Urgent?", kind: "decision" },
      { id: "d", label: "Page the on-call", kind: "process" },
      { id: "e", label: "Normal queue", kind: "process" },
      { id: "f", label: "Investigate & fix", kind: "process" },
      { id: "g", label: "Resolved?", kind: "decision" },
      { id: "h", label: "Ticket closed", kind: "end" },
      { id: "n", label: "SLA: 4 hours", kind: "note" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "d", label: "yes" },
      { from: "c", to: "e", label: "no" },
      { from: "d", to: "f" },
      { from: "e", to: "f" },
      { from: "f", to: "g" },
      { from: "g", to: "h", label: "yes" },
      { from: "c", to: "n", style: "dashed" },
    ],
  };
}

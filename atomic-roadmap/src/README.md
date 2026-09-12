# Atomic Roadmap

A Perchance generator that decomposes a project concept into an **atomic, phased task backlog** for AI coding agents, gated behind a strict planning-first hold. It can also emit a ready-to-paste **starter prompt** that bundles a roadmap with a chosen page template.

## Files
- `main.pjs` — generator config only: title, `$meta`, and `generateText = {import:ai-text-plugin}`.
- `index.html` — the whole UI: styles (adapted from `rathji-template`), settings panel, share links, the three modes (New Project / Expand Backlog / Starter Prompt), and all client JS.
- `src/system-prompt.js` — the system prompt loaded by index.html before generation. **Kept in `src/` (not main.pjs) so the markdown is preserved byte-for-byte without Perchance evaluating square/curly brackets.**

> Gotcha: `src/system-prompt.js` is a JS template literal. Literal backticks inside it must be written as a single backslash + backtick. A naive rewrite that doubles the backslash produces a syntax error; verify backtick counts after editing.

## System prompt structure
`window.atomicRoadmapSystemPrompt` (all agents) defines:
- Core Operating Principles (end-result focus, atomic granularity, strict hold, zero fluff).
- **Phase Structure Rules** applied to every roadmap:
  - Rule A — tasks are grouped into numbered phases.
  - Rule B — every phase except the final one ends with a `[Code review]` task (review → fix → confirm tests pass).
  - Rule C — the final phase is always the fixed **four-task** set: `[Code review]` (whole project) → `[User instructions]` → `[Cleanup]` (remove the persisted `src/ROADMAP.md` / `CLAUDE.md` checklist so it does not ship) → `[Polish pass]`.
  - Rule D — expansion inserts new phases before the final phase and keeps numbering sequential (never exceeds 15 phases).
  - Rule E — phase count and task counts scale with the project: the roadmap must **specify its shape up front** (`This roadmap has N phases, with 5–10 tasks in each.`), may never exceed **15 phases**, and every non-final phase carries **5–10 tasks** (its closing code review counts as the last one). Task descriptions stay to one tight sentence, but the model must emit the roadmap in full rather than compressing it.
  - Rule F — **template/scaffold projects** (template, scaffold, base, boilerplate, starter, or "clone into new members") must include a dedicated documentation-and-handoff phase immediately before the final phase: a shipped README/spec, the explicit customization points, and a step-by-step clone/instantiate guide.
- Mode 1 (kickoff) and Mode 2 (expansion) response templates.
- The checklist is persisted in **durable project storage** (a `CLAUDE.md` at the project root, or a file under `src/` such as `src/ROADMAP.md`) — not ephemeral scratch. Implementations decide their own file.

`window.atomicRoadmapPerchanceAddendum` (appended **only** when the target agent is *Perchance AI Helper*) adds a small Perchance-specific layer on top:
- **A. Generator identity** — Phase 1 must set name, kebab-case stub/slug, and `$meta.title`/`$meta.description`.
- **B. Reference template (optional, and always a live pointer)** — a standalone `Reference template: <name>` line is **mandatory** for Perchance roadmaps and must sit immediately under the `### Core Framework Tasks` heading (before Phase 1), never folded into a task. Use the provided name, or `Reference template: none (…plain HTML/CSS/JS)`, or let the agent choose. It is a **live pointer** consulted at build time (the agent reads the named generator's current source), never a frozen snapshot of that generator's current state.
- **C. Durable storage** — for Perchance this is the `src/` tree (e.g. `src/ROADMAP.md`); since everything under `src/` ships publicly, the final phase's `[Cleanup]` task removes the checklist once the project is finished.
- **D. Required platform rules** — responsive (phone + desktop), set `$meta.image` (especially for canvas/WebGL), and never put secrets in source (everything is public).
- **E. Tailored reviews** — each phase's code review must also confirm the live preview loads with no console errors and is checked at phone + desktop widths.
All other implementation decisions are deliberately left to the agent.

## UI notes
- **Agent dropdown** (`#agentSelect`): *Perchance AI Helper* is the built-in default and first option.
- **"Always use this agent by default"** (`#agentDefaultToggle`): persists the chosen agent under localStorage key `atomicRoadmapDefaultAgent`; unchecking reverts to the built-in default.
- **Reference template** (`#refTemplateInput`, shown only for the Perchance agent, and hidden in Starter Prompt mode): optional, persisted under `atomicRoadmapRefTemplate`, and injected as a `Reference template:` line in the request.
- Share links encode `?concept=&mode=&agent=&ref=` (agent omitted when it equals the current default).
- Output: a badge marks Perchance-optimized roadmaps, the download filename gains a `-perchance` suffix, and JSON exports include `agent` and `template`.
- Settings (theme/accent/size/motion) persist under `atomicRoadmapSettings`.
- **Starter Prompt mode** (`buildStarterPrompt`): bundles a chosen template's setup instructions with the current roadmap. Step 1 persists the checklist to `src/ROADMAP.md` (durable, not `main.pjs`) and Step 5 removes it before shipping.

## Known behavior
- A single `generateText` call truncates at roughly 4.5 KB. To support roadmaps up to 15 phases / 5–10 tasks each, **New Project and Expand Backlog mode auto-continue**: `runGeneration()` calls `generateText` repeatedly, passing the text produced so far as `startWith` (identical `instruction` every time, so prefix caching applies), until `looksComplete()` sees the fixed final trio (kickoff) or a clean final line (expand) — up to `MAX_PARTS` (8) parts, with a no-new-content guard. Expansions are stitched by simply using each call's `.text` (which already includes `startWith`). A `genToken` counter cancels stale loops when a new generation starts. Progress is shown as "part N" in the status line.
- The model sizes the roadmap to the project (e.g. a large CRM concept produced 8 phases / 45 tasks across 2 parts); small projects stay small.

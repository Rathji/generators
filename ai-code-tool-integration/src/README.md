# ai-code-tool-integration

Perchance plugin generator bridging a local dev workspace and a 3rd-party AI
coding platform (context sync → prompt dispatch → parsed code application,
gated by user approval, logged for rollback).

## Project state

- This generator is built on the **rathji-plugin-template** structure
  (https://perchance.org/rathji-plugin-template — re-fetch with the
  `fetch_generator` tool if the reference copy in scratch/ is gone).
- **Current status: all 12 modules are implemented and validated.** Feature
  code is in `main.pjs` (session handle + pluggable auth handshake +
  heartbeat controller with backoff reconnect + per-user credential store
  over kv-plugin with localStorage/memory fallbacks +
  `aiCodeToolIntegrationIndexTree` / `aiCodeToolIntegrationTreeStats`
  structural workspace index + `Inject` targeted content injection +
  `aiCodeToolIntegrationTokenEstimate` / `Budget` token accounting +
  `Dispatch` prompt dispatcher (default chat/completions transport with SSE
  streaming, pluggable) + `aiCodeToolIntegrationParse` response parser
  (prose + fence blocks with lang/path/line ranges) + `Apply` file
  application (overwrite / insert, dry-run or routed through the gate) +
  `Gate` approval chokepoint (pending/approve/reject/approveAll, shared LCS
  line diff, event history) + `Log` append-only audit trail with rollback
  over kv-plugin (persists across reloads) + `Errors` error bridge
  (status/code → severity + userMessage + action, central notify hook,
  shared default controller that every constructed error funnels through);
  the plugin's docs/live-demo page is `index.html` (Modules 1–12 sections,
  "How it works" architecture overview, quick-start + end-to-end walkthroughs,
  code samples and live demos).
- The whole pipeline is a single loop: authenticate (1) → heartbeat (2) →
  credential store (3) → index (4) → inject (5) → budget (6) → dispatch (7)
  → parse (8) → apply (9) → gate (10) → log/rollback (11) → errors (12).
  Every step returns a typed, never-thrown `{ok:false, code, message,
  severity, userMessage, action}`-style object.
- The original atomic implementation roadmap (the 12-task checklist that
  drove the build) was **deleted from `src/ai-code-tool-integration.pjs`**
  once every item was done; the plan is fully reflected in the module
  structure of `main.pjs` and the docs in `index.html`.
- Template naming rule applies: exported helpers are prefixed
  `aiCodeToolIntegration*`, thin never-throw `$output`, helpers reachable via
  `root.<name>` for tests.
- **Perchance gotcha (recorded during Module 4):** every string in the
  engine gets an `evaluateItem` getter that template-evaluates the string,
  so reading values out of plain data objects must NOT call `.evaluateItem`
  on primitive strings — only on pjs list nodes (objects). It will silently
  re-parse `{...}` / `[...]` content and can raise spurious engine errors.
  `aiCodeToolIntegrationResolve` centralizes this rule: objects resolve,
  primitives pass through.
- **Perchance gotcha (Module 12):** the base error constructor
  `aiCodeToolIntegrationError` now lazily creates and captures into the
  shared default errors controller (`window.AI_CODE_TOOL_INTEGRATION_ERRORS`),
  so any plugin error is visible to `aiCodeToolIntegrationErrors().setNotify()`
  even before the consumer has created a controller. Nothing recursive: the
  controller's `_record`/`capture` never re-enter the base constructor.

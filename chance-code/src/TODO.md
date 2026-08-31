# tinker-chance — TODO

## Core build
- [x] Reference Perchance documentation (platform skill, ai-text skill, live page inspection)
- [x] Write SPEC.md / README.md / TODO.md
- [x] src/kb.js — knowledge base (architecture, execution model, globals, APIs, gotchas, plugins, TM patterns)
- [x] src/userscript-template.js — base Tampermonkey template
- [x] main.pjs — imports (ai-text-plugin, super-fetch-plugin) + config + lists
- [x] index.html — UI: tabs, Script Builder form, Q&A chat, streaming output, copy/download
- [x] Fetch-target-source feature (public API → ground selectors)
- [x] Prompt design: script-builder prompt, Q&A prompt (prefix-cache friendly)
- [x] new Function syntax-check on generated scripts
- [x] Error-driven auto-repair loop (up to 3 attempts, feeds exact syntax error back to model)
- [x] Prompt preemption: template literals for multi-line strings (model weakness)

## Verification
- [x] page_refresh + live test of both modes
- [x] Vision-check layout at phone (390x844) and desktop (1920x1080)
- [x] Confirm no perchanceErrors / console errors
- [x] Copy-to-clipboard + .user.js download verified (blob created, clipboard works)

## Polish
- [x] Copy-to-clipboard + .user.js download buttons
- [x] Loading indicators (spinner + phase text)
- [x] Dark-mode friendly styling
- [x] Tutorial tab: quickstart steps + annotated anatomy
- [x] Reference library in src/guides/ (quickstart.md, patterns.md, faq.md) with View/Download/direct-link
- [x] Direct links card (official docs, API endpoints, community, generator source)
- [x] Fixed hidden-attribute override bug (`.modal[hidden]`) and phone tab overflow

## Possibilities (not committed — user picking & choosing)
- [ ] kv-plugin persistence of chat history (survives reloads)
- [ ] "Regenerate" / "edit this script" follow-up buttons on a generated script (re-prompt with prior script as context)
- [ ] Syntax highlighting for the generated code view
- [ ] Render markdown in the file-viewer modal
- [ ] Merge features from the user's other generators into tinker-chance (WHICH generators / what features? TBD — ask user)
- [ ] Others the user proposes

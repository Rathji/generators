// Obsidian's default look — a minimal base stylesheet injected into the preview
// iframe BEFORE the theme's own CSS, so themes that only override a few CSS
// variables still render like real Obsidian. The theme CSS comes after and wins.

export const OBSIDIAN_BASE_CSS = `/* ---- Obsidian default variables ---- */
body.theme-dark {
  color-scheme: dark;
  --background-primary:#1e1e1e;
  --background-primary-alt:#2a2a2a;
  --background-secondary:#1e1e1e;
  --background-secondary-alt:#232323;
  --background-modifier-border:#3f3f3f;
  --background-modifier-border-hover:#4d4d4d;
  --background-modifier-hover:rgba(255,255,255,0.07);
  --background-modifier-active-hover:rgba(255,255,255,0.13);
  --interactive-accent:#6c7cf0;
  --interactive-accent-hover:#7a89f2;
  --text-normal:#dbdbdb;
  --text-muted:#9c9c9c;
  --text-faint:#6b6b6b;
  --text-accent:#7ea6ff;
  --text-on-accent:#ffffff;
  --text-error:#ff6b6b;
  --text-selection:rgba(108,124,240,0.3);
  --titlebar-background:#1e1e1e;
  --titlebar-background-focused:#1e1e1e;
  --divider-color:#3f3f3f;
  --code-background:#262626;
  --code-normal:#dbdbdb;
  --blockquote-border-color:#6c7cf0;
  --blockquote-color:#9c9c9c;
  --table-border-color:#3f3f3f;
  --tag-background:rgba(108,124,240,0.18);
  --tag-color:#8ea5ff;
  --callout-background:rgba(255,255,255,0.03);
}
body.theme-light {
  color-scheme: light;
  --background-primary:#ffffff;
  --background-primary-alt:#f5f5f5;
  --background-secondary:#f5f5f5;
  --background-secondary-alt:#e8e8e8;
  --background-modifier-border:#d9d9d9;
  --background-modifier-border-hover:#c5c5c5;
  --background-modifier-hover:rgba(0,0,0,0.05);
  --background-modifier-active-hover:rgba(0,0,0,0.09);
  --interactive-accent:#6c7cf0;
  --interactive-accent-hover:#5a6cef;
  --text-normal:#1f1f1f;
  --text-muted:#6f6f6f;
  --text-faint:#9a9a9a;
  --text-accent:#4066b5;
  --text-on-accent:#ffffff;
  --text-error:#d63c3c;
  --text-selection:rgba(108,124,240,0.25);
  --titlebar-background:#ffffff;
  --titlebar-background-focused:#ffffff;
  --divider-color:#d9d9d9;
  --code-background:#f4f4f4;
  --code-normal:#1f1f1f;
  --blockquote-border-color:#6c7cf0;
  --blockquote-color:#6f6f6f;
  --table-border-color:#d9d9d9;
  --tag-background:rgba(108,124,240,0.12);
  --tag-color:#4050c0;
  --callout-background:rgba(0,0,0,0.03);
}

/* ---- shared base tokens ---- */
body {
  --font-text:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Helvetica Neue", sans-serif;
  --font-ui:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
  --font-monospace:"SF Mono", "Cascadia Code", "Fira Code", ui-monospace, Consolas, monospace;
  --font-text-size:16px;
  --file-line-width:720px;
  --h1-size:1.9em; --h2-size:1.5em; --h3-size:1.25em; --h4-size:1.05em; --h5-size:1em; --h6-size:1em;
  --h1-weight:700; --h2-weight:700; --h3-weight:600; --h4-weight:600; --h5-weight:600; --h6-weight:600;
}

/* ---- app chrome ---- */
html, body { margin:0; height:100%; }
body {
  font-family:var(--font-text);
  font-size:var(--font-text-size);
  background:var(--background-primary);
  color:var(--text-normal);
}
.workspace { display:flex; flex-direction:row; height:100vh; width:100vw; overflow:hidden; }
.workspace-main { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; }
.workspace-split.mod-root { flex:1; min-width:0; min-height:0; display:flex; flex-direction:row; }

.workspace-ribbon {
  width:44px; flex:none;
  display:flex; flex-direction:column; align-items:center; gap:4px;
  padding-top:8px;
  background:var(--background-secondary);
  border-right:1px solid var(--divider-color);
  color:var(--text-muted);
}
.clickable-icon {
  width:32px; height:32px; display:flex; align-items:center; justify-content:center;
  border-radius:6px; color:var(--text-muted); cursor:pointer;
}
.clickable-icon:hover { background:var(--background-modifier-hover); color:var(--text-normal); }
.clickable-icon svg { width:18px; height:18px; }

.workspace-split { flex:1; min-width:0; min-height:0; display:flex; }
.mod-left-split { flex:0 0 240px; border-right:1px solid var(--divider-color); background:var(--background-secondary); }
.mod-right-split { flex:0 0 250px; border-left:1px solid var(--divider-color); background:var(--background-secondary); }
.workspace-tabs, .workspace-tab-container { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; }
.workspace-leaf { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; }
.workspace-leaf-content { display:flex; flex-direction:column; flex:1; min-height:0; }

.view-header {
  height:40px; flex:none;
  display:flex; align-items:center; gap:8px;
  padding:0 10px;
  background:var(--background-secondary);
  border-bottom:1px solid var(--divider-color);
  color:var(--text-muted); font-size:13px;
}
.view-header-icon { color:var(--text-faint); }
.view-header-title { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.view-actions { margin-left:auto; display:flex; gap:4px; }
.view-content { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; }

/* ---- file explorer ---- */
.nav-files-container { padding:6px 6px; font-size:13px; }
.nav-folder, .nav-file { user-select:none; }
.nav-folder-title, .nav-file-title {
  display:flex; align-items:center; gap:6px;
  padding:4px 8px; margin:1px 0; border-radius:5px;
  color:var(--text-normal); cursor:pointer;
}
.nav-folder-title { color:var(--text-muted); font-weight:600; }
.nav-folder-title:hover, .nav-file-title:hover { background:var(--background-modifier-hover); }
.nav-file-title.is-active { background:var(--background-modifier-active-hover); color:var(--text-accent); font-weight:600; }
.nav-folder-children { margin-left:14px; }
.nav-folder-collapse-indicator { width:14px; flex:none; display:inline-flex; justify-content:center; color:var(--text-faint); font-size:10px; }
.nav-folder-collapse-indicator::before { content:"▾"; }
.nav-folder-title.is-collapsed .nav-folder-collapse-indicator::before { content:"▸"; }
.nav-folder-title-content, .nav-file-title-content { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* ---- outline / tags sidebar ---- */
.outline { padding:10px 12px; font-size:13px; }
.outline-item a { color:var(--text-normal); text-decoration:none; display:block; padding:2px 0; }
.outline-item a:hover { color:var(--text-accent); }
.tag-container { padding:8px 12px; display:flex; flex-wrap:wrap; gap:5px; border-top:1px solid var(--divider-color); margin-top:8px; }
.side-section-title { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-faint); font-weight:700; padding:10px 12px 4px; }

/* ---- status bar ---- */
.status-bar {
  height:22px; flex:none;
  display:flex; align-items:center; gap:14px;
  padding:0 12px;
  background:var(--background-secondary-alt);
  border-top:1px solid var(--divider-color);
  color:var(--text-muted); font-size:11px;
}

/* ---- markdown preview ---- */
.markdown-preview-view {
  flex:1; min-height:0; overflow:auto;
  background:var(--background-primary);
  color:var(--text-normal);
  font-family:var(--font-text); font-size:var(--font-text-size); line-height:1.6;
}
.markdown-preview-sizer { max-width:var(--file-line-width); margin:0 auto; padding:20px 32px 80px; }
.inline-title {
  font-size:var(--h1-size); font-weight:var(--h1-weight); line-height:1.3;
  margin:0.15em 0 0.5em; color:var(--text-normal);
}
.markdown-preview-section > h1, .markdown-preview-section > h2,
.markdown-preview-section > h3, .markdown-preview-section > h4,
.markdown-preview-section > h5, .markdown-preview-section > h6 {
  line-height:1.3; margin:1.2em 0 0.4em; color:var(--text-normal);
}
h1 { font-size:var(--h1-size); font-weight:var(--h1-weight); }
h2 { font-size:var(--h2-size); font-weight:var(--h2-weight); border-bottom:1px solid var(--background-modifier-border); padding-bottom:0.25em; }
h3 { font-size:var(--h3-size); font-weight:var(--h3-weight); }
h4 { font-size:var(--h4-size); font-weight:var(--h4-weight); }
.markdown-preview-section p { margin:0.6em 0; }
.markdown-preview-section a { color:var(--text-accent); text-decoration:none; }
.markdown-preview-section a:hover { text-decoration:underline; }
.markdown-preview-section code {
  background:var(--code-background); color:var(--code-normal);
  padding:0.15em 0.35em; border-radius:4px;
  font-family:var(--font-monospace); font-size:0.88em;
}
.markdown-preview-section pre {
  background:var(--code-background); border:1px solid var(--background-modifier-border);
  border-radius:8px; padding:12px 14px; overflow:auto; margin:1em 0;
}
.markdown-preview-section pre code { background:none; padding:0; border-radius:0; font-size:0.86em; }
.markdown-preview-section blockquote {
  border-left:3px solid var(--blockquote-border-color);
  color:var(--blockquote-color);
  margin:1em 0; padding:0.2em 0 0.2em 1em;
}
.markdown-preview-section hr { border:none; border-top:1px solid var(--background-modifier-border); margin:1.6em 0; }
.markdown-preview-section table { border-collapse:collapse; margin:1em 0; font-size:0.94em; }
.markdown-preview-section th, .markdown-preview-section td { border:1px solid var(--table-border-color); padding:7px 12px; text-align:left; }
.markdown-preview-section th { background:var(--background-secondary); font-weight:600; }
.markdown-preview-section ul, .markdown-preview-section ol { padding-left:1.6em; margin:0.6em 0; }
.markdown-preview-section li { margin:0.2em 0; }
.markdown-preview-section ul.contains-task-list, .markdown-preview-section ol.contains-task-list { list-style:none; padding-left:0.2em; }
.markdown-preview-section .task-list-item { display:flex; align-items:center; gap:0.5em; }
.markdown-preview-section .task-list-item-checkbox { accent-color:var(--interactive-accent); width:15px; height:15px; flex:none; }
.markdown-preview-section .task-list-item.is-checked { color:var(--text-faint); text-decoration:line-through; }
.markdown-preview-section a.tag {
  display:inline-block; background:var(--tag-background); color:var(--tag-color);
  border-radius:99px; padding:0.05em 0.8em; font-size:0.85em; margin-right:0.3em; text-decoration:none;
}
.markdown-preview-section .callout {
  background:var(--callout-background);
  border:1px solid var(--background-modifier-border);
  border-left:3px solid var(--interactive-accent);
  border-radius:8px; padding:10px 14px; margin:1em 0;
}
.callout-title { display:flex; align-items:center; gap:8px; font-weight:600; margin-bottom:4px; }
.callout-icon { width:16px; height:16px; flex:none; border-radius:50%; background:var(--interactive-accent); opacity:0.85; }
.callout-content p { margin:0.4em 0; }

/* ---- narrow preview windows ---- */
@media (max-width: 760px) {
  .workspace-ribbon { width: 38px; }
  .mod-left-split { flex: 0 0 170px; }
  .mod-right-split { display: none; }
}
@media (max-width: 520px) {
  .workspace-ribbon { display: none; }
  .mod-left-split { flex: 0 0 0px; }
}

/* ---- properties (frontmatter) ---- */
.metadata-container {
  border:1px solid var(--background-modifier-border);
  border-radius:8px; padding:8px 14px; margin:0 0 1.4em;
  font-size:13px;
}
.metadata-properties-heading { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-faint); font-weight:700; margin-bottom:6px; }
.metadata-property { display:flex; gap:16px; padding:2px 0; }
.metadata-property-key { color:var(--text-muted); flex:0 0 38%; }
.metadata-property-value { color:var(--text-normal); }
.metadata-property-icon { color:var(--text-faint); margin-right:4px; }
`;

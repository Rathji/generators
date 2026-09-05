// Theme Depo — live preview
// Builds a fake Obsidian workspace (reading mode) inside an iframe and applies
// the selected theme's stylesheet on top of a minimal Obsidian-default base.

import { OBSIDIAN_BASE_CSS } from "./obsidian-base.js";
import { cssCandidates } from "./data.js";

const cssCache = new Map();

export async function fetchThemeCss(theme) {
  const candidates = cssCandidates(theme);
  let lastErr = null;
  for (const url of candidates) {
    if (cssCache.has(url)) {
      const c = cssCache.get(url);
      if (c.ok) return { css: c.css, url };
      lastErr = new Error("404");
      continue;
    }
    try {
      const res = await fetch(url);
      if (res.ok) {
        const css = await res.text();
        cssCache.set(url, { ok: true, css });
        return { css, url };
      }
      cssCache.set(url, { ok: false });
      lastErr = new Error("HTTP " + res.status);
    } catch (e) {
      lastErr = e;
      cssCache.set(url, { ok: false });
    }
  }
  throw lastErr || new Error("No stylesheet found");
}

function absolutize(css, baseUrl) {
  css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
    u = u.trim();
    if (!u || /^(data:|https?:|\/\/)/i.test(u)) return m;
    try {
      return `url(${q}${new URL(u, baseUrl).href}${q})`;
    } catch {
      return m;
    }
  });
  css = css.replace(/@import\s+['"]([^'"]+)['"]/g, (m, u) => {
    if (/^(https?:|\/\/)/i.test(u)) return m;
    try {
      return `@import "${new URL(u, baseUrl).href}"`;
    } catch {
      return m;
    }
  });
  return css;
}

const RIBBON_ICONS = `
  <div class="sidebar-toggle-button mod-left"><div class="clickable-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></svg></div></div>
  <div class="clickable-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg></div>
  <div class="clickable-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
  <div class="clickable-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><line x1="8" y1="7" x2="16" y2="5"/><line x1="7" y1="8" x2="17" y2="16"/></svg></div>
  <div class="clickable-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15 9 22 9 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9 9 9"/></svg></div>
  <div class="clickable-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4.9z"/></svg></div>
`;

const EXPLORER = `
  <div class="workspace-leaf-content" data-type="file-explorer">
    <div class="view-header">
      <div class="view-header-left"><div class="view-header-icon"></div></div>
      <div class="view-header-title-container"><div class="view-header-title">Explorer</div></div>
      <div class="view-actions"></div>
    </div>
    <div class="view-content">
      <div class="nav-files-container">
        <div class="nav-folder mod-root">
          <div class="nav-folder-title"><div class="nav-folder-collapse-indicator"></div><div class="nav-folder-title-content">Theme Depo Vault</div></div>
          <div class="nav-folder-children">
            <div class="nav-folder">
              <div class="nav-folder-title"><div class="nav-folder-collapse-indicator"></div><div class="nav-folder-title-content">Projects</div></div>
              <div class="nav-folder-children">
                <div class="nav-file"><div class="nav-file-title"><div class="nav-file-title-content">Sailing Log</div></div></div>
                <div class="nav-file"><div class="nav-file-title"><div class="nav-file-title-content">Ship Manifest</div></div></div>
              </div>
            </div>
            <div class="nav-folder">
              <div class="nav-folder-title"><div class="nav-folder-collapse-indicator"></div><div class="nav-folder-title-content">Research</div></div>
              <div class="nav-folder-children">
                <div class="nav-file"><div class="nav-file-title is-active"><div class="nav-file-title-content">The Age of Sail</div></div></div>
                <div class="nav-file"><div class="nav-file-title"><div class="nav-file-title-content">Navigation Notes</div></div></div>
                <div class="nav-file"><div class="nav-file-title"><div class="nav-file-title-content">Ports of Call</div></div></div>
              </div>
            </div>
            <div class="nav-file"><div class="nav-file-title"><div class="nav-file-title-content">Inbox</div></div></div>
            <div class="nav-file"><div class="nav-file-title"><div class="nav-file-title-content">Daily Note 2026-09-01</div></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const NOTE_CONTENT = `
  <div class="mod-header">
    <div class="inline-title">The Age of Sail</div>
    <div class="metadata-container">
      <div class="metadata-properties-heading">Properties</div>
      <div class="metadata-property"><div class="metadata-property-key"><span class="metadata-property-icon">◆</span><span class="metadata-property-name">created</span></div><div class="metadata-property-value">2026-09-01</div></div>
      <div class="metadata-property"><div class="metadata-property-key"><span class="metadata-property-icon">◆</span><span class="metadata-property-name">status</span></div><div class="metadata-property-value">Active</div></div>
      <div class="metadata-property"><div class="metadata-property-key"><span class="metadata-property-icon">◆</span><span class="metadata-property-name">captain</span></div><div class="metadata-property-value">[[Isabella Crane]]</div></div>
    </div>
  </div>
  <h1>The Golden Horizon</h1>
  <p>This is a <strong>sample note</strong> rendered in <em>reading mode</em>. The theme's <code>theme.css</code> is applied to the entire workspace — chrome, sidebar, and content — exactly like Obsidian.</p>
  <blockquote><p>"The sea is a harsh mistress, but a fair one."</p></blockquote>
  <h2>The Fleet</h2>
  <ul>
    <li><strong>Golden Horizon</strong> — flagship, 74 guns</li>
    <li>HMS <em>Tempest</em> — fast frigate, 64 guns</li>
    <li>Providence — supply galleon</li>
  </ul>
  <h2>Task List</h2>
  <ul class="contains-task-list">
    <li class="task-list-item is-checked"><input type="checkbox" class="task-list-item-checkbox" checked><span>Repair the mainmast</span></li>
    <li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox"><span>Chart the coral reef</span></li>
    <li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox"><span>Stock provisions for the crossing</span></li>
  </ul>
  <div class="callout" data-callout="info">
    <div class="callout-title"><div class="callout-icon"></div><div class="callout-title-inner">Note</div></div>
    <div class="callout-content"><p>Previews apply the full theme stylesheet, including sidebars, headers, tables, code blocks and this callout.</p></div>
  </div>
  <h2>Navigation Code</h2>
  <pre><code class="language-javascript">function courseTo(port) {
  const bearing = compass.reading();
  return navigate({ from: this.port, to: port, heading: bearing });
}</code></pre>
  <h2>Manifest</h2>
  <table>
    <thead><tr><th>Ship</th><th>Captain</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>Golden Horizon</td><td>I. Crane</td><td>Ready</td></tr>
      <tr><td>Tempest</td><td>R. Alvar</td><td>Docked</td></tr>
      <tr><td>Providence</td><td>—</td><td>Refitting</td></tr>
    </tbody>
  </table>
  <h3>Inline Elements</h3>
  <p>Here is a <a class="internal-link">wiki link</a>, an <a href="https://example.com">external link</a>, inline <code>code</code>, and a couple of tags: <a class="tag">#maritime</a> <a class="tag">#history</a>.</p>
  <hr>
  <p>That's all for this sample — typography, colors and chrome are all driven by the selected theme.</p>
`;

const OUTLINE = `
  <div class="workspace-leaf-content" data-type="outline">
    <div class="view-header">
      <div class="view-header-left"><div class="view-header-icon"></div></div>
      <div class="view-header-title-container"><div class="view-header-title">Outline</div></div>
      <div class="view-actions"></div>
    </div>
    <div class="view-content">
      <div class="side-section-title">Outline</div>
      <div class="outline">
        <div class="outline-item"><a class="internal-link">The Golden Horizon</a></div>
        <div class="outline-item"><a class="internal-link">The Fleet</a></div>
        <div class="outline-item"><a class="internal-link">Task List</a></div>
        <div class="outline-item"><a class="internal-link">Manifest</a></div>
      </div>
      <div class="tag-container">
        <a class="tag">#maritime</a><a class="tag">#history</a><a class="tag">#reading</a>
      </div>
    </div>
  </div>
`;

export function buildPreviewDoc(theme, css, mode, cssUrl) {
  const dir = cssUrl.slice(0, cssUrl.lastIndexOf("/") + 1);
  const themedCss = absolutize(css, dir).replace(/<\/style/gi, "<\\/style");
  return `<!doctype html>
<html lang="en" class="theme-${mode}">
<head>
<meta charset="utf-8">
<style>${OBSIDIAN_BASE_CSS}</style>
<style>${themedCss}</style>
</head>
<body class="theme-${mode}">
<div class="workspace">
  <div class="workspace-ribbon mod-left">${RIBBON_ICONS}</div>
  <div class="workspace-main">
    <div class="workspace-split mod-root">
      <div class="workspace-split mod-left-split">
        <div class="workspace-tabs">
          <div class="workspace-tab-container">
            <div class="workspace-leaf">${EXPLORER}</div>
          </div>
        </div>
      </div>
      <div class="workspace-split mod-center">
        <div class="workspace-tabs">
          <div class="workspace-tab-container">
            <div class="workspace-leaf">
              <div class="workspace-leaf-content" data-type="markdown">
                <div class="view-header">
                  <div class="view-header-left"><div class="view-header-icon"></div></div>
                  <div class="view-header-title-container"><div class="view-header-title">The Age of Sail</div></div>
                  <div class="view-actions">
                    <div class="clickable-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15 9 22 9 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9 9 9"/></svg></div>
                    <div class="clickable-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></div>
                  </div>
                </div>
                <div class="view-content">
                  <div class="markdown-preview-view">
                    <div class="markdown-preview-sizer">
                      <div class="markdown-preview-pusher">${NOTE_CONTENT}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="workspace-split mod-right-split">
        <div class="workspace-tabs">
          <div class="workspace-tab-container">
            <div class="workspace-leaf">${OUTLINE}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="status-bar">
      <div class="status-bar-item">14 words</div>
      <div class="status-bar-item">Ln 3, Col 12</div>
      <div class="status-bar-item">Reading mode</div>
      <div class="status-bar-item">v1.8</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ==UserScript==
// @name         BGG Geeklist Puller
// @namespace    perchance-gatherer
// @version      1.0
// @description  Extract every game from a BoardGameGeek geeklist across ALL pages: rank, title, BGG link, item comment, and optionally each game's Mechanics tags. Adds a floating "Pull geeklist" button.
// @match        https://boardgamegeek.com/geeklist/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function detectPageCount() {
    let max = 1;
    document.querySelectorAll('a[href*="?page="]').forEach(a => {
      const m = a.getAttribute('href').match(/page=(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return max;
  }

  // ---- extract one geeklist's items from a parsed Document ----
  function parseItems(doc) {
    const items = [];
    const rows = doc.querySelectorAll('[id^="item_row_"]');
    for (const row of rows) {
      const a = row.querySelector('a[href*="/boardgame/"]');
      if (!a) continue;
      const m = a.getAttribute('href').match(/\/boardgame\/(\d+)\/([a-z0-9-]+)/);
      if (!m) continue;
      let rank = null;
      const rankEl = row.querySelector('.geeklist-item-rank, .item-rank, .rank');
      if (rankEl) {
        const r = parseInt((rankEl.textContent || '').match(/\d+/), 10);
        if (!isNaN(r)) rank = r;
      }
      let comment = '';
      const cEl = row.querySelector('.geeklist-item-comment, .geeklist-item-comment-content, .comment-content, .comment');
      if (cEl) comment = cEl.textContent.replace(/\s+/g, ' ').trim();
      items.push({
        rank,
        title: a.textContent.replace(/\s+/g, ' ').trim(),
        id: parseInt(m[1], 10),
        slug: m[2],
        url: 'https://boardgamegeek.com/boardgame/' + m[1] + '/' + m[2],
        comment
      });
    }
    // Fallback: no item_row_ ids found -> collect boardgame links in document order (deduped).
    if (!items.length) {
      const seen = new Set();
      doc.querySelectorAll('a[href*="/boardgame/"]').forEach(a => {
        const m = a.getAttribute('href').match(/\/boardgame\/(\d+)\/([a-z0-9-]+)/);
        if (!m || seen.has(m[1])) return;
        seen.add(m[1]);
        items.push({ rank: null, title: a.textContent.trim(), id: parseInt(m[1], 10), slug: m[2],
          url: 'https://boardgamegeek.com/boardgame/' + m[1] + '/' + m[2], comment: '' });
      });
    }
    return items;
  }

  async function fetchPageHtml(page) {
    const url = location.origin + location.pathname + '?page=' + page;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('page ' + page + ': HTTP ' + res.status);
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  async function fetchMechanics(game) {
    try {
      const res = await fetch(game.url, { credentials: 'include' });
      if (!res.ok) return [];
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const tags = [...doc.querySelectorAll('a[href^="/boardgamemechanic/"]')]
        .map(a => a.textContent.replace(/\s+/g, ' ').trim())
        .filter(t => t.length);
      return [...new Set(tags)];
    } catch (e) {
      return [];
    }
  }

  // ---- UI ----
  function addButton() {
    const btn = document.createElement('button');
    btn.id = 'ggPullBtn';
    btn.textContent = '⛏ Pull geeklist';
    Object.assign(btn.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: 999999,
      padding: '10px 16px', fontSize: '14px', fontWeight: 'bold',
      background: '#274e13', color: '#fff', border: 'none', borderRadius: '6px',
      cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.4)'
    });
    document.body.appendChild(btn);
    return btn;
  }

  function showModal(plainText, games) {
    const modal = document.createElement('div');
    modal.id = 'ggPullModal';
    Object.assign(modal.style, {
      position: 'fixed', inset: '0', zIndex: 999998, background: 'rgba(0,0,0,.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      background: '#fff', color: '#222', width: 'min(720px, 94vw)', maxHeight: '88vh',
      borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px',
      fontFamily: 'system-ui, sans-serif'
    });
    const title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.textContent = 'Geeklist pulled: ' + games.length + ' items';
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.value = plainText;
    Object.assign(ta.style, { width: '100%', flex: '1', minHeight: '300px', font: '12px/1.4 monospace' });
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';
    function mkBtn(label, fn) {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, { padding: '8px 12px', cursor: 'pointer' });
      b.onclick = fn;
      return b;
    }
    btnRow.append(
      mkBtn('Copy list', () => { navigator.clipboard.writeText(plainText); }),
      mkBtn('Copy JSON', () => { navigator.clipboard.writeText(JSON.stringify(games, null, 2)); }),
      mkBtn('Download .txt', () => download('geeklist-' + location.pathname.split('/')[2] + '.txt', plainText)),
      mkBtn('Download .json', () => download('geeklist-' + location.pathname.split('/')[2] + '.json', JSON.stringify(games, null, 2))),
      mkBtn('Close', () => modal.remove())
    );
    box.append(title, ta, btnRow);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  function download(name, content) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---- main flow ----
  async function run(btn, withMechanics) {
    btn.disabled = true;
    btn.textContent = 'Pulling…';
    try {
      const pageCount = detectPageCount();
      btn.textContent = 'Fetching 1/' + pageCount;
      let games = [];
      for (let p = 1; p <= pageCount; p++) {
        games = games.concat(parseItems(await fetchPageHtml(p)));
        await sleep(400);
        btn.textContent = 'Fetching ' + Math.min(p + 1, pageCount) + '/' + pageCount;
      }
      // assign sequential ranks if none were found in the DOM
      games.forEach((g, i) => { if (g.rank === null) g.rank = i + 1; });

      if (withMechanics) {
        btn.textContent = 'Mechanics 0/' + games.length;
        for (let i = 0; i < games.length; i++) {
          games[i].mechanics = await fetchMechanics(games[i]);
          if (i % 3 === 0) btn.textContent = 'Mechanics ' + i + '/' + games.length;
          await sleep(250);
        }
      }

      const plain = games
        .map(g => g.rank + '. ' + g.title + ' — ' + g.url + (g.mechanics && g.mechanics.length ? '\n     Mechanics: ' + g.mechanics.join(', ') : ''))
        .join('\n');
      console.log('[GG Puller]', games);
      showModal(plain, games);
    } catch (e) {
      alert('Pull failed: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '⛏ Pull geeklist';
    }
  }

  // ---- wire up ----
  const btn = addButton();
  btn.onclick = () => {
    const withMech = confirm('Also fetch each game page for its Mechanics tags?\n(Yes = slower, ~30-60s. No = just titles + links.)');
    run(btn, !!withMech);
  };
})();

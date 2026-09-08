// src/modules/index.js — the KB module registry. Order here defines the
// order in the sidebar navigation. Modules with `hidden: true` (article
// reader, editor, admin) are reachable by hash route but have no nav entry.

import home from "./home.js";
import browse from "./browse.js";
import search from "./search.js";
import review from "./review.js";
import stale from "./stale.js";
import reports from "./reports.js";
import article from "./article.js";
import editor from "./editor.js";
import admin from "./admin.js";

export default [home, browse, search, review, stale, reports, article, editor, admin];

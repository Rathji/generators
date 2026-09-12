import { extractContent } from "./extract.js";
import { convertHtmlToMarkdown } from "./convert.js";
import { formatFrontmatter } from "./metadata.js";
import { limitsFor, truncateHtml, truncateMarkdown } from "./truncate.js";

export function buildDocument(html, options = {}) {
  const url = options.url || "";
  const limits = limitsFor(options);

  const cappedHtml = truncateHtml(html, limits.maxHtmlChars);
  const extracted = extractContent(cappedHtml.text, { url });

  const bodyRaw = convertHtmlToMarkdown(extracted.contentEl, {
    baseUrl: url,
    includeImages: options.includeImages,
    includeLinks: options.includeLinks,
    linkMode: options.linkMode,
    bullet: options.bullet
  });

  const cappedBody = truncateMarkdown(bodyRaw, limits.maxMarkdownChars);
  const frontmatter = formatFrontmatter(extracted.metadata, options);
  const markdown = frontmatter
    ? frontmatter + "\n\n" + cappedBody.text.replace(/^\n+/, "")
    : cappedBody.text;

  const truncation = {
    html: { truncated: cappedHtml.truncated, fullChars: cappedHtml.fullChars, keptChars: cappedHtml.keptChars },
    markdown: { truncated: cappedBody.truncated, fullChars: cappedBody.fullChars, keptChars: cappedBody.keptChars },
    limit: limits.preset.key,
    any: cappedHtml.truncated || cappedBody.truncated
  };

  return {
    title: extracted.title,
    metadata: extracted.metadata,
    frontmatter,
    body: cappedBody.text,
    markdown,
    stats: extracted.stats,
    truncation,
    extracted
  };
}

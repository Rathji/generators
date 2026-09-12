export const ERROR_INFO = {
  empty: { title: "No address entered", hint: "Paste a web address, e.g. example.com/article." },
  invalid: { title: "Invalid address", hint: "Check the address for typos and try again." },
  invalid_host: { title: "Missing domain", hint: "Include the full domain, e.g. example.com." },
  unsupported_scheme: { title: "Unsupported link type", hint: "Only http:// and https:// pages can be captured." },
  no_fetch: { title: "Fetcher unavailable", hint: "Reload the page and try again." },
  unreachable: { title: "Couldn't reach the site", hint: "The site may be offline, blocking requests, or the address may be wrong." },
  timeout: { title: "Request timed out", hint: "The site took too long to respond. Try again, or pick a lighter page." },
  http_error: { title: "The site returned an error", hint: detail => `The server responded with status ${detail}.` },
  blocked: { title: "Capture blocked", hint: "This site is blocking automated requests — usually bot protection or a CAPTCHA." },
  paywall: { title: "Paywalled content", hint: "This page appears to require a subscription to read." },
  non_html: { title: "Not a web page", hint: detail => `The link points to ${detail || "a non-HTML resource"}, so there's no page to convert.` },
  binary: { title: "Not a web page", hint: "The response looks like a binary file rather than readable HTML." },
  too_large: { title: "Page too large", hint: detail => `This page (${detail}) is over the capture limit and could hang the browser.` },
  parse_error: { title: "Couldn't parse the page", hint: "The HTML came back malformed and couldn't be read." },
  empty_content: { title: "No readable content", hint: "The page loaded, but no main article or content area could be found." },
  unknown: { title: "Capture failed", hint: "Something unexpected went wrong. Please try again." }
};

export class W2MError extends Error {
  constructor(code, detail) {
    const info = ERROR_INFO[code] || ERROR_INFO.unknown;
    super(info.title);
    this.name = "W2MError";
    this.code = ERROR_INFO[code] ? code : "unknown";
    this.title = info.title;
    this.hint = typeof info.hint === "function" ? info.hint(detail) : info.hint;
    this.detail = detail == null ? "" : String(detail);
  }
  toString() {
    return this.title + (this.detail ? ` (${this.detail})` : "");
  }
}

export function describeError(err) {
  if (err instanceof W2MError) {
    return { code: err.code, title: err.title, hint: err.hint, detail: err.detail };
  }
  return {
    code: "unknown",
    title: ERROR_INFO.unknown.title,
    hint: ERROR_INFO.unknown.hint,
    detail: (err && err.message) ? String(err.message) : ""
  };
}

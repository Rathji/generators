# easy-upload

Upload any file to **tmpfiles.org** (short-lived, auto-delete) or **gofile.io** (kept ~10 days) — no account needed. Based on the **rathji-template** (perchance.org/rathji-template) design system and structure.

## Structure
- `main.pjs` — in the rathji-template style: `$meta` (minimal header), a `easyUploadServices` list (per-service metadata read by the page), and two thin async entry points `easyUploadTmpfiles(file, expireSeconds)` / `easyUploadGofile(file)` that call the APIs via `root.superFetch`. They return `{pageUrl, dlUrl}` / `{shareUrl}` or `{error}` (never throw).
- `index.html` — the template's full design system (fixed nav, settings panel with theme/accent/size/reduce-motion, toasts) with the uploader in place of the template's demo content. The service cards are built from the `easyUploadServices` list.

## API endpoints (current, verified)
- tmpfiles: POST multipart `file` + `expire` (seconds 3600/21600/86400/172800) → `https://tmpfiles.org/api/v1/upload`. Page URL from `data.url`; direct download = same URL with `https://tmpfiles.org/` → `https://tmpfiles.org/dl/`. Site caps ~100 MB/file.
- gofile: POST multipart `file` (no token = guest) → `https://upload.gofile.io/uploadfile` (the old `{server}.gofile.io/contents` flow is gone/404s). Share link from `data.downloadPage`.

## Notes
- All requests go through `superFetch` (CORS-free proxy) — direct browser uploads are CORS-blocked.
- No real upload progress through the proxy; UI shows an indeterminate spinner.
- Settings persist under `localStorage["easyUploadSettings"]`, support `?theme=&accent=&size=&motion=` URL overrides.
- Generator name and all in-page branding: `easy-uploads`.

/*
 * WebCodecs video decoding — the preview-safe path.
 *
 * Normally a <video> element is the way to read frames from a file. In the
 * Perchance editor's preview iframe it is not: media loading is throttled and
 * `loadedmetadata`/`loadeddata` never fire for any source — blob URLs (even
 * MediaRecorder output), data: URLs and remote MP4s all stall, while
 * `canPlayType` still reports "probably". That is an environment limitation,
 * not a code bug.
 *
 * WebCodecs has no such problem (VideoDecoder/VideoFrame work even in the
 * hidden preview), so we demux the container and decode the frames ourselves —
 * no media element involved. mediabunny (by the mp4-muxer author) drives that:
 * it parses mp4/mov/mkv/webm/… and hands back decoded frames as canvases via
 * CanvasSink, which is exactly the shape this app wants (one reference frame,
 * or a contact sheet of N).
 *
 *   openVideo(file) -> session | null      null = caller should use the <video> path
 *     session.duration / .width / .height / .codec
 *     session.frameAt(t)      -> HTMLCanvasElement | null
 *     session.framesAt([t…])  -> (HTMLCanvasElement | null)[]
 *     session.dispose()
 *
 * Callers keep their <video> implementation as the fallback: it is the right
 * path in a normal browser when this one can't handle the file (no WebCodecs,
 * or a codec mediabunny won't decode).
 */

const MEDIABUNNY_URL = "https://esm.sh/mediabunny@1.56.1";

/* Loaded on first use — the library is a few hundred KB and only matters when a
   video is actually attached, so it is kept out of the app's boot. */
let mediabunnyPromise = null;
function loadMediabunny() {
  if (!mediabunnyPromise) mediabunnyPromise = import(MEDIABUNNY_URL);
  return mediabunnyPromise;
}

export function webCodecsVideoSupported() {
  return typeof VideoDecoder === "function" && typeof VideoFrame === "function";
}

const clampTime = (t, duration) => Math.max(0, Math.min(t || 0, Math.max(duration - 1e-3, 0)));

export async function openVideo(file, opts = {}) {
  if (!file || !webCodecsVideoSupported()) return null;
  const maxWidth = opts.maxWidth || 640;
  let input = null;
  let sink = null;
  try {
    const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await loadMediabunny();
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    if (typeof track.canDecode === "function" && !(await track.canDecode())) return null;
    const duration = await track.computeDuration();
    const width = track.displayWidth || track.codedWidth || 0;
    const height = track.displayHeight || track.codedHeight || 0;
    const sinkWidth = Math.max(2, Math.round(Math.min(width || maxWidth, maxWidth)));
    sink = new CanvasSink(track, { width: sinkWidth });
    const dur = isFinite(duration) ? duration : 0;
    return {
      duration: dur,
      width: width || 0,
      height: height || 0,
      codec: track.codec || "",
      async frameAt(t) {
        try {
          const r = await sink.getCanvas(clampTime(t, dur));
          return r && r.canvas ? r.canvas : null;
        } catch (e) {
          console.warn("video frame decode failed", e);
          return null;
        }
      },
      async framesAt(list) {
        const out = [];
        for (const t of list) {
          try {
            const r = await sink.getCanvas(clampTime(t, dur));
            out.push(r && r.canvas ? r.canvas : null);
          } catch (e) {
            console.warn("video frame decode failed", e);
            out.push(null);
          }
        }
        return out;
      },
      async dispose() {
        try {
          if (input && input.dispose) await input.dispose();
        } catch {}
        sink = null;
      },
    };
  } catch (e) {
    console.warn("video demux failed", e);
    try {
      if (input && input.dispose) await input.dispose();
    } catch {}
    return null;
  }
}

/*
 * Draw any drawable source (a decoded canvas, or a <video> element on the
 * fallback path) down to a JPEG data URL, capped on its larger side.
 */
export function frameToDataUrl(src, maxSide = 640) {
  if (!src) return null;
  const w = src.width || src.videoWidth;
  const h = src.height || src.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w * scale));
  c.height = Math.max(2, Math.round(h * scale));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

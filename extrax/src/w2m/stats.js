const WORDS_RE = /\S+/g;
const READING_WPM = 200;

export function markdownStats(text) {
  const value = String(text == null ? "" : text);
  const trimmed = value.trim();
  const words = trimmed ? (trimmed.match(WORDS_RE) || []).length : 0;
  const characters = value.length;
  const charactersNoSpaces = value.replace(/\s/g, "").length;
  const lines = value ? value.split("\n").length : 0;
  const readingMinutes = words ? Math.max(1, Math.round(words / READING_WPM)) : 0;
  return { words, characters, charactersNoSpaces, lines, readingMinutes };
}

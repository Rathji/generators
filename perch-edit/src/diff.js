import { diffLines } from "https://esm.sh/diff@5.2.0";

export function buildRows(oldText, newText) {
  const parts = diffLines(String(oldText ?? ""), String(newText ?? ""));
  const rows = [];
  let oldN = 1;
  let newN = 1;
  for (const part of parts) {
    let lines = part.value.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (part.added) {
      for (const ln of lines) rows.push({ t: "add", a: "", b: newN++, text: ln });
    } else if (part.removed) {
      for (const ln of lines) rows.push({ t: "del", a: oldN++, b: "", text: ln });
    } else {
      for (const ln of lines) rows.push({ t: "ctx", a: oldN++, b: newN++, text: ln });
    }
  }
  return rows;
}

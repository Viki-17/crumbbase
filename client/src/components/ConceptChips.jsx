import { stripHashtags } from "./Outline.jsx";

// Concept chips for a block (Logseq-style [[page]] refs, read-only: click
// opens the concept page). concepts: [{ conceptId, name, evidence?, status? }].
export function conceptsByBlock(list = []) {
  const map = new Map();
  for (const row of list) {
    if (!map.has(row.blockId)) map.set(row.blockId, []);
    map.get(row.blockId).push({ conceptId: row.conceptId, name: row.name, evidence: row.evidence || null, status: row.status || null });
  }
  return map;
}

export function stripWikilinks(text) {
  return stripHashtags(String(text || "").replace(/\[\[([^\[\]]+)\]\]/g, "$1"));
}

export default function ConceptChips({ concepts = [], onOpen, compact = false }) {
  if (!concepts || concepts.length === 0) return null;
  return (
    <span className={`concept-chips${compact ? " compact" : ""}`}>
      {concepts.slice(0, 4).map((c) => (
        <button
          key={c.conceptId}
          className="concept-chip"
          title={c.evidence ? `Why: “${c.evidence}”` : `Open concept: ${c.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen && onOpen(c.conceptId);
          }}
        >
          [[{c.name}]]{c.status === "provisional" ? "*" : ""}
        </button>
      ))}
    </span>
  );
}

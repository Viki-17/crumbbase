import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { fmtTime, deepLink } from "../lib.js";
import { stripHashtags, parseKeyIdea } from "./Outline.jsx";
import ConceptChips from "./ConceptChips.jsx";

// Visual Zettel preview (Stage 1): same blocks, card-shaped.
// No DB change — each card is one key-idea / claim / question block
// truncated to bite size with deep-link + copy. True atomic split lands
// in Stage 2 (atomize job).
function toCards(blocks = []) {
  const cards = [];
  for (const b of blocks) {
    const kind = (b.props && b.props.kind) || "note";
    if (kind === "tldr" || kind === "transcript-chunk") continue;
    if (kind !== "key-idea" && kind !== "claim" && kind !== "question" && kind !== "zettel") continue;
    let title = "";
    let body = stripHashtags(b.content);
    if (kind === "zettel") {
      title = (b.props && b.props.zettelTitle) || "";
      body = body.replace(/^\*\*.+?\*\*:?\s*/, "");
      if (!title) {
        const parsed = parseKeyIdea(b.content);
        title = parsed.title;
        body = parsed.body;
      }
    } else if (kind === "key-idea") {
      const parsed = parseKeyIdea(b.content);
      title = parsed.title;
      body = parsed.body;
    } else if (kind === "question") {
      title = "Open question";
    } else if (kind === "claim") {
      title = "Claim";
    }
    cards.push({ id: b.id, kind, title, body, timestamp: b.props && b.props.timestamp, block: b });
  }
  // Zettels first — they are the bite-sized layer.
  cards.sort((a, b) => (a.kind === "zettel" ? -1 : 0) - (b.kind === "zettel" ? -1 : 0));
  return cards;
}

function Card({ card, sourceUrl, sourceTitle, expanded, onToggle, concepts, onConceptClick }) {
  const LIMIT = 220;
  const long = card.body.length > LIMIT;
  const shown = expanded || !long ? card.body : `${card.body.slice(0, LIMIT).trim()}…`;
  const href = deepLink(sourceUrl, card.timestamp);
  const copyText = href
    ? `**${card.title || card.kind}:** ${card.body}\n\n— [${sourceTitle || "Source"}${card.timestamp != null ? ` @ ${fmtTime(card.timestamp)}` : ""}](${href})`
    : `${card.title ? `**${card.title}:** ` : ""}${card.body}`;

  const copy = (e) => {
    e.stopPropagation();
    if (navigator.clipboard) navigator.clipboard.writeText(copyText).catch(() => {});
  };

  return (
    <article className={`zettel-card kind-${card.kind}`} onClick={onToggle}>
      <div className="zettel-top">
        <span className={`kind-badge ${card.kind}`}>{card.kind}</span>
        {card.timestamp != null && href && (
          <a className="ts-chip ts-prominent" href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            ▶ {fmtTime(card.timestamp)}
          </a>
        )}
      </div>
      {card.title && <h4 className="zettel-title">{card.title}</h4>}
      <div className="zettel-body">
        <ReactMarkdown>{shown}</ReactMarkdown>
      </div>
      <div className="zettel-foot">
        {long && <button className="mini-btn" onClick={onToggle}>{expanded ? "Show less" : "Read more"}</button>}
        <span style={{ flex: 1 }} />
        <button className="mini-btn" onClick={copy}>Copy MD</button>
        {href && (
          <a className="mini-btn link" href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Open ↗
          </a>
        )}
      </div>
      <ConceptChips concepts={concepts} onOpen={onConceptClick} />
    </article>
  );
}

export default function CardDeck({ blocks = [], sourceUrl, sourceTitle, mode = "cards", conceptsByBlock = new Map(), onConceptClick }) {
  const cards = useMemo(() => toCards(blocks), [blocks]);
  const [expandedId, setExpandedId] = useState(null);
  const [idx, setIdx] = useState(0);

  if (cards.length === 0) {
    return <div className="empty">No cards yet — key ideas will appear here once structuring completes.</div>;
  }

  if (mode === "focus") {
    const card = cards[Math.min(idx, cards.length - 1)];
    return (
      <div className="focus-wrap">
        <div className="focus-nav">
          <button className="btn ghost" disabled={idx <= 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>← Prev</button>
          <span className="card-meta">{idx + 1} / {cards.length}</span>
          <button className="btn ghost" disabled={idx >= cards.length - 1} onClick={() => setIdx((i) => Math.min(cards.length - 1, i + 1))}>Next →</button>
        </div>
        <Card
          card={card}
          sourceUrl={sourceUrl}
          sourceTitle={sourceTitle}
          expanded
          onToggle={() => {}}
          concepts={conceptsByBlock.get(card.id)}
          onConceptClick={onConceptClick}
        />
        <div className="focus-progress">
          <div className="focus-bar" style={{ width: `${((idx + 1) / cards.length) * 100}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="zettel-grid">
      {cards.map((c) => (
        <Card
          key={c.id}
          card={c}
          sourceUrl={sourceUrl}
          sourceTitle={sourceTitle}
          expanded={expandedId === c.id}
          onToggle={() => setExpandedId((cur) => (cur === c.id ? null : c.id))}
          concepts={conceptsByBlock.get(c.id)}
          onConceptClick={onConceptClick}
        />
      ))}
    </div>
  );
}

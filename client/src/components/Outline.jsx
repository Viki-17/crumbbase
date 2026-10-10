import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { fmtTime, deepLink } from "../lib.js";

// Read-only outline renderer (P1 polish): tag-spam stripped on render,
// sections rendered as bite-sized cards. Tags live in one row under the
// header (SourceView) — never repeated per block.
const SECTION_ORDER = [
  ["tldr", null], // rendered as lede, no heading
  ["key-idea", "Key ideas"],
  ["claim", "Notable claims"],
  ["question", "Follow-up questions"],
];

export function stripHashtags(text) {
  return String(text || "")
    .replace(/#[\w-]+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseKeyIdea(content) {
  const clean = stripHashtags(content);
  const m = clean.match(/^\*\*(.+?)\*\*:?\s*([\s\S]*)$/);
  if (m) return { title: m[1].replace(/:$/, "").trim(), body: (m[2] || "").trim() };
  // Fallback: "Label: body" without bold
  const colon = clean.indexOf(":");
  if (colon > 0 && colon < 80) {
    return { title: clean.slice(0, colon).trim(), body: clean.slice(colon + 1).trim() };
  }
  return { title: "", body: clean };
}

function copyToClipboard(text) {
  const t = String(text || "");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(t);
  }
  return Promise.reject(new Error("clipboard unavailable"));
}

function Timestamp({ url, seconds }) {
  const label = fmtTime(seconds);
  const href = deepLink(url, seconds);
  if (!label || !href) return null;
  return (
    <a className="ts-chip ts-prominent" href={href} target="_blank" rel="noreferrer" title="Open source at this timestamp">
      ▶ {label}
    </a>
  );
}

function CopyBtn({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="mini-btn"
      title="Copy as markdown"
      onClick={(e) => {
        e.stopPropagation();
        copyToClipboard(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => {},
        );
      }}
    >
      {done ? "✓" : label}
    </button>
  );
}

import ConceptChips from "./ConceptChips.jsx";

function CardShell({ kind, title, children, block, sourceUrl, sourceTitle, concepts, onConceptClick }) {
  const ts = block.props && block.props.timestamp;
  const tsLabel = fmtTime(ts);
  const href = deepLink(sourceUrl, ts);
  const cleanBody = stripHashtags(block.content);
  const copyText = href
    ? `${cleanBody}\n\n— [${sourceTitle || "Source"} @ ${tsLabel}](${href})`
    : cleanBody;
  return (
    <article className={`idea-card kind-${kind}`}>
      <div className="idea-card-head">
        {title ? <h4 className="idea-card-title">{title}</h4> : null}
        <div className="idea-card-actions">
          <Timestamp url={sourceUrl} seconds={ts} />
          <CopyBtn text={copyText} />
        </div>
      </div>
      <div className="idea-card-body">{children}</div>
      <ConceptChips concepts={concepts} onOpen={onConceptClick} />
    </article>
  );
}

function Block({ block, sourceUrl, sourceTitle }) {
  const ts = block.props && block.props.timestamp;
  return (
    <div className="outline-bullet">
      <ReactMarkdown>{stripHashtags(block.content)}</ReactMarkdown>
      <Timestamp url={sourceUrl} seconds={ts} />
    </div>
  );
}

export default function Outline({ blocks = [], tags = [], sourceUrl, sourceTitle, onTagClick, conceptsByBlock = new Map(), onConceptClick }) {
  const byKind = new Map();
  for (const b of blocks) {
    const kind = (b.props && b.props.kind) || "note";
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(b);
  }
  const chunks = byKind.get("transcript-chunk") || [];
  const tldrBlocks = byKind.get("tldr") || [];
  const ideas = byKind.get("key-idea") || [];
  const claims = byKind.get("claim") || [];
  const questions = byKind.get("question") || [];
  const zettels = byKind.get("zettel") || [];

  return (
    <div className="outline">
      {tldrBlocks.length > 0 && (
        <div className="tldr-callout">
          <div className="outline-section">TL;DR</div>
          {tldrBlocks.map((b) => (
            <div key={b.id} className="outline-tldr">
              <ReactMarkdown>{stripHashtags(b.content)}</ReactMarkdown>
              <div className="tldr-actions">
                <Timestamp url={sourceUrl} seconds={b.props && b.props.timestamp} />
                <CopyBtn text={stripHashtags(b.content)} />
                <ConceptChips concepts={conceptsByBlock.get(b.id)} onOpen={onConceptClick} />
              </div>
            </div>
          ))}
        </div>
      )}

      {ideas.length > 0 && (
        <div>
          <div className="outline-section">Key ideas · {ideas.length}</div>
          <div className="idea-grid">
            {ideas.map((b) => {
              const { title, body } = parseKeyIdea(b.content);
              return (
                <CardShell key={b.id} kind="key-idea" title={title} block={b} sourceUrl={sourceUrl} sourceTitle={sourceTitle} concepts={conceptsByBlock.get(b.id)} onConceptClick={onConceptClick}>
                  <ReactMarkdown>{body}</ReactMarkdown>
                </CardShell>
              );
            })}
          </div>
        </div>
      )}

      {claims.length > 0 && (
        <div>
          <div className="outline-section">Notable claims · {claims.length}</div>
          <div className="idea-grid">
            {claims.map((b) => (
              <CardShell key={b.id} kind="claim" title="" block={b} sourceUrl={sourceUrl} sourceTitle={sourceTitle} concepts={conceptsByBlock.get(b.id)} onConceptClick={onConceptClick}>
                <ReactMarkdown>{stripHashtags(b.content)}</ReactMarkdown>
              </CardShell>
            ))}
          </div>
        </div>
      )}

      {questions.length > 0 && (
        <div>
          <div className="outline-section">Follow-up questions · {questions.length}</div>
          <ul className="question-list">
            {questions.map((b) => (
              <li key={b.id} className="question-card">
                <span className="q-badge">?</span>
                <span className="q-text">
                  <ReactMarkdown>{stripHashtags(b.content)}</ReactMarkdown>
                </span>
                <CopyBtn text={stripHashtags(b.content)} />
                <ConceptChips concepts={conceptsByBlock.get(b.id)} onOpen={onConceptClick} compact />
              </li>
            ))}
          </ul>
        </div>
      )}

      {zettels.length > 0 && (
        <div>
          <div className="outline-section">Zettels · {zettels.length} — bite-sized, link back to source</div>
          <div className="idea-grid">
            {zettels.map((b) => {
              const zTitle = (b.props && b.props.zettelTitle) || "";
              const parsed = zTitle ? { title: zTitle, body: stripHashtags(b.content).replace(/^\*\*.+?\*\*:?\s*/, "") } : parseKeyIdea(b.content);
              return (
                <CardShell key={b.id} kind="zettel" title={parsed.title} block={b} sourceUrl={sourceUrl} sourceTitle={sourceTitle} concepts={conceptsByBlock.get(b.id)} onConceptClick={onConceptClick}>
                  <ReactMarkdown>{parsed.body}</ReactMarkdown>
                </CardShell>
              );
            })}
          </div>
        </div>
      )}

      {/* Fallback: any other kinds render in mirror order */}
      {SECTION_ORDER.every(([k]) => k === "tldr" || k === "key-idea" || k === "claim" || k === "question")
        ? null : null}

      {tags.length > 0 && (
        <div className="tag-row">
          {tags.map((t) => (
            <button
              key={t}
              className="tag-chip clickable"
              onClick={() => onTagClick && onTagClick(t)}
              title={onTagClick ? `Search #${t}` : `#${t}`}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {chunks.length > 0 && (
        <details className="collapsible">
          <summary>Transcript · {chunks.length} chunks</summary>
          <div className="coll-body">
            {chunks.slice(0, 60).map((b) => (
              <Block key={b.id} block={b} sourceUrl={sourceUrl} sourceTitle={sourceTitle} />
            ))}
            {chunks.length > 60 && (
              <div className="card-meta">Showing 60 of {chunks.length} — search to jump to a moment.</div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import { ChevronLeft, ChevronRight, ExternalLink, BookOpen, Moon, Sun } from "lucide-react";
import api from "../api.js";
import { apiError } from "../lib.js";

// Dev Core: verbatim reader for the saved SingleFile course pack.
// The backend streams the exact HTML file bytes; this view is a lesson
// list + iframe reader and never touches the content.
const slug = (id) => id.split("/").map(encodeURIComponent).join("/");

// Dark mode is a display-time stylesheet injected into the iframe document
// (same-origin read). Course files stay byte-identical on disk; removing
// the style restores the page exactly as saved. Invert+hue-rotate darkens
// any saved page generically; media is double-inverted to keep true colors.
// The filter targets `body` (not `html`) so root-element propagation quirks
// in some engines can't swallow it; `html` gets a black canvas behind body.
const DARK_CSS = `
html { background: #000 !important; }
body { filter: invert(1) hue-rotate(180deg); background: #fff !important; }
img, video, picture, svg, canvas, embed, object { filter: invert(1) hue-rotate(180deg); }
`;

export default function CourseView({ initialId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(initialId || null);
  const [frameDone, setFrameDone] = useState(false);
  // Dark is the default; only an explicit "0" (user picked Light) opts out.
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("devcore-dark") !== "0";
    } catch {
      return true;
    }
  });
  const frameRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api
      .get("/course/lessons")
      .then((res) => {
        if (!alive) return;
        const groups = (res.data.groups || []).map((g) => ({
          ...g,
          lessons: g.lessons.map((l) => ({ ...l, group: g.name })),
        }));
        setData({ available: res.data.available !== false, groups });
      })
      .catch((err) => toast.error(apiError(err, "Failed to load course")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const all = useMemo(() => {
    if (!data) return [];
    return data.groups.flatMap((g) => g.lessons);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data.groups;
    return data.groups
      .map((g) => ({
        ...g,
        lessons: g.lessons.filter(
          (l) =>
            l.title.toLowerCase().includes(needle) ||
            (l.num || "").includes(needle)
        ),
      }))
      .filter((g) => g.lessons.length);
  }, [data, q]);

  const current = selected ? all.find((l) => l.id === selected) : null;
  const idx = current ? all.findIndex((l) => l.id === selected) : -1;

  const jump = useCallback(
    (lesson) => {
      setSelected(lesson.id);
      setFrameDone(false);
      if (window.innerWidth <= 860) window.scrollTo(0, 0);
    },
    []
  );

  useEffect(() => {
    // Scroll the active lesson into view when selection changes externally.
    const el = listRef.current && listRef.current.querySelector(".lesson-btn.active");
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Inject / remove the dark stylesheet inside the iframe document.
  const applyDark = useCallback(() => {
    const doc = frameRef.current && frameRef.current.contentDocument;
    if (!doc || !doc.documentElement) return;
    const existing = doc.getElementById("crumbbase-dark");
    if (existing) existing.remove();
    if (!dark) return;
    const style = doc.createElement("style");
    style.id = "crumbbase-dark";
    style.textContent = DARK_CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }, [dark]);

  // Re-apply when the toggle flips, a new lesson loads, or the same one reloads.
  useEffect(() => {
    applyDark();
  }, [applyDark, frameDone, selected]);

  useEffect(() => {
    try {
      localStorage.setItem("devcore-dark", dark ? "1" : "0");
    } catch {
      // storage unavailable; toggle still works for the session
    }
  }, [dark]);

  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;

  const close = useCallback(() => {
    setSelected(null);
    if (window.innerWidth <= 860) window.scrollTo(0, 0);
  }, []);

  return (
    <div className={`course-view${current ? " reading" : ""}`}>
      <div className="view-head">
        <h1>
          <BookOpen size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />
          Dev Core
        </h1>
        <span className="spacer" />
        {!current && (
          <input
            className="course-filter"
            placeholder="Filter lessons…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
        {current && (
          <>
            <button className="btn ghost" onClick={() => prev && jump(prev)} disabled={!prev}>
              <ChevronLeft size={16} /> Prev
            </button>
            <button className="btn ghost" onClick={() => next && jump(next)} disabled={!next}>
              Next <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>

      {loading && <div className="dim-note">Loading lessons…</div>}
      {!loading && data && !data.available && (
        <div className="dim-note">
          No course files found. Copy the HTML pack into{" "}
          <code>data/hurry-course/</code> and reload.
        </div>
      )}
      {!loading && data && data.available && (
        <div className="course-wrap">
          <aside className="course-list" ref={listRef}>
            <input
              className="course-filter in-panel"
              placeholder="Filter lessons…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {filtered.map((group) => (
              <div key={group.name} className="course-group">
                <div className="course-group-name">
                  {group.name} <span>({group.lessons.length})</span>
                </div>
                {group.lessons.map((lesson) => (
                  <button
                    key={lesson.id}
                    className={`lesson-btn${selected === lesson.id ? " active" : ""}`}
                    onClick={() => jump(lesson)}
                  >
                    {lesson.num && <span className="lesson-num">{lesson.num}</span>}
                    <span className="lesson-title">{lesson.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>

          <section className="course-reader">
            {current ? (
              <>
                <div className="course-reader-head">
                  <button className="close-lesson" onClick={close} title="Back to lesson list">
                    ← Lessons
                  </button>
                  <span className="course-now">
                    {current.num ? <span className="lesson-num">{current.num}</span> : null}
                    {current.title}
                  </span>
                  {current.url && (
                    <a
                      className="btn ghost head-icon"
                      href={current.url}
                      target="_blank"
                      rel="noreferrer"
                      title="Open original page"
                    >
                      <ExternalLink size={16} />
                    </a>
                  )}
                  <button
                    className="btn ghost head-icon"
                    onClick={() => setDark((d) => !d)}
                    title={dark ? "Switch lesson back to its saved (light) look" : "Dark mode for the lesson content"}
                    aria-label={dark ? "Light mode" : "Dark mode"}
                  >
                    {dark ? <Sun size={16} /> : <Moon size={16} />}
                  </button>
                </div>
                <div className="course-frame-box">
                  {!frameDone && <div className="dim-note frame-loading">Loading lesson…</div>}
                  <iframe
                    key={current.id}
                    ref={frameRef}
                    title={current.title}
                    src={`/api/course/raw/${slug(current.id)}`}
                    onLoad={() => {
                      setFrameDone(true);
                      applyDark();
                    }}
                  />
                </div>
                <div className="course-jump">
                  <select
                    className="course-select"
                    value={current.id}
                    onChange={(e) => {
                      const l = all.find((x) => x.id === e.target.value);
                      if (l) jump(l);
                    }}
                  >
                    {all.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.num ? `${l.num} · ` : ""}
                        {l.title}
                      </option>
                    ))}
                  </select>
                  {current.url && (
                    <a className="btn ghost" href={current.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={15} />
                    </a>
                  )}
                  <div className="course-jump-btns">
                    <button className="btn ghost" onClick={() => prev && jump(prev)} disabled={!prev} aria-label="Previous lesson">
                      <ChevronLeft size={20} />
                    </button>
                    <button className="btn ghost" onClick={() => next && jump(next)} disabled={!next} aria-label="Next lesson">
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="dim-note course-empty">
                Pick a lesson from the list to read it here. Files are shown
                byte-identical to the saved originals — nothing is re-rendered
                or rewritten.
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

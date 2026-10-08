import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { useCorpus, useQuestion } from "../lib/client";
import {
  topics,
  type Corpus,
  type Project,
  type Insight,
  type Source,
} from "../lib/contracts";

type Citation = {
  sourceId: string;
  quote: string;
  page?: number;
  locator?: string;
};
const suggestions = [
  "Where is sim-to-real working?",
  "What is changing in robot manipulation?",
  "Which projects use digital twins?",
];
function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Close() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function Dialog({
  title,
  children,
  close,
  className = "",
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={`drawer ${className}`}
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="drawer-shell">
        <div className="drawer-top">
          <span className="eyebrow" id={id}>
            {title}
          </span>
          <button
            className="icon-button"
            aria-label="Close panel"
            onClick={close}
          >
            <Close />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <p>{children || "Not reported in the collected source."}</p>
    </section>
  );
}
function CitationButtons({
  citations,
  corpus,
  open,
}: {
  citations: Citation[];
  corpus: Corpus;
  open: (citation: Citation) => void;
}) {
  return (
    <div className="citations">
      {citations.map((citation, index) => {
        const source = corpus.sources.find(
          (item) => item.id === citation.sourceId,
        );
        return source ? (
          <button
            className="citation"
            key={`${citation.sourceId}-${index}`}
            onClick={() => open(citation)}
          >
            <span className="citation-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>
              {source.title}
              <small>
                {
                  corpus.schools.find((school) => school.id === source.schoolId)
                    ?.shortName
                }{" "}
                · {source.year}
                {citation.page ? ` · p. ${citation.page}` : ""}
              </small>
            </span>
            <Arrow diagonal />
          </button>
        ) : null;
      })}
    </div>
  );
}
function ProjectDetail({
  project,
  corpus,
  openSource,
}: {
  project: Project;
  corpus: Corpus;
  openSource: (citation: Citation) => void;
}) {
  const school = corpus.schools.find((item) => item.id === project.schoolId);
  return (
    <>
      <p className="detail-meta">
        {school?.name} <span> / </span> {project.year}
      </p>
      <h2 className="detail-title">{project.title}</h2>
      <div className="tags">
        {project.topics.map((topic) => (
          <span key={topic}>{topic}</span>
        ))}
        <span>{project.stage}</span>
      </div>
      <p className="detail-lead">{project.summary}</p>
      <Section title="The problem">{project.problem}</Section>
      <Section title="Current approach">{project.statusQuo}</Section>
      <Section title="Approach">{project.approach}</Section>
      <Section title="Reported results">{project.results}</Section>
      <Section title="Our interpretation">{project.whyItMatters}</Section>
      <Section title="Limitations & open questions">
        {project.limitations}
      </Section>
      {project.authors.length > 0 && (
        <Section title="Researchers">{project.authors.join(", ")}</Section>
      )}
      <section className="detail-section">
        <h3>Source evidence</h3>
        <CitationButtons
          citations={project.evidence}
          corpus={corpus}
          open={openSource}
        />
      </section>
    </>
  );
}
function InsightDetail({
  insight,
  corpus,
  openSource,
  openProject,
}: {
  insight: Insight;
  corpus: Corpus;
  openSource: (citation: Citation) => void;
  openProject: (project: Project) => void;
}) {
  return (
    <>
      <p className="detail-meta">
        {insight.topic} <span> / </span> {insight.confidence}
      </p>
      <h2 className="detail-title">{insight.title}</h2>
      <p className="detail-lead">{insight.summary}</p>
      <Section title="The problem">{insight.problem}</Section>
      <Section title="Current approach">{insight.statusQuo}</Section>
      <Section title="Evidence across projects">{insight.evidence}</Section>
      <Section title="Our interpretation">{insight.opportunity}</Section>
      <Section title="What remains unresolved">{insight.gap}</Section>
      <Section title="Counterpoint">{insight.counterpoint}</Section>
      <Section title="Next question">{insight.nextQuestion}</Section>
      <section className="detail-section">
        <h3>Connected projects</h3>
        <div className="connected-projects">
          {corpus.projects
            .filter((project) => insight.projectIds.includes(project.id))
            .map((project) => (
              <button key={project.id} onClick={() => openProject(project)}>
                {project.title}
                <Arrow />
              </button>
            ))}
        </div>
      </section>
      <section className="detail-section">
        <h3>Original sources</h3>
        <CitationButtons
          citations={insight.sourceIds.map((sourceId) => ({
            sourceId,
            quote:
              corpus.sources.find((source) => source.id === sourceId)
                ?.excerpt ?? "",
          }))}
          corpus={corpus}
          open={openSource}
        />
      </section>
    </>
  );
}
function SourceDetail({
  source,
  citation,
  corpus,
}: {
  source: Source;
  citation: Citation;
  corpus: Corpus;
}) {
  return (
    <>
      <p className="detail-meta">
        {corpus.schools.find((school) => school.id === source.schoolId)?.name}{" "}
        <span> / </span> {source.year}
      </p>
      <h2 className="detail-title source-title">{source.title}</h2>
      <div className="source-label">
        Evidence excerpt{citation.page ? ` · Page ${citation.page}` : ""}
        {citation.locator ? ` · ${citation.locator}` : ""}
      </div>
      <blockquote>{citation.quote || source.excerpt}</blockquote>
      <dl className="source-facts">
        <div>
          <dt>Format</dt>
          <dd>{source.kind.toUpperCase()}</dd>
        </div>
        <div>
          <dt>Accessed</dt>
          <dd>{formatDate(source.accessedAt)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd className="source-url">{source.url}</dd>
        </div>
      </dl>
      <a
        className="primary-link"
        href={
          citation.page && source.kind === "pdf"
            ? `${source.url.split("#")[0]}#page=${citation.page}`
            : source.url
        }
        target="_blank"
        rel="noopener noreferrer"
      >
        Open original source <Arrow diagonal />
      </a>
    </>
  );
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
}

export function Workspace() {
  const { data: corpus, isLoading, error } = useCorpus();
  const { ask, question, isPending, reset } = useQuestion();
  const [text, setText] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [view, setView] = useState<"signals" | "projects">("signals");
  const [topic, setTopic] = useState("");
  const [year, setYear] = useState("");
  const [school, setSchool] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Project | Insight | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const busy =
    isPending ||
    question?.status === "queued" ||
    question?.status === "running";
  async function submit(value: string) {
    if (!value.trim() || busy) return;
    setAskError(null);
    setText(value);
    try {
      await ask(value.trim());
    } catch (failure) {
      setAskError(
        failure instanceof Error
          ? failure.message
          : "The question could not be submitted. Try again.",
      );
    }
  }
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(text);
  }
  const projects = (corpus?.projects ?? []).filter(
    (project) =>
      (!topic || project.topics.includes(topic as (typeof topics)[number])) &&
      (!year || String(project.year) === year) &&
      (!school || project.schoolId === school) &&
      (!search ||
        `${project.title} ${project.summary}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const insights = (corpus?.insights ?? []).filter(
    (insight) =>
      (!topic || insight.topic === topic) &&
      (!search ||
        `${insight.title} ${insight.summary}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const collectedSchools =
    corpus?.schools.filter((item) =>
      corpus.projects.some((project) => project.schoolId === item.id),
    ) ?? [];
  const currentSource = corpus?.sources.find(
    (source) => source.id === citation?.sourceId,
  );
  return (
    <div className="app">
      <a className="skip-link" href="#research">
        Skip to research
      </a>
      <header className="site-header">
        <a href="/" className="wordmark" aria-label="Fieldwork home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          fieldwork<span className="wordmark-dot">.</span>
        </a>
        <span className="header-description">
          An index of emerging research
        </span>
        <a className="header-link" href="#research">
          Explore the research <Arrow />
        </a>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="orange-dash" /> ROBOTICS · SIMULATION · THE REAL
              WORLD
            </p>
            <h1>
              What happens
              <br />
              after the <em>lab?</em>
            </h1>
            <p className="hero-description">
              Follow the ideas moving robotics forward.
              <br className="desktop-break" /> Research from university labs,
              connected through evidence.
            </p>
          </div>
          <div className="question-area">
            <form className="question-form" onSubmit={onSubmit}>
              <label htmlFor="question" className="eyebrow">
                Start with a question
              </label>
              <div className="question-input-row">
                <textarea
                  id="question"
                  maxLength={1200}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="What do you want to understand?"
                  rows={2}
                  required
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void submit(text);
                    }
                  }}
                />
                <button
                  className="ask-button"
                  type="submit"
                  aria-label="Ask research question"
                  disabled={busy || !text.trim()}
                >
                  {busy ? <span className="spinner" /> : <Arrow />}
                </button>
              </div>
              <div className="question-form-footer">
                <span>Answers grounded in collected sources</span>
                <span>↵ Ask</span>
              </div>
            </form>
            <div className="suggestions">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  disabled={busy}
                  onClick={() => void submit(suggestion)}
                >
                  {suggestion}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        </section>
        {(question || askError || busy) && (
          <section
            className="answer-panel"
            aria-live="polite"
            aria-busy={!!busy}
          >
            <div className="answer-heading">
              <span className="eyebrow">
                {busy ? "Reading the research" : "Research answer"}
              </span>
              <button
                className="icon-button"
                aria-label="Dismiss answer"
                onClick={() => {
                  reset();
                  setAskError(null);
                }}
              >
                <Close />
              </button>
            </div>
            {busy && (
              <p className="answer-pending">
                <span className="spinner" />
                {question?.status === "running"
                  ? "Working through the collected evidence…"
                  : "Finding the relevant evidence…"}
              </p>
            )}
            {(askError || question?.status === "failed") && (
              <p className="error-text">
                {askError ||
                  question?.error ||
                  "This question could not be answered. Please try again."}
              </p>
            )}
            {question?.answer && (
              <>
                <p className="answer-text">{question.answer.answer}</p>
                {corpus && (
                  <CitationButtons
                    citations={question.answer.citations}
                    corpus={corpus}
                    open={setCitation}
                  />
                )}
                <div className="answer-followups">
                  {question.answer.followUps.map((followup) => (
                    <button
                      key={followup}
                      onClick={() => void submit(followup)}
                      disabled={busy}
                    >
                      {followup}
                      <Arrow />
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        <section id="research" className="research-section">
          <div className="research-heading">
            <div>
              <p className="eyebrow">The research index</p>
              <h2>Ideas worth a closer look.</h2>
            </div>
            <p className="coverage-label">
              2021—2026<span>Original sources. Open questions.</span>
            </p>
          </div>
          <div className="research-toolbar">
            <div
              className="view-tabs"
              role="tablist"
              aria-label="Research view"
              onKeyDown={(event) => {
                if (
                  event.key === "ArrowLeft" ||
                  event.key === "ArrowRight" ||
                  event.key === "Home" ||
                  event.key === "End"
                ) {
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "signals"
                      : event.key === "End"
                        ? "projects"
                        : view === "signals"
                          ? "projects"
                          : "signals";
                  setView(next);
                  document.getElementById(`${next}-tab`)?.focus();
                }
              }}
            >
              <button
                id="signals-tab"
                role="tab"
                tabIndex={view === "signals" ? 0 : -1}
                aria-selected={view === "signals"}
                aria-controls="research-results"
                onClick={() => setView("signals")}
                className={view === "signals" ? "active" : ""}
              >
                Latest signals
              </button>
              <button
                id="projects-tab"
                role="tab"
                tabIndex={view === "projects" ? 0 : -1}
                aria-selected={view === "projects"}
                aria-controls="research-results"
                onClick={() => setView("projects")}
                className={view === "projects" ? "active" : ""}
              >
                Projects{corpus && <span>{corpus.projects.length}</span>}
              </button>
            </div>
            <label className="search-field">
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="10.5"
                  cy="10.5"
                  r="6.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path d="m16 16 5 5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <input
                aria-label="Search research"
                placeholder="Search the index"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="filter-row">
            <label>
              <span className="sr-only">Filter by topic</span>
              <select
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              >
                <option value="">All topics</option>
                {topics.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            {view === "projects" && (
              <>
                <label>
                  <span className="sr-only">Filter by year</span>
                  <select
                    aria-label="Filter by year"
                    value={year}
                    onChange={(event) => setYear(event.target.value)}
                  >
                    <option value="">All years</option>
                    {[2026, 2025, 2024, 2023, 2022, 2021].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Filter by school</span>
                  <select
                    aria-label="Filter by school"
                    value={school}
                    onChange={(event) => setSchool(event.target.value)}
                  >
                    <option value="">All schools</option>
                    {collectedSchools.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.shortName}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {(topic || year || school || search) && (
              <button
                className="clear-filters"
                onClick={() => {
                  setTopic("");
                  setYear("");
                  setSchool("");
                  setSearch("");
                }}
              >
                Clear filters
              </button>
            )}
            <span className="filter-note">
              {view === "signals"
                ? "Connections across projects"
                : "Collected project records"}
            </span>
          </div>
          <div
            id="research-results"
            role="tabpanel"
            aria-labelledby={
              view === "signals" ? "signals-tab" : "projects-tab"
            }
          >
            {isLoading ? (
              <div className="empty-state" role="status">
                <span className="spinner" />
                <h3>Opening the research index…</h3>
              </div>
            ) : error ? (
              <div className="empty-state">
                <h3>The index is unavailable.</h3>
                <p className="error-text">{error.message}</p>
                <button
                  className="text-link"
                  onClick={() => window.location.reload()}
                >
                  Try again <Arrow />
                </button>
              </div>
            ) : view === "signals" ? (
              <div className="signal-list">
                {insights.map((insight, index) => (
                  <button
                    className="signal-card"
                    key={insight.id}
                    onClick={() => setDetail(insight)}
                  >
                    <div className="signal-number">
                      {String(index + 1).padStart(2, "0")}
                      <span aria-hidden="true">↗</span>
                    </div>
                    <div className="signal-body">
                      <div className="signal-meta">
                        <span>{insight.topic}</span>
                        <span className="confidence">{insight.confidence}</span>
                      </div>
                      <h3>{insight.title}</h3>
                      <p>{insight.summary}</p>
                      <div className="signal-schools">
                        {Array.from(
                          new Set(
                            corpus?.projects
                              .filter((project) =>
                                insight.projectIds.includes(project.id),
                              )
                              .map(
                                (project) =>
                                  corpus.schools.find(
                                    (item) => item.id === project.schoolId,
                                  )?.shortName,
                              )
                              .filter(Boolean),
                          ),
                        ).join(" / ")}
                        <span>
                          {insight.projectIds.length} connected projects
                        </span>
                      </div>
                    </div>
                    <span className="card-arrow">
                      <Arrow />
                    </span>
                  </button>
                ))}
                {!insights.length && (
                  <div className="empty-state">
                    <h3>
                      {search || topic
                        ? "No signals match these filters."
                        : "The next connection starts here."}
                    </h3>
                    <p>
                      {search || topic
                        ? "Try another topic or search."
                        : "Cross-project insights will appear as verified research is collected."}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="project-grid">
                {projects.map((project) => (
                  <button
                    className="project-card"
                    key={project.id}
                    onClick={() => setDetail(project)}
                  >
                    <div className="project-meta">
                      <span>
                        {
                          corpus?.schools.find(
                            (item) => item.id === project.schoolId,
                          )?.shortName
                        }
                      </span>
                      <span>{project.year}</span>
                    </div>
                    <h3>{project.title}</h3>
                    <p>{project.summary}</p>
                    <div className="project-bottom">
                      <span>{project.topics[0] || project.stage}</span>
                      <Arrow />
                    </div>
                  </button>
                ))}
                {!projects.length && (
                  <div className="empty-state">
                    <h3>
                      {search || topic || year || school
                        ? "No projects match these filters."
                        : "Collection is underway."}
                    </h3>
                    <p>
                      {search || topic || year || school
                        ? "Try a broader topic, year, or school."
                        : "Verified project records will appear here with their original sources."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        <aside className="collection-note">
          <span className="note-symbol" aria-hidden="true">
            i
          </span>
          <div>
            <strong>
              {collectedSchools.length} schools collected ·{" "}
              {corpus?.schools.length ?? 50} in scope
            </strong>
            <details>
              <summary>About this collection</summary>
              <p>
                {corpus?.meta.coverageNote ||
                  "A growing, partial collection of public research."}
              </p>
            </details>
          </div>
        </aside>
      </main>
      <footer className="site-footer">
        <span>
          Fieldwork <span className="footer-divider">/</span> Antifund
          Researcher
        </span>
        <a
          href="https://github.com/hansy/antifund_researcher"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub ↗
        </a>
      </footer>
      {detail && corpus && (
        <Dialog
          key={detail.id}
          title={"stage" in detail ? "Project notes" : "Research signal"}
          close={() => setDetail(null)}
        >
          {"stage" in detail ? (
            <ProjectDetail
              project={detail}
              corpus={corpus}
              openSource={setCitation}
            />
          ) : (
            <InsightDetail
              insight={detail}
              corpus={corpus}
              openSource={setCitation}
              openProject={setDetail}
            />
          )}
        </Dialog>
      )}
      {citation && currentSource && corpus && (
        <Dialog
          title="Source record"
          close={() => setCitation(null)}
          className="source-drawer"
        >
          <SourceDetail
            source={currentSource}
            citation={citation}
            corpus={corpus}
          />
        </Dialog>
      )}
    </div>
  );
}

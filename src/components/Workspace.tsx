import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useCorpus } from "../lib/client";
import { getSignalBrief } from "../lib/signals";
import type { Corpus, Insight, Project, Source } from "../lib/contracts";

type Selection = {
  signal: string | null;
  source: string | null;
  project: string | null;
};
const emptySelection: Selection = { signal: null, source: null, project: null };
function readSelection(): Selection {
  const params = new URLSearchParams(window.location.search);
  return {
    signal: params.get("signal"),
    source: params.get("source"),
    project: params.get("project"),
  };
}
function selectionUrl(selection: Selection) {
  const params = new URLSearchParams();
  if (selection.signal) params.set("signal", selection.signal);
  if (selection.source) params.set("source", selection.source);
  if (selection.project) params.set("project", selection.project);
  return params.size ? `/?${params}` : "/";
}
function Arrow({
  back = false,
  external = false,
}: {
  back?: boolean;
  external?: boolean;
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={
          external
            ? "M6 18 18 6M6 6h12v12"
            : back
              ? "M20 12H5m6-6-6 6 6 6"
              : "M4 12h15m-6-6 6 6-6 6"
        }
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function clean(value: string) {
  return value.replace(/^(?:Reported|Our interpretation):\s*/, "");
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
function BriefSection({
  id,
  title,
  children,
  label,
}: {
  id: string;
  title: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <section className="brief-section" id={id}>
      <div className="section-heading">
        <h2>{title}</h2>
        {label && <span className="small-label">{label}</span>}
      </div>
      {children}
    </section>
  );
}
export function Workspace() {
  const { data: corpus, isLoading, error } = useCorpus();
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [ready, setReady] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasNavigated = useRef(false);
  useEffect(() => {
    setSelection(readSelection());
    setReady(true);
    const update = () => {
      hasNavigated.current = true;
      setSelection(readSelection());
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    if (hasNavigated.current) {
      headingRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
  }, [selection]);
  function navigate(event: MouseEvent<HTMLAnchorElement>, next: Selection) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    hasNavigated.current = true;
    window.history.pushState(null, "", selectionUrl(next));
    setSelection(next);
  }
  function internalLink(next: Selection) {
    return {
      href: selectionUrl(next),
      onClick: (event: MouseEvent<HTMLAnchorElement>) => navigate(event, next),
    };
  }
  const insight = corpus?.insights.find((item) => item.id === selection.signal);
  const source =
    insight &&
    corpus?.sources.find(
      (item) =>
        item.id === selection.source && insight.sourceIds.includes(item.id),
    );
  const project =
    insight &&
    corpus?.projects.find(
      (item) =>
        item.id === selection.project &&
        insight.projectIds.includes(item.id) &&
        item.evidence.some((evidence) => evidence.sourceId === source?.id),
    );
  const brief = insight ? getSignalBrief(insight) : null;
  const signalSelection = {
    signal: insight?.id ?? null,
    source: null,
    project: null,
  };
  const unknownSelection =
    ready &&
    corpus &&
    ((selection.signal && !insight) || (selection.source && !source));
  function sourceLink(sourceId: string, projectId?: string) {
    return internalLink({
      signal: insight?.id ?? null,
      source: sourceId,
      project: projectId ?? null,
    });
  }
  return (
    <div className="app">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <a
          {...internalLink(emptySelection)}
          className="wordmark"
          aria-label="Fieldwork home"
        >
          <span className="brand-mark" aria-hidden="true">
            f
          </span>
          <span>Fieldwork</span>
        </a>
        <details className="collection-info">
          <summary aria-label="About this collection">
            <span aria-hidden="true">i</span>
          </summary>
          <div className="info-popover">
            <strong>About this collection</strong>
            <p>
              {corpus?.meta.coverageNote ??
                "Signals are drawn from collected university research sources."}
            </p>
            {corpus && (
              <p>
                Updated {formatDate(corpus.meta.collectedAt)}. Market
                opportunities are our interpretation unless supported by market
                evidence.
              </p>
            )}
          </div>
        </details>
      </header>
      <main id="content">
        {isLoading || !ready ? (
          <div className="state-message" role="status">
            Loading signals…
          </div>
        ) : error ? (
          <div className="state-message" role="alert">
            <h1>Research could not load</h1>
            <p>
              {error instanceof Error ? error.message : "Please try again."}
            </p>
            <button onClick={() => window.location.reload()}>
              Try again <Arrow />
            </button>
          </div>
        ) : unknownSelection ? (
          <div className="state-message">
            <h1 ref={headingRef} tabIndex={-1}>
              This research is unavailable
            </h1>
            <a {...internalLink(emptySelection)}>
              Back to signals <Arrow />
            </a>
          </div>
        ) : corpus && insight && brief ? (
          <>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <a {...internalLink(emptySelection)}>Signals</a>
              <span aria-hidden="true">/</span>
              {source ? (
                <>
                  <a {...internalLink(signalSelection)}>{insight.title}</a>
                  <span aria-hidden="true">/</span>
                  <span aria-current="page">Source</span>
                </>
              ) : (
                <span aria-current="page">{insight.title}</span>
              )}
            </nav>
            <a
              className="back-link"
              {...internalLink(source ? signalSelection : emptySelection)}
            >
              <Arrow back />
              {source ? "Back to signal" : "All signals"}
            </a>
            {source ? (
              <SourceView
                source={source}
                project={project}
                corpus={corpus}
                insight={insight}
                headingRef={headingRef}
              />
            ) : (
              <>
                <div className="brief-header">
                  <p className="eyebrow">{insight.confidence}</p>
                  <h1 ref={headingRef} tabIndex={-1}>
                    {insight.title}
                  </h1>
                  <p className="brief-summary">{insight.summary}</p>
                </div>
                <div className="brief-layout">
                  <nav className="section-nav" aria-label="In this brief">
                    {[
                      ["what", "What it is"],
                      ["problem", "Problem"],
                      ["breakthroughs", "Breakthroughs"],
                      ["market", "Market opportunity"],
                      ["evidence", "Evidence"],
                    ].map(([id, title]) => (
                      <a key={id} href={`#${id}`}>
                        {title}
                      </a>
                    ))}
                  </nav>
                  <div className="brief-body">
                    <BriefSection id="what" title="What it is">
                      <p>{brief.whatItIs}</p>
                    </BriefSection>
                    <BriefSection id="problem" title="Problem">
                      <p>{brief.problem}</p>
                    </BriefSection>
                    <BriefSection
                      id="breakthroughs"
                      title="Breakthroughs"
                      label="Reported research"
                    >
                      <div className="breakthroughs">
                        {brief.breakthroughs.map((item, index) => (
                          <div className="breakthrough" key={index}>
                            <span className="item-number">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div>
                              <p>{clean(item.text)}</p>
                              <div className="inline-sources">
                                {item.sourceIds.map((id) => {
                                  const evidenceSource = corpus.sources.find(
                                    (item) => item.id === id,
                                  );
                                  return evidenceSource ? (
                                    <a key={id} {...sourceLink(id)}>
                                      {evidenceSource.title} <Arrow external />
                                    </a>
                                  ) : null;
                                })}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </BriefSection>
                    <BriefSection
                      id="market"
                      title="Market opportunity"
                      label={
                        brief.marketStatus === "researched"
                          ? "Market research"
                          : "Our hypothesis"
                      }
                    >
                      <p>{brief.marketOpportunity}</p>
                      <div className="buyer">
                        <span className="small-label">Potential buyer</span>
                        <p>{brief.buyer}</p>
                      </div>
                      {brief.marketEvidence.length > 0 && (
                        <details className="deeper-detail">
                          <summary>Market context</summary>
                          <div className="market-sources">
                            {brief.marketEvidence.map((item) => (
                              <div key={item.url}>
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {item.title} <Arrow external />
                                </a>
                                <blockquote>{item.excerpt}</blockquote>
                                <small>
                                  Accessed {formatDate(item.accessedAt)}
                                </small>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {(brief.risks.length > 0 ||
                        brief.nextQuestions.length > 0) && (
                        <details className="deeper-detail">
                          <summary>Risks & questions</summary>
                          {brief.risks.length > 0 && (
                            <div className="open-questions">
                              <h3>Risks</h3>
                              <ul>
                                {brief.risks.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {brief.nextQuestions.length > 0 && (
                            <div className="open-questions">
                              <h3>Questions to resolve</h3>
                              <ul>
                                {brief.nextQuestions.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </details>
                      )}
                    </BriefSection>
                    <BriefSection id="evidence" title="Evidence">
                      <div className="evidence-list">
                        {corpus.projects
                          .filter((item) =>
                            insight.projectIds.includes(item.id),
                          )
                          .map((item) => {
                            const school = corpus.schools.find(
                              (school) => school.id === item.schoolId,
                            );
                            return (
                              <div className="evidence-row" key={item.id}>
                                <p className="evidence-meta">
                                  {school?.shortName ?? school?.name}{" "}
                                  <span>·</span> {item.year}
                                </p>
                                <h3>{item.title}</h3>
                                <p>{item.summary}</p>
                                <div className="evidence-source-links">
                                  {item.evidence
                                    .filter(
                                      (evidence, index, all) =>
                                        all.findIndex(
                                          (other) =>
                                            other.sourceId ===
                                            evidence.sourceId,
                                        ) === index,
                                    )
                                    .map((evidence, index) => {
                                      const evidenceSource =
                                        corpus.sources.find(
                                          (source) =>
                                            source.id === evidence.sourceId,
                                        );
                                      return evidenceSource ? (
                                        <a
                                          key={`${evidence.sourceId}-${index}`}
                                          {...sourceLink(
                                            evidence.sourceId,
                                            item.id,
                                          )}
                                        >
                                          Read source
                                          {evidence.page
                                            ? ` · p. ${evidence.page}`
                                            : ""}
                                          <Arrow />
                                        </a>
                                      ) : null;
                                    })}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </BriefSection>
                  </div>
                </div>
              </>
            )}
          </>
        ) : corpus ? (
          <section className="signals-index">
            <div className="index-heading">
              <h1 ref={headingRef} tabIndex={-1}>
                Signals
              </h1>
            </div>
            <div className="signal-list">
              {corpus.insights.map((item, index) => (
                <a
                  key={item.id}
                  {...internalLink({
                    signal: item.id,
                    source: null,
                    project: null,
                  })}
                  className="signal-row"
                >
                  <span className="signal-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="signal-copy">
                    <h2>{item.title}</h2>
                    <p>{item.summary}</p>
                  </div>
                  <span className="signal-arrow">
                    <Arrow />
                  </span>
                </a>
              ))}
            </div>
            {corpus.insights.length === 0 && (
              <p className="state-message">No signals collected yet.</p>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
function SourceView({
  source,
  project,
  corpus,
  insight,
  headingRef,
}: {
  source: Source;
  project: Project | undefined;
  corpus: Corpus;
  insight: Insight;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const school = corpus.schools.find((item) => item.id === source.schoolId);
  const projects = project
    ? [project]
    : corpus.projects.filter(
        (item) =>
          insight.projectIds.includes(item.id) &&
          item.evidence.some((evidence) => evidence.sourceId === source.id),
      );
  const citations = projects.flatMap((item) =>
    item.evidence.filter((evidence) => evidence.sourceId === source.id),
  );
  const excerpts = citations.length
    ? citations.filter(
        (item, index) =>
          citations.findIndex(
            (other) => other.quote === item.quote && other.page === item.page,
          ) === index,
      )
    : [{ quote: source.excerpt, page: undefined, locator: undefined }];
  const originalUrl =
    excerpts[0]?.page && source.kind === "pdf"
      ? `${source.url.split("#")[0]}#page=${excerpts[0].page}`
      : source.url;
  return (
    <article className="source-view">
      <div className="source-header">
        <h1 ref={headingRef} tabIndex={-1}>
          {source.title}
        </h1>
        <p className="source-meta">
          {school?.name} <span>·</span> {source.year}
        </p>
      </div>
      <div className="source-layout">
        <div className="source-context">
          <section>
            <h2>Who</h2>
            <p>{school?.name}</p>
            {projects.map((item) =>
              item.authors.length > 0 ? (
                <p key={item.id} className="researchers">
                  {item.authors.join(", ")}
                </p>
              ) : null,
            )}
          </section>
          {projects.map((item) => (
            <div className="project-context" key={item.id}>
              <section>
                <h2>What they did</h2>
                {projects.length > 1 && <h3>{item.title}</h3>}
                <p>{clean(item.approach)}</p>
              </section>
              <section>
                <h2>Reported result</h2>
                <p>{clean(item.results)}</p>
              </section>
              <section>
                <h2>Why it matters</h2>
                <span className="small-label">Our interpretation</span>
                <p>{clean(item.whyItMatters)}</p>
              </section>
              {item.limitations && (
                <section>
                  <h2>Limitations</h2>
                  <p>{clean(item.limitations)}</p>
                </section>
              )}
            </div>
          ))}
        </div>
        <div className="source-evidence">
          <div className="section-heading">
            <h2>Exact excerpt</h2>
          </div>
          {excerpts.map((item, index) => (
            <div className="excerpt" key={index}>
              <blockquote>{item.quote}</blockquote>
              {(item.page || item.locator) && (
                <p className="excerpt-locator">
                  {item.page ? `Page ${item.page}` : ""}
                  {item.page && item.locator ? " · " : ""}
                  {item.locator}
                </p>
              )}
            </div>
          ))}
          <dl className="source-facts">
            <div>
              <dt>Published</dt>
              <dd>{source.year}</dd>
            </div>
            <div>
              <dt>Accessed</dt>
              <dd>{formatDate(source.accessedAt)}</dd>
            </div>
            <div>
              <dt>Original URL</dt>
              <dd>
                <a href={originalUrl} target="_blank" rel="noopener noreferrer">
                  {source.url}
                </a>
              </dd>
            </div>
          </dl>
          <a
            className="original-link"
            href={originalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open original source <Arrow external />
          </a>
        </div>
      </div>
    </article>
  );
}

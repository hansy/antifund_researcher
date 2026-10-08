import {
  answerSchema,
  corpusSchema,
  type Corpus,
  type Answer,
} from "../src/lib/contracts";
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function validateCorpus(input: unknown): Corpus {
  const data = corpusSchema.parse(input);
  for (const records of [
    data.schools,
    data.sources,
    data.projects,
    data.insights,
  ]) {
    const ids = new Set<string>();
    for (const record of records) {
      if (!slug.test(record.id) || ids.has(record.id))
        throw new Error(`Invalid or duplicate id: ${record.id}`);
      ids.add(record.id);
    }
  }
  const schools = new Set(data.schools.map((s) => s.id));
  const sources = new Map(data.sources.map((s) => [s.id, s]));
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const now = Date.now() + 86_400_000;
  for (const date of [
    data.meta.collectedAt,
    ...data.sources.map((s) => s.accessedAt),
  ]) {
    if (
      !/^\d{4}-\d{2}-\d{2}/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      Date.parse(date) > now
    )
      throw new Error("Invalid collection date");
  }
  for (const source of data.sources) {
    if (!schools.has(source.schoolId))
      throw new Error(`Unknown source school: ${source.id}`);
    if (!["http:", "https:"].includes(new URL(source.url).protocol))
      throw new Error("Source must use HTTP(S)");
  }
  for (const project of data.projects) {
    if (!schools.has(project.schoolId))
      throw new Error(`Unknown project school: ${project.id}`);
    for (const citation of project.evidence) {
      const source = sources.get(citation.sourceId);
      if (!source || source.schoolId !== project.schoolId)
        throw new Error(`Invalid project citation: ${project.id}`);
      if (!citation.quote.trim()) throw new Error("Empty quote");
    }
  }
  for (const insight of data.insights) {
    if (
      insight.projectIds.some((id) => !projects.has(id)) ||
      insight.sourceIds.some((id) => !sources.has(id))
    )
      throw new Error(`Invalid insight refs: ${insight.id}`);
    const linked = new Set(
      insight.projectIds.flatMap((id) =>
        projects.get(id)!.evidence.map((e) => e.sourceId),
      ),
    );
    if (insight.sourceIds.some((id) => !linked.has(id)))
      throw new Error(`Insight source is unrelated: ${insight.id}`);
    if (insight.brief) {
      const allowed = new Set(insight.sourceIds);
      if (
        insight.brief.breakthroughs.some((claim) =>
          claim.sourceIds.some((id) => !allowed.has(id)),
        )
      )
        throw new Error(`Breakthrough source is unrelated: ${insight.id}`);
      if (
        insight.brief.marketStatus === "researched" &&
        !insight.brief.marketEvidence.length
      )
        throw new Error(`Market research requires evidence: ${insight.id}`);
      for (const evidence of insight.brief.marketEvidence) {
        const url = new URL(evidence.url);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error("Market evidence must use a public HTTPS source");
        if (
          !Number.isFinite(Date.parse(evidence.accessedAt)) ||
          Date.parse(evidence.accessedAt) > now
        )
          throw new Error("Invalid market research date");
      }
    }
  }
  return data;
}
export function validateAnswer(
  input: unknown,
  corpus: Pick<Corpus, "projects" | "sources">,
): Answer {
  const answer = answerSchema.parse(input);
  if (
    !answer.answer.trim() ||
    answer.answer.length > 12_000 ||
    answer.citations.length > 12 ||
    answer.projectIds.length > 12
  )
    throw new Error("Answer exceeds bounds");
  const projectIds = new Set(corpus.projects.map((p) => p.id));
  const sources = new Map(corpus.sources.map((s) => [s.id, s]));
  if (answer.projectIds.some((id) => !projectIds.has(id)))
    throw new Error("Unknown answer project");
  const normalize = (text: string) =>
    text.replace(/\s+/g, " ").trim().toLowerCase();
  for (const citation of answer.citations) {
    const source = sources.get(citation.sourceId);
    const quotes = corpus.projects.flatMap((p) =>
      p.evidence
        .filter(
          (e) =>
            e.sourceId === citation.sourceId &&
            (citation.page === undefined || citation.page === e.page),
        )
        .map((e) => e.quote),
    );
    if (
      !source ||
      citation.quote.trim().length < 12 ||
      citation.quote.length > 2000 ||
      ![source.excerpt, ...quotes].some((text) =>
        normalize(text).includes(normalize(citation.quote)),
      )
    )
      throw new Error("Citation is not grounded in supplied evidence");
    if (
      citation.page !== undefined &&
      !quotes.some((text) =>
        normalize(text).includes(normalize(citation.quote)),
      )
    )
      throw new Error("Unverified page reference");
  }
  if (answer.projectIds.length > 0 && answer.citations.length === 0)
    throw new Error("Project claims require citations");
  return answer;
}
export const LEASE_MS = 4 * 60_000;
export function leaseMatches(
  job: {
    status: string;
    leaseToken?: string;
    workerId?: string;
    leaseUntil?: number;
  },
  workerId: string,
  token: string,
  now: number,
) {
  return (
    job.status === "running" &&
    job.workerId === workerId &&
    job.leaseToken === token &&
    (job.leaseUntil ?? 0) > now
  );
}
export function retrieve(corpus: Corpus, question: string) {
  const words = [
    ...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []),
  ].filter(
    (w) =>
      ![
        "what",
        "which",
        "with",
        "from",
        "that",
        "have",
        "does",
        "this",
        "about",
        "research",
        "projects",
        "robotics",
      ].includes(w),
  );
  const documents = corpus.projects.map((project) => ({
    project,
    title: [project.title, ...project.topics].join(" ").toLowerCase(),
    body: [
      project.summary,
      project.problem,
      project.approach,
      project.results,
      project.statusQuo,
      project.whyItMatters,
      project.limitations,
    ]
      .join(" ")
      .toLowerCase(),
  }));
  // Rare terms retain weight when a question spans a common topic and a smaller one.
  const weights = new Map(
    words.map((word) => [
      word,
      Math.log(
        1 +
          documents.length /
            (1 +
              documents.filter(
                (d) => d.title.includes(word) || d.body.includes(word),
              ).length),
      ),
    ]),
  );
  const ranked = documents
    .map((d) => ({
      project: d.project,
      score: words.reduce(
        (score, word) =>
          score +
          weights.get(word)! *
            ((d.title.includes(word) ? 0.75 : 0) +
              (d.body.includes(word) ? 1 : 0)),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const projects: Corpus["projects"] = [];
  const ids = new Set<string>();
  for (const candidate of ranked) {
    if (projects.length >= 12) break;
    if (words.length && candidate.score === 0) continue;
    const candidateIds = candidate.project.evidence.map((e) => e.sourceId);
    if (new Set([...ids, ...candidateIds]).size > 16) continue;
    projects.push(candidate.project);
    for (const id of candidateIds) ids.add(id);
  }
  return {
    ...corpus,
    projects,
    sources: corpus.sources
      .filter((s) => ids.has(s.id))
      .map((s) => ({ ...s, excerpt: s.excerpt.slice(0, 6000) })),
    insights: [],
  };
}

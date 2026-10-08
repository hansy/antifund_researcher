import { v } from "convex/values";
export const recordKind = v.union(
  v.literal("candidate"),
  v.literal("item"),
  v.literal("cell"),
  v.literal("edge"),
  v.literal("cluster"),
  v.literal("opportunity"),
);
const topic = v.string();
export const evidence = v.object({
  sourceId: v.string(),
  quote: v.string(),
  page: v.optional(v.number()),
  locator: v.optional(v.string()),
});
export const school = v.object({
  id: v.string(),
  name: v.string(),
  shortName: v.string(),
  country: v.string(),
  domain: v.string(),
  rank: v.number(),
  discoveryUrls: v.array(v.string()),
});
export const source = v.object({
  id: v.string(),
  schoolId: v.string(),
  title: v.string(),
  url: v.string(),
  kind: v.union(
    v.literal("page"),
    v.literal("pdf"),
    v.literal("paper"),
    v.literal("video"),
  ),
  year: v.number(),
  accessedAt: v.string(),
  excerpt: v.string(),
});
const person = v.object({
  authorName: v.string(),
  name: v.string(),
  bio: v.optional(v.string()),
  affiliation: v.optional(v.string()),
  photoUrl: v.optional(v.string()),
  links: v.optional(
    v.object({
      website: v.optional(v.string()),
      x: v.optional(v.string()),
      linkedin: v.optional(v.string()),
    }),
  ),
  sources: v.array(
    v.object({ url: v.string(), excerpt: v.string(), accessedAt: v.string() }),
  ),
});
export const project = v.object({
  id: v.string(),
  schoolId: v.string(),
  title: v.string(),
  year: v.number(),
  summary: v.string(),
  problem: v.string(),
  approach: v.string(),
  whyItMatters: v.string(),
  statusQuo: v.string(),
  results: v.string(),
  limitations: v.string(),
  topics: v.array(topic),
  stage: v.union(
    v.literal("Unknown"),
    v.literal("Concept"),
    v.literal("Simulation"),
    v.literal("Hardware"),
    v.literal("Deployment"),
  ),
  authors: v.array(v.string()),
  people: v.optional(v.array(person)),
  evidence: v.array(evidence),
});
export const insight = v.object({
  id: v.string(),
  title: v.string(),
  summary: v.string(),
  topic,
  problem: v.string(),
  statusQuo: v.string(),
  gap: v.string(),
  opportunity: v.string(),
  evidence: v.string(),
  counterpoint: v.string(),
  nextQuestion: v.string(),
  projectIds: v.array(v.string()),
  sourceIds: v.array(v.string()),
  confidence: v.union(
    v.literal("Early signal"),
    v.literal("Supported"),
    v.literal("Mixed evidence"),
  ),
  brief: v.optional(
    v.object({
      whatItIs: v.string(),
      problem: v.string(),
      breakthroughs: v.array(
        v.object({
          text: v.string(),
          sourceIds: v.array(v.string()),
        }),
      ),
      marketOpportunity: v.string(),
      buyer: v.string(),
      marketSize: v.optional(
        v.object({
          value: v.string(),
          market: v.string(),
          year: v.number(),
          context: v.string(),
          sourceUrls: v.array(v.string()),
        }),
      ),
      applications: v.optional(v.array(v.string())),
      targetCustomers: v.optional(v.array(v.string())),
      marketStatus: v.union(v.literal("hypothesis"), v.literal("researched")),
      marketEvidence: v.array(
        v.object({
          title: v.string(),
          url: v.string(),
          excerpt: v.string(),
          accessedAt: v.string(),
        }),
      ),
      risks: v.array(v.string()),
      nextQuestions: v.array(v.string()),
    }),
  ),
});
export const meta = v.object({
  collectedAt: v.string(),
  rankingName: v.string(),
  rankingUrl: v.string(),
  coverageNote: v.string(),
});
export const corpus = v.object({
  schools: v.array(school),
  sources: v.array(source),
  projects: v.array(project),
  insights: v.array(insight),
  meta,
});
export const answer = v.object({
  answer: v.string(),
  citations: v.array(
    v.object({
      sourceId: v.string(),
      quote: v.string(),
      page: v.optional(v.number()),
    }),
  ),
  projectIds: v.array(v.string()),
  followUps: v.array(v.string()),
});

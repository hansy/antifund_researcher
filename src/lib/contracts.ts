import { z } from "zod";

export const topics = [
  "Robot learning",
  "Simulation",
  "Manipulation",
  "Locomotion",
  "Autonomy",
  "Sensing",
  "Digital twins",
] as const;
export const sourceSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  title: z.string(),
  url: z.url(),
  kind: z.enum(["page", "pdf", "paper", "video"]),
  year: z.number().int().min(2021).max(2026),
  accessedAt: z.string(),
  excerpt: z.string(),
});
export const schoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
  country: z.string(),
  domain: z.string(),
  rank: z.number().int().positive(),
  discoveryUrls: z.array(z.url()),
});
export const evidenceSchema = z.object({
  sourceId: z.string(),
  quote: z.string(),
  page: z.number().int().positive().optional(),
  locator: z.string().optional(),
});
export const projectSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  title: z.string(),
  year: z.number().int().min(2021).max(2026),
  summary: z.string(),
  problem: z.string(),
  approach: z.string(),
  whyItMatters: z.string(),
  statusQuo: z.string(),
  results: z.string(),
  limitations: z.string(),
  topics: z.array(z.string().min(1)),
  stage: z.enum(["Unknown", "Concept", "Simulation", "Hardware", "Deployment"]),
  authors: z.array(z.string()),
  evidence: z.array(evidenceSchema).min(1),
});
export const signalBriefSchema = z.object({
  whatItIs: z.string().min(1),
  problem: z.string().min(1),
  breakthroughs: z
    .array(
      z.object({
        text: z.string().min(1),
        sourceIds: z.array(z.string()).min(1),
      }),
    )
    .min(1),
  marketOpportunity: z.string().min(1),
  buyer: z.string().min(1),
  marketSize: z
    .object({
      value: z.string().min(1),
      market: z.string().min(1),
      year: z.number().int().min(2021).max(2026),
      context: z.string().min(1),
      sourceUrls: z.array(z.url()).min(1),
    })
    .optional(),
  applications: z.array(z.string().min(1)).optional(),
  targetCustomers: z.array(z.string().min(1)).optional(),
  marketStatus: z.enum(["hypothesis", "researched"]),
  marketEvidence: z.array(
    z.object({
      title: z.string().min(1),
      url: z.url(),
      excerpt: z.string().min(1),
      accessedAt: z.string(),
    }),
  ),
  risks: z.array(z.string()),
  nextQuestions: z.array(z.string()),
});
export const insightSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  topic: z.string().min(1),
  problem: z.string(),
  statusQuo: z.string(),
  gap: z.string(),
  opportunity: z.string(),
  evidence: z.string(),
  counterpoint: z.string(),
  nextQuestion: z.string(),
  projectIds: z.array(z.string()).min(2),
  sourceIds: z.array(z.string()).min(1),
  confidence: z.enum(["Early signal", "Supported", "Mixed evidence"]),
  brief: signalBriefSchema.optional(),
});
export const corpusSchema = z.object({
  schools: z.array(schoolSchema),
  sources: z.array(sourceSchema),
  projects: z.array(projectSchema),
  insights: z.array(insightSchema),
  meta: z.object({
    collectedAt: z.string(),
    rankingName: z.string(),
    rankingUrl: z.url(),
    coverageNote: z.string(),
  }),
});
export const answerSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({
      sourceId: z.string(),
      quote: z.string(),
      page: z.number().int().positive().optional(),
    }),
  ),
  projectIds: z.array(z.string()),
  followUps: z.array(z.string()).max(3),
});
export type School = z.infer<typeof schoolSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Insight = z.infer<typeof insightSchema>;
export type SignalBrief = z.infer<typeof signalBriefSchema>;
export type Corpus = z.infer<typeof corpusSchema>;
export type Answer = z.infer<typeof answerSchema>;

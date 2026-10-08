import { queryGeneric as query } from "convex/server";
const clean = <T extends { _id: unknown; _creationTime: number }>(doc: T) => {
  const { _id, _creationTime, ...record } = doc;
  return record;
};
export const get = query({
  args: {},
  handler: async (ctx) => {
    const [schools, sources, projects, insights, metadata] = await Promise.all([
      ctx.db.query("schools").collect(),
      ctx.db.query("sources").collect(),
      ctx.db.query("projects").collect(),
      ctx.db.query("insights").collect(),
      ctx.db
        .query("meta")
        .withIndex("by_key", (q) => q.eq("key", "corpus"))
        .first(),
    ]);
    return {
      schools: schools.map(clean),
      sources: sources.map(clean),
      projects: projects.map(clean),
      insights: insights.map(clean),
      meta: metadata?.value ?? {
        collectedAt: new Date().toISOString(),
        rankingName: "Registry pending import",
        rankingUrl: "https://www.topuniversities.com/",
        coverageNote: "No collection imported yet.",
      },
    };
  },
});

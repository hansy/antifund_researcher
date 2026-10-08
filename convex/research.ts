import { mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";
import { corpus } from "./validators";
import { requireSecret } from "./security";
import { validateCorpus } from "../scripts/validation";
export const ingest = mutation({
  args: { secret: v.string(), corpus },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const data = validateCorpus(args.corpus);
    for (const table of [
      "schools",
      "sources",
      "projects",
      "insights",
    ] as const) {
      for (const record of data[table]) {
        const existing = await ctx.db
          .query(table)
          .withIndex("by_slug", (q) => q.eq("id", record.id))
          .unique();
        if (existing) await ctx.db.replace(existing._id, record);
        else await ctx.db.insert(table, record);
      }
    }
    const existing = await ctx.db
      .query("meta")
      .withIndex("by_key", (q) => q.eq("key", "corpus"))
      .unique();
    if (existing)
      await ctx.db.replace(existing._id, { key: "corpus", value: data.meta });
    else await ctx.db.insert("meta", { key: "corpus", value: data.meta });
    return {
      schools: data.schools.length,
      sources: data.sources.length,
      projects: data.projects.length,
      insights: data.insights.length,
    };
  },
});

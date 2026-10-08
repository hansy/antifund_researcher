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
    // The UI shows the current synthesis; superseded work remains in the archive.
    const currentSignals = new Set(data.insights.map((insight) => insight.id));
    for (const previous of await ctx.db.query("insights").collect()) {
      if (!currentSignals.has(previous.id)) {
        const { _id, _creationTime, ...record } = previous;
        await ctx.db.insert("researchRevisions", {
          kind: "insights",
          recordId: previous.id,
          recordedAt: Date.now(),
          payload: JSON.stringify(record),
        });
        await ctx.db.delete(_id);
      }
    }
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
        if (existing) {
          const { _id, _creationTime, ...old } = existing;
          if (
            JSON.stringify(old) !== JSON.stringify(record) &&
            table !== "schools"
          ) {
            await ctx.db.insert("researchRevisions", {
              kind: table,
              recordId: record.id,
              recordedAt: Date.now(),
              payload: JSON.stringify(old),
            });
          }
          await ctx.db.replace(_id, record);
        } else await ctx.db.insert(table, record);
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

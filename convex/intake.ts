import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSecret } from "./security";
import { recordKind } from "./validators";
export const recordBatch = mutation({
  args: {
    secret: v.string(),
    records: v.array(
      v.object({
        kind: recordKind,
        recordId: v.string(),
        revision: v.string(),
        payload: v.string(),
        updatedAt: v.string(),
      }),
    ),
  },
  handler: async (ctx, { secret, records }) => {
    requireSecret(secret);
    if (records.length > 75)
      throw new Error("Archive batch exceeds 75 records");
    let added = 0;
    for (const record of records) {
      if (
        !/^[a-f0-9]{64}$/.test(record.revision) ||
        record.payload.length > 400_000
      )
        throw new Error("Invalid archive revision");
      JSON.parse(record.payload);
      const existing = await ctx.db
        .query("collectionRecords")
        .withIndex("by_revision", (q) =>
          q
            .eq("kind", record.kind)
            .eq("recordId", record.recordId)
            .eq("revision", record.revision),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("collectionRecords", record);
        added++;
      }
    }
    return { added };
  },
});
export const setStatus = mutation({
  args: { secret: v.string(), updatedAt: v.string(), summary: v.string() },
  handler: async (ctx, { secret, updatedAt, summary }) => {
    requireSecret(secret);
    if (summary.length > 400_000) throw new Error("Status exceeds bounds");
    JSON.parse(summary);
    const old = await ctx.db
      .query("collectionState")
      .withIndex("by_key", (q) => q.eq("key", "intake"))
      .unique();
    const record = { key: "intake", updatedAt, summary };
    if (old) await ctx.db.replace(old._id, record);
    else await ctx.db.insert("collectionState", record);
  },
});
export const status = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    requireSecret(secret);
    const state = await ctx.db
      .query("collectionState")
      .withIndex("by_key", (q) => q.eq("key", "intake"))
      .unique();
    return state ? JSON.parse(state.summary) : null;
  },
});

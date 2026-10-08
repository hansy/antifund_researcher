import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { school, source, project, insight, meta, answer } from "./validators";
import { recordKind } from "./validators";
export default defineSchema({
  schools: defineTable(school).index("by_slug", ["id"]),
  sources: defineTable(source).index("by_slug", ["id"]),
  projects: defineTable(project).index("by_slug", ["id"]),
  insights: defineTable(insight).index("by_slug", ["id"]),
  researchRevisions: defineTable({
    kind: v.union(
      v.literal("sources"),
      v.literal("projects"),
      v.literal("insights"),
    ),
    recordId: v.string(),
    recordedAt: v.number(),
    payload: v.string(),
  }).index("by_record", ["kind", "recordId"]),
  collectionRecords: defineTable({
    kind: recordKind,
    recordId: v.string(),
    revision: v.string(),
    payload: v.string(),
    updatedAt: v.string(),
  }).index("by_revision", ["kind", "recordId", "revision"]),
  collectionState: defineTable({
    key: v.string(),
    updatedAt: v.string(),
    summary: v.string(),
  }).index("by_key", ["key"]),
  meta: defineTable({ key: v.string(), value: meta }).index("by_key", ["key"]),
  questions: defineTable({
    text: v.string(),
    clientKey: v.string(),
    createdAt: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    attempts: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    workerId: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    answer: v.optional(answer),
    error: v.optional(v.string()),
  })
    .index("by_created", ["createdAt"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_client_created", ["clientKey", "createdAt"]),
  worker: defineTable({
    key: v.string(),
    workerId: v.string(),
    seenAt: v.number(),
  }).index("by_key", ["key"]),
});

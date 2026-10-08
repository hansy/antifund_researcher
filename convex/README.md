# Convex backend

`corpus.get` serves the research index. `research.ingest` validates and upserts records. `questions` handles bounded enqueueing, worker leases, completion and heartbeat.

Set `RESEARCH_WRITE_SECRET` in the deployment environment. All writes require it. Generated API files are committed so a fresh checkout can typecheck before connecting a deployment.

See [setup](../README.md) and [runner behavior](../docs/PIPELINE.md).

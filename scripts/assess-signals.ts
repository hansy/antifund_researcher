/** A finite, resumable private assessment pass. Never writes intake, Convex or public corpus. */
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { runCodex } from "./codex";
import { hash, type State, type Item } from "./intake/model";
import { evidencePresent } from "./intake";
import { download, htmlText } from "./intake/network";
import {
  ASSESSMENT_PROMPT,
  RUBRIC_VERSION,
  assessSignal,
  assessmentBatchSchema,
  identityUnits,
  marketFactSchema,
  type VerifiedMarketFact,
  type SignalAssessment,
} from "./signal-strength";

export async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}
export async function verifyAssessmentInput(state: State) {
  const candidates = new Map(
    state.candidates.map((candidate) => [candidate.id, candidate]),
  );
  let quotations = 0;
  for (const item of state.items) {
    const revision = candidates
      .get(item.candidateId)
      ?.revisions.find((revision) => revision.hash === item.revisionHash);
    if (!revision?.textPath)
      throw new Error(`Missing source text for ${item.id}`);
    const text = await readFile(revision.textPath, "utf8");
    if (
      !item.evidence.length ||
      item.evidence.some(
        (evidence) =>
          evidence.sourceUrl !== revision.finalUrl ||
          !evidencePresent(text, evidence.quote, evidence.page),
      )
    )
      throw new Error(`Retained quotation/page/source mismatch for ${item.id}`);
    quotations += item.evidence.length;
  }
  return { records: state.items.length, quotations };
}
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
export async function verifyMarketFacts(
  facts: z.infer<typeof marketFactSchema>[],
  directory: string,
  downloader = download,
): Promise<VerifiedMarketFact[]> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const verified: VerifiedMarketFact[] = [];
  const words = new Map<string, number>();
  for (const fact of facts) {
    const count =
      (words.get(fact.url) ?? 0) + fact.excerpt.trim().split(/\s+/).length;
    if (count > 25)
      throw new Error(`Market quotation budget exceeded: ${fact.url}`);
    words.set(fact.url, count);
    const cachePath = join(directory, `${hash(JSON.stringify(fact))}.json`);
    try {
      const cached = JSON.parse(
        await readFile(cachePath, "utf8"),
      ) as VerifiedMarketFact;
      const bytes = await readFile(
        join(directory, `${cached.contentHash}.html`),
      );
      if (
        cached.id === fact.id &&
        hash(bytes) === cached.contentHash &&
        normalize(htmlText(bytes.toString())).includes(normalize(fact.excerpt))
      ) {
        verified.push({
          ...fact,
          accessedAt: cached.accessedAt,
          contentHash: cached.contentHash,
          finalUrl: cached.finalUrl,
        });
        continue;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const host = new URL(fact.url).hostname;
    const fetched = await downloader(
      fact.url,
      [{ id: "context", name: host, domain: host, discoveryUrls: [] }],
      undefined,
      5_000_000,
    );
    if (
      !fetched.contentType.includes("html") &&
      !fetched.contentType.includes("text/plain")
    )
      throw new Error(
        "Market context requires an HTML/text source; PDF facts need page-aware ingestion first",
      );
    const contentHash = hash(fetched.bytes);
    await writeFile(join(directory, `${contentHash}.html`), fetched.bytes, {
      mode: 0o600,
    });
    if (
      !normalize(htmlText(fetched.bytes.toString())).includes(
        normalize(fact.excerpt),
      )
    )
      throw new Error(`Market context excerpt mismatch: ${fact.url}`);
    const value = {
      ...fact,
      accessedAt: new Date().toISOString(),
      contentHash,
      finalUrl: fetched.finalUrl,
    };
    await atomicJson(cachePath, value);
    verified.push(value);
  }
  return verified;
}

export function renderAssessments(
  assessments: SignalAssessment[],
  facts: VerifiedMarketFact[],
  total: number,
) {
  const rank = { Strong: 0, Building: 1, Emerging: 2 };
  const sorted = assessments
    .filter((assessment) => assessment.rawRecords > 1)
    .sort(
      (a, b) =>
        rank[a.strength] - rank[b.strength] ||
        b.independentProjects - a.independentProjects,
    );
  return (
    `# Private signal assessments\n\n${sorted.length} recurring candidates assessed; ${assessments.length - sorted.length} individual leads assigned conservative rule-based baselines; ${total - assessments.length} notes pending. These are overlapping candidate patterns, not a count of distinct signals or projects. Individual leads remain in assessments.json. Publication is not authorized. Coverage remains partial; the selected archive retains unknown dates and event gaps.\n\nStrength, evidence confidence, and market support are separate. Broad market figures are context, never product TAM. Source quotations support reported claims; interpretations remain provisional.\n\n` +
    sorted
      .map((a) => {
        const references = a.market.links.map((link) => {
          const fact = facts.find((fact) => fact.id === link.factId)!;
          return `- **${fact.kind}; ${link.relevance}** — ${fact.finding} ${link.interpretation}\n  ${fact.basis}; ${fact.period}; ${fact.geography}; ${fact.segment}. ${fact.limitation}\n  [${fact.title}](${fact.url}), published ${fact.publishedAt ?? "unknown"}, accessed ${fact.accessedAt}. Retained quote: “${fact.excerpt}”`;
        });
        return (
          `## ${a.pattern}\n\n**${a.strength} · ${a.confidence} confidence · Market ${a.market.support}**\n\n${a.whyItMatters}\n\n${a.strengthReason}\n\nConfidence: ${a.confidenceReason} ${a.caps.join(" ")}\n\nMomentum: ${a.momentum.explanation}\n\nRobustness: ${a.robustness.explanation}\n\n${a.rawRecords} raw records, ${a.sourceUrls} source URLs, ${a.independentProjects} confirmed independent project units within this note; counts do not add across notes.\n\n` +
          a.observations
            .map((observation) => {
              const project = a.supportingProjects.find((project) =>
                project.itemIds.includes(observation.itemId),
              )!;
              return `- **${observation.kind}** — ${observation.interpretation} (record ${observation.itemId}, evidence ${observation.evidenceIndex}; ${project.title})`;
            })
            .join("\n") +
          "\n\n" +
          a.supportingProjects
            .map(
              (project) =>
                `- **${project.title}** (${project.authors.join(", ") || "team unknown"}); dates: ${project.dates.map((date) => date ?? "unknown").join(", ")}.\n` +
                project.sources
                  .map(
                    (source) =>
                      `  [Source](${source.sourceUrl})${source.page ? `, PDF page ${source.page}` : ""}: “${source.quote}”`,
                  )
                  .join("\n"),
            )
            .join("\n") +
          `\n\nMarket context: ${a.market.explanation}\n\n${references.join("\n")}\n\nMissing market evidence: ${a.market.missing.join("; ")}\n\nWould weaken it: ${a.wouldWeaken.join(" ")}\n\nNext evidence: ${a.nextEvidence.join(" ")}\n`
        );
      })
      .join("\n")
  );
}

export async function assessSignalsMain(
  args = process.argv.slice(2),
  agent = runCodex,
  downloader = download,
) {
  const option = (name: string, fallback: string) =>
    args.includes(name) ? args[args.indexOf(name) + 1]! : fallback;
  const input = resolve(
    option(
      "--input",
      ".research-cache/pipeline/showcases-2025/analysis/signals/state.json",
    ),
  );
  const output = resolve(
    option(
      "--output",
      ".research-cache/pipeline/showcases-2025/analysis/strength",
    ),
  );
  const budget = Number(option("--budget", "1000"));
  const batchSize = Number(option("--batch-size", "4"));
  if (!Number.isInteger(budget) || budget < 0)
    throw new Error("Budget must be a nonnegative call count");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 8)
    throw new Error("Batch size must be between one and eight notes");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const lockPath = join(output, "assessment.lock");
  const lock = await open(lockPath, "wx", 0o600);
  try {
    await lock.writeFile(String(process.pid));
    const state = JSON.parse(await readFile(input, "utf8")) as State;
    const evidenceAudit = await verifyAssessmentInput(state);
    const catalog = z
      .array(marketFactSchema)
      .parse(JSON.parse(await readFile("data/market-context.json", "utf8")));
    const facts: VerifiedMarketFact[] = [];
    const contextFailures: {
      factIds: string[];
      url: string;
      message: string;
      at: string;
    }[] = [];
    for (const url of new Set(catalog.map((fact) => fact.url))) {
      const group = catalog.filter((fact) => fact.url === url);
      try {
        facts.push(
          ...(await verifyMarketFacts(
            group,
            join(output, "sources"),
            downloader,
          )),
        );
      } catch (error) {
        contextFailures.push({
          factIds: group.map((fact) => fact.id),
          url,
          message: String(error),
          at: new Date().toISOString(),
        });
      }
    }
    await atomicJson(join(output, "context-failures.json"), contextFailures);
    const opportunities = state.opportunities ?? [];
    const itemFor = new Map(state.items.map((item) => [item.id, item]));
    const assessments: SignalAssessment[] = [];
    const pending: {
      opportunity: (typeof opportunities)[number];
      items: Item[];
      fingerprint: string;
    }[] = [];
    for (const opportunity of opportunities) {
      const items = [...new Set(opportunity.evidenceItemIds)].map((id) => {
        const item = itemFor.get(id);
        if (!item) throw new Error(`Missing retained record: ${id}`);
        return item;
      });
      const fingerprint = hash(
        JSON.stringify({ rubric: RUBRIC_VERSION, opportunity, items, facts }),
      );
      try {
        const saved = JSON.parse(
          await readFile(join(output, `${fingerprint}.json`), "utf8"),
        );
        assessments.push(
          assessSignal(
            assessmentBatchSchema.parse({ assessments: [saved] })
              .assessments[0]!,
            opportunity,
            items,
            facts,
          ),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (items.length === 1) {
          const item = items[0]!;
          const assessment = assessSignal(
            {
              opportunityId: opportunity.id,
              pattern: opportunity.title,
              whyItMatters: `Single-project lead; commercial interpretation remains provisional. ${opportunity.summary}`,
              units: [
                {
                  itemIds: [item.id],
                  independence: "uncertain",
                  reason:
                    "Single-project baseline; independent recurrence cannot be established.",
                },
              ],
              observations: [],
              confidence: "Low",
              confidenceReason:
                "Rule-based single-project baseline; no recurring pattern or independent corroboration established.",
              momentum: {
                supported: false,
                itemIds: [],
                explanation: "One project cannot establish momentum.",
              },
              robustness: {
                survives: false,
                removedItemId: item.id,
                explanation:
                  "Removing the sole project leaves no supporting project.",
              },
              market: {
                support: "Unknown",
                links: [],
                explanation:
                  "Market fit and context have not been assessed for this individual lead.",
                missing: [
                  "Relevant segment size",
                  "Segment growth",
                  "Measured buyer value",
                  "Demand and economic drivers",
                ],
              },
              wouldWeaken: [
                "Failure to reproduce the reported behavior, or evidence that the result is already routine.",
              ],
              nextEvidence: [
                "Find independent work demonstrating the same concrete change before treating this as a recurring signal.",
              ],
            },
            opportunity,
            items,
            facts,
          );
          await atomicJson(join(output, `${fingerprint}.json`), assessment);
          assessments.push(assessment);
        } else pending.push({ opportunity, items, fingerprint });
      }
    }
    // Prioritize recurring patterns, but never discard singleton leads or impose a project cutoff.
    pending.sort((a, b) => b.items.length - a.items.length);
    const failures: { opportunityIds: string[]; message: string }[] = [];
    const save = async (phase: string) => {
      await atomicJson(join(output, "assessments.json"), {
        rubricVersion: RUBRIC_VERSION,
        updatedAt: new Date().toISOString(),
        inputFingerprint: hash(JSON.stringify(state)),
        publicationAuthorized: false,
        exhaustiveInstitutionCoverage: false,
        totalNotes: opportunities.length,
        assessedNotes: assessments.length,
        facts,
        contextFailures,
        evidenceAudit,
        singleProjectBaselines: assessments.filter(
          (assessment) => assessment.rawRecords === 1,
        ).length,
        recurringPatternAssessments: assessments.filter(
          (assessment) => assessment.rawRecords > 1,
        ).length,
        assessments,
        failures,
      });
      await writeFile(
        join(output, "signals.md"),
        renderAssessments(assessments, facts, opportunities.length),
        { mode: 0o600 },
      );
      await atomicJson(join(output, "status.json"), {
        pid: process.pid,
        phase,
        updatedAt: new Date().toISOString(),
        assessed: assessments.length,
        total: opportunities.length,
        failedBatches: failures.length,
        contextFailures: contextFailures.length,
        resources: process.memoryUsage(),
      });
    };
    await save("assessing");
    // At most three no-tool calls; the owning process applies checkpoints serially.
    const batches = Array.from(
      { length: Math.min(Math.ceil(pending.length / batchSize), budget) },
      (_, index) =>
        pending.slice(index * batchSize, index * batchSize + batchSize),
    );
    for (let start = 0; start < batches.length; start += 3) {
      const wave = batches.slice(start, start + 3);
      const results = await Promise.allSettled(
        wave.map(async (batch) => {
          const result = await agent(
            ASSESSMENT_PROMPT +
              "\n" +
              JSON.stringify({
                facts,
                opportunities: batch.map(({ opportunity, items }) => ({
                  opportunityId: opportunity.id,
                  proposedTitle: opportunity.title,
                  proposedPattern: opportunity.summary,
                  items,
                  knownIdentityUnits: identityUnits(items).map((group) =>
                    group.map((item) => item.id),
                  ),
                })),
              }),
            assessmentBatchSchema,
            { timeoutMs: 240_000 },
          );
          if (
            result.assessments.length !== batch.length ||
            new Set(result.assessments.map((a) => a.opportunityId)).size !==
              batch.length ||
            result.assessments.some(
              (a) => !batch.some((b) => b.opportunity.id === a.opportunityId),
            )
          )
            throw new Error(
              "Assessment response must cover exactly the supplied notes",
            );
          return result.assessments.map((draft) => {
            const task = batch.find(
              (task) => task.opportunity.id === draft.opportunityId,
            )!;
            return {
              assessment: assessSignal(
                draft,
                task.opportunity,
                task.items,
                facts,
              ),
              fingerprint: task.fingerprint,
            };
          });
        }),
      );
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") {
          for (const value of result.value) {
            await atomicJson(
              join(output, `${value.fingerprint}.json`),
              value.assessment,
            );
            assessments.push(value.assessment);
          }
        } else {
          const error = result.reason;
          failures.push({
            opportunityIds: wave[index]!.map((task) => task.opportunity.id),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await save("assessing");
      console.log(
        JSON.stringify({
          assessed: assessments.length,
          total: opportunities.length,
          failures: failures.length,
        }),
      );
    }
    await save(
      assessments.length === opportunities.length
        ? "complete"
        : failures.length
          ? "partial-with-failures"
          : "partial-budget",
    );
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
if (import.meta.main) await assessSignalsMain();

import { mkdir, writeFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { personSchema, type Corpus } from "../src/lib/contracts";
import { validateCorpus } from "./validation";

export const profileCatalogSchema = z.array(
  personSchema.omit({ authorName: true }).extend({
    authorNames: z.array(z.string().min(1)).min(1),
    projectIds: z.array(z.string().min(1)).min(1),
  }),
);
export type ProfileCatalog = z.infer<typeof profileCatalogSchema>;

export function enrichPeople(corpus: Corpus, profiles: ProfileCatalog): Corpus {
  const projects = corpus.projects.map((project) => {
    const people = new Map(
      (project.people ?? []).map((person) => [person.authorName, person]),
    );
    for (const authorName of project.authors) {
      const matches = profiles.filter(
        (profile) =>
          profile.projectIds.includes(project.id) &&
          profile.authorNames.includes(authorName),
      );
      if (matches.length > 1)
        throw new Error(
          `Ambiguous author profile: ${project.id} / ${authorName}`,
        );
      if (matches[0]) {
        const { authorNames, projectIds, ...profile } = matches[0];
        people.set(authorName, personSchema.parse({ ...profile, authorName }));
      }
    }
    return people.size ? { ...project, people: [...people.values()] } : project;
  });
  return validateCorpus({ ...corpus, projects });
}

async function main() {
  const profiles = profileCatalogSchema.parse(
    await Bun.file("data/people-profiles.json").json(),
  );
  if (!process.argv.includes("--publish")) {
    const corpus = enrichPeople(
      validateCorpus(await Bun.file("data/corpus.json").json()),
      profiles,
    );
    await Bun.write("data/corpus.json", JSON.stringify(corpus, null, 2) + "\n");
    console.log({
      enrichedProjects: corpus.projects.filter(
        (project) => project.people?.length,
      ).length,
    });
    return;
  }
  const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  const secret = process.env.RESEARCH_WRITE_SECRET;
  if (!url || !secret) throw new Error("Publication capability unavailable");
  const client = new ConvexHttpClient(url);
  const get = makeFunctionReference<"query">("corpus:get");
  const before = validateCorpus(await client.query(get, {}));
  // Enrich the live corpus so later collected projects and all other records stay intact.
  const next = enrichPeople(before, profiles);
  await mkdir(".research-cache/people", { recursive: true });
  await writeFile(
    `.research-cache/people/${new URL(url).hostname}-${Date.now()}.json`,
    JSON.stringify(before),
    { mode: 0o600 },
  );
  await client.mutation(makeFunctionReference<"mutation">("research:ingest"), {
    secret,
    corpus: next,
  });
  const after = validateCorpus(await client.query(get, {}));
  if (
    after.projects.length !== before.projects.length ||
    after.sources.length !== before.sources.length ||
    after.insights.length !== before.insights.length
  )
    throw new Error("Profile publication did not preserve the corpus");
  console.log({
    enrichedProjects: after.projects.filter((project) => project.people?.length)
      .length,
    preservedProjects: after.projects.length,
  });
}
if (import.meta.main) await main();

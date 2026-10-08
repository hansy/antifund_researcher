import { expect, test } from "bun:test";
import seed from "../data/corpus.json";
import { personSchema } from "../src/lib/contracts";
import { getTeamPeople, groupResearchTeams } from "../src/lib/teams";
import { enrichPeople, profileCatalogSchema } from "./people";
import { validateCorpus } from "./validation";

const corpus = validateCorpus(seed);
const project = {
  ...corpus.projects.find((item) => item.id === "robogen")!,
  people: undefined,
};
const profile = {
  authorNames: ["Yufei Wang"],
  projectIds: [project.id],
  name: "Yufei Wang",
  links: { website: "https://yufeiwang63.github.io/" },
  sources: [
    {
      url: "https://robogen-ai.github.io/",
      excerpt: "Yufei Wang",
      accessedAt: "2026-10-08",
    },
  ],
};

test("profiles require exact scoped authorship and keep unresolved contributors", () => {
  const input = {
    ...corpus,
    projects: corpus.projects.map((item) =>
      item.id === project.id ? project : item,
    ),
  };
  const next = enrichPeople(input, profileCatalogSchema.parse([profile]));
  const enriched = next.projects.find((item) => item.id === project.id)!;
  expect(enriched.people).toHaveLength(1);
  expect(enriched.evidence).toEqual(project.evidence);
  expect(getTeamPeople(enriched)).toHaveLength(project.authors.length);
  expect(getTeamPeople(enriched)[1]?.name).toBe(project.authors[1]);
  expect(
    enrichPeople(input, [
      { ...profile, projectIds: ["another-project"] },
    ]).projects.find((item) => item.id === project.id)?.people,
  ).toBeUndefined();
  expect(() => enrichPeople(input, [profile, profile])).toThrow(
    "Ambiguous author profile",
  );
});

test("unknown authors, future provenance and non-profile social links are rejected", () => {
  const person = personSchema.parse({ ...profile, authorName: "Yufei Wang" });
  const invalid = structuredClone(corpus);
  const target = invalid.projects.find((item) => item.id === project.id)!;
  target.people = [{ ...person, authorName: "Uncredited person" }];
  expect(() => validateCorpus(invalid)).toThrow("Invalid team author");
  target.people = [
    {
      ...person,
      sources: [{ ...person.sources[0]!, accessedAt: "2099-01-01" }],
    },
  ];
  expect(() => validateCorpus(invalid)).toThrow(
    "Invalid profile research date",
  );
  expect(() =>
    personSchema.parse({ ...person, photoUrl: "http://example.com/photo.jpg" }),
  ).toThrow();
  expect(() =>
    personSchema.parse({
      ...person,
      links: { x: "https://x.com/search?q=Yufei" },
    }),
  ).toThrow();
  expect(() =>
    personSchema.parse({
      ...person,
      links: { linkedin: "https://www.linkedin.com/company/example" },
    }),
  ).toThrow();
});

test("overlapping research combines verified people and keeps individual credits", () => {
  const projects = corpus.projects.filter((item) =>
    ["oxford-robotcycle-2025", "oxford-graphscene-2025"].includes(item.id),
  );
  const snapshot = JSON.stringify(projects);
  const teams = groupResearchTeams(projects);
  expect(teams).toHaveLength(1);
  expect(teams[0]!.projects).toHaveLength(2);
  expect(teams[0]!.members).toHaveLength(13);
  expect(
    teams[0]!.members.find(
      (member) => member.person.name === "Efimia Panagiotaki",
    )?.projects,
  ).toHaveLength(2);
  expect(
    teams[0]!.members.find(
      (member) => member.person.name === "Georgi Pramatarov",
    )?.projects,
  ).toHaveLength(1);
  expect(JSON.stringify(projects)).toBe(snapshot);
  // The same school and unresolved names alone don't establish a collaboration.
  expect(
    groupResearchTeams(
      projects.map((item) => ({ ...item, people: undefined })),
    ),
  ).toHaveLength(2);
  const factory = corpus.projects.filter((item) =>
    ["aloha", "serl"].includes(item.id),
  );
  expect(groupResearchTeams(factory)).toHaveLength(1);
  expect(groupResearchTeams(factory)[0]!.members).toHaveLength(12);
  const terrain = corpus.projects.filter((item) =>
    ["anymal-hike", "dtc"].includes(item.id),
  );
  expect(groupResearchTeams(terrain)[0]!.members).toHaveLength(3);
});

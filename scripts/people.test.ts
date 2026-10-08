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

test("team cards keep distinct rosters and attach papers to the same resolved people", () => {
  const projects = corpus.projects.filter((item) =>
    ["oxford-robotcycle-2025", "oxford-graphscene-2025"].includes(item.id),
  );
  const snapshot = JSON.stringify(projects);
  const teams = groupResearchTeams(projects);
  expect(teams).toHaveLength(2);
  expect(teams.map((team) => team.members.length)).toEqual([4, 12]);
  expect(JSON.stringify(projects)).toBe(snapshot);

  const graphscene = projects.find(
    (item) => item.id === "oxford-graphscene-2025",
  )!;
  const followup = {
    ...graphscene,
    id: "same-team-followup",
    authors: [...graphscene.authors].reverse(),
  };
  const sameTeam = groupResearchTeams([graphscene, followup]);
  expect(sameTeam).toHaveLength(1);
  expect(sameTeam[0]!.projects).toHaveLength(2);
  expect(sameTeam[0]!.members).toHaveLength(4);
  expect(
    sameTeam[0]!.members.every((member) => member.projects.length === 2),
  ).toBe(true);
  expect(
    groupResearchTeams([graphscene, { ...followup, people: undefined }]),
  ).toHaveLength(2);
  const differentProfiles = {
    ...followup,
    people: followup.people!.map((person) => ({
      ...person,
      links: {
        website: `https://example.com/another-person/${encodeURIComponent(person.name)}`,
      },
    })),
  };
  expect(groupResearchTeams([graphscene, differentProfiles])).toHaveLength(2);
});

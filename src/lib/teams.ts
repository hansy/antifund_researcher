import type { Person, Project } from "./contracts";

/** Keep every credited author, including people whose public profile is unresolved. */
export function getTeamPeople(project: Project): Person[] {
  return project.authors.map(
    (authorName) =>
      project.people?.find((person) => person.authorName === authorName) ?? {
        authorName,
        name: authorName,
        sources: [],
      },
  );
}

export type ResearchTeam = {
  id: string;
  projects: Project[];
  members: { key: string; person: Person; projects: Project[] }[];
};

/** A team is a credited roster, not a school or a chain of shared co-authors. */
export function groupResearchTeams(projects: Project[]): ResearchTeam[] {
  const teams = new Map<string, ResearchTeam>();
  for (const project of projects) {
    const people = getTeamPeople(project);
    const identities = people.map((person) =>
      JSON.stringify([
        person.name,
        person.links?.website ??
          person.links?.linkedin ??
          person.links?.x ??
          person.sources.map((source) => source.url).sort(),
      ]),
    );
    // Only a fully resolved, identical roster can share a team card.
    const roster =
      people.length && people.every((person) => person.sources.length)
        ? JSON.stringify([...identities].sort())
        : `project:${project.id}`;
    const existing = teams.get(roster);
    if (existing) {
      existing.projects.push(project);
      existing.members.forEach((member) => member.projects.push(project));
    } else {
      teams.set(roster, {
        id: project.id,
        projects: [project],
        members: people.map((person, index) => ({
          key: identities[index]!,
          person,
          projects: [project],
        })),
      });
    }
  }
  return [...teams.values()];
}

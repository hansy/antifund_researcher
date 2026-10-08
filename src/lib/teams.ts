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

/** Group credited collaborators, without treating a shared institution as a team. */
export function groupResearchTeams(projects: Project[]): ResearchTeam[] {
  const verifiedNames = (project: Project) =>
    new Set(project.people?.map((person) => person.name) ?? []);
  const overlaps = (left: Project, right: Project) => {
    const names = verifiedNames(left);
    const shared = [...verifiedNames(right)].filter((name) => names.has(name));
    // One verified collaborator connects work at the same school. Across schools,
    // require two so a single widely collaborating author doesn't collapse a signal.
    return shared.length >= (left.schoolId === right.schoolId ? 1 : 2);
  };
  const remaining = [...projects];
  const teams: ResearchTeam[] = [];
  while (remaining.length) {
    const linked = [remaining.shift()!];
    for (let index = 0; index < remaining.length;) {
      if (linked.some((project) => overlaps(project, remaining[index]!))) {
        linked.push(remaining.splice(index, 1)[0]!);
        index = 0;
      } else index++;
    }
    const members = new Map<string, ResearchTeam["members"][number]>();
    for (const project of linked) {
      for (const person of getTeamPeople(project)) {
        // An unresolved name alone cannot establish identity across projects.
        const key = person.sources.length
          ? person.name
          : `${project.id}:${person.authorName}`;
        const existing = members.get(key);
        if (existing) {
          existing.projects.push(project);
          existing.person = {
            ...person,
            ...existing.person,
            bio: existing.person.bio ?? person.bio,
            affiliation: existing.person.affiliation ?? person.affiliation,
            photoUrl: existing.person.photoUrl ?? person.photoUrl,
            links: { ...person.links, ...existing.person.links },
            sources: [...existing.person.sources, ...person.sources].filter(
              (source, index, all) =>
                all.findIndex(
                  (other) =>
                    other.url === source.url &&
                    other.excerpt === source.excerpt,
                ) === index,
            ),
          };
        } else members.set(key, { key, person, projects: [project] });
      }
    }
    teams.push({
      id: linked[0]!.id,
      projects: linked,
      members: [...members.values()].sort(
        (a, b) => b.projects.length - a.projects.length,
      ),
    });
  }
  return teams;
}

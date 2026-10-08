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

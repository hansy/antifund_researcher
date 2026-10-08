import { useState, type RefObject } from "react";
import type { Person, School } from "../lib/contracts";
import type { ResearchTeam } from "../lib/teams";

export function Portrait({ person }: { person: Person }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <span className="portrait">
      {person.photoUrl && person.photoUrl !== failedUrl ? (
        <img
          src={person.photoUrl}
          alt={`Portrait of ${person.name}`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(person.photoUrl)}
        />
      ) : (
        <span aria-hidden="true">
          {person.name
            .split(/\s+/)
            .slice(0, 2)
            .map((word) => word[0])
            .join("")}
        </span>
      )}
    </span>
  );
}

export function TeamView({
  team,
  schools,
  headingRef,
}: {
  team: ResearchTeam;
  schools: School[];
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const project = team.projects[0]!;
  const multiple = team.projects.length > 1;
  const schoolNames = [
    ...new Set(
      team.projects.map(
        (item) => schools.find((school) => school.id === item.schoolId)?.name,
      ),
    ),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="team-view">
      <div className="brief-header">
        <h1 ref={headingRef} tabIndex={-1}>
          {multiple ? schoolNames : project.title.split(":")[0]}
        </h1>
        <p className="brief-summary">
          {multiple
            ? team.projects.map((item) => item.title.split(":")[0]).join(" · ")
            : project.summary}
        </p>
      </div>
      <section className="team-members" aria-label="Team members">
        {team.members.map(({ key, person, projects }) => (
          <article className="person-card" key={key}>
            <Portrait person={person} />
            <div className="person-body">
              <h2>{person.name}</h2>
              {person.affiliation && (
                <p className="person-affiliation">{person.affiliation}</p>
              )}
              <p className="person-bio">
                {person.bio ??
                  `Co-author · ${[...new Set(projects.map((item) => item.year))].sort().join(", ")}`}
              </p>
              {multiple && (
                <p className="person-projects">
                  {projects.map((item) => item.title.split(":")[0]).join(" · ")}
                </p>
              )}
              {person.links && (
                <div className="person-links">
                  {(["website", "x", "linkedin"] as const).map((kind) =>
                    person.links?.[kind] ? (
                      <a
                        key={kind}
                        href={person.links[kind]}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {kind === "website"
                          ? "Website"
                          : kind === "x"
                            ? "X"
                            : "LinkedIn"}
                      </a>
                    ) : null,
                  )}
                </div>
              )}
              {person.sources.length > 0 && (
                <details className="profile-sources">
                  <summary>Profile sources</summary>
                  {person.sources.map((source) => (
                    <div key={source.url}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {new URL(source.url).hostname}
                      </a>
                      <blockquote>{source.excerpt}</blockquote>
                      <small>
                        Checked{" "}
                        {new Date(source.accessedAt).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "UTC",
                          },
                        )}
                      </small>
                    </div>
                  ))}
                </details>
              )}
            </div>
          </article>
        ))}
        {team.members.length === 0 && (
          <p className="state-message">
            The source does not identify individual contributors.
          </p>
        )}
      </section>
    </article>
  );
}

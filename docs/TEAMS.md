# Teams and their research

Each signal has a Teams section. Each card identifies the team by its credited people, then shows school and years, with that team's projects and papers underneath. Clicking the team opens its profiles; clicking its research opens evidence, results and limitations. The desktop signal rail stays in place. Links support reload, browser back and keyboard navigation.

Projects share a team card only when their entire resolved author roster matches, including profile identity references. A shared author or institution does not make two research teams the same. Unresolved rosters stay separate. Contributors appear once within a team, and each paper retains its credited people. These are project teams drawn from published credits, not invented lab or company identities.

`data/people-profiles.json` contains 63 researched identities spanning 15 projects. It supplies 54 basic bios and 46 portrait URLs. This is partial enrichment of the published corpus. Unresolved contributors remain visible using the original author names; no person or affiliation is inferred from a name alone.

Profiles match an exact author alias and a verified project ID. Original author arrays remain unchanged. Each profile retains primary source URLs, short excerpts and access dates. Links come from project pages, university profiles or the person’s own website. Current affiliations can differ from the institution on the original paper; dated project affiliations are labelled explicitly.

Portraits load from the public profile source. Failed or missing images fall back to initials. Website, X and LinkedIn links appear only when resolved; profile evidence stays in a closed disclosure. A stale personal domain that now hosts unrelated content is omitted.

`bun run research:people` enriches the checked-in corpus. `--publish` reads the live Convex corpus, saves a private backup, adds profiles and verifies record counts. Set `CONVEX_URL` for the intended deployment and use its existing `RESEARCH_WRITE_SECRET`. Never publish the smaller starting corpus over later collection.

Profiles live in optional `project.people` records. Later classification updates that omit profiles retain them for still-credited authors. Changed records remain in `researchRevisions`; an explicit people array can replace the current profiles. No separate identity service or scraping subscription is required.

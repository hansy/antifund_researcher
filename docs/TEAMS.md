# Related research and teams

Each signal has combined research cards: people, school and years above the related studies. Clicking the people opens their profiles; clicking a study opens its evidence, results and limitations. The desktop signal rail stays in place. Links support reload, browser back and keyboard navigation.

Cards combine projects with verified shared contributors: one shared person within the same school, or two across schools. Connected projects share a card; merely attending the same school does not establish a team. Unresolved names never establish a match. Contributors appear once within a card, and expanded profiles retain their individual project credits. This grouping describes research overlap, not a formal organization or a commercial team.

`data/people-profiles.json` contains 63 researched identities spanning 15 projects. It supplies 54 basic bios and 46 portrait URLs. This is partial enrichment of the published corpus. Unresolved contributors remain visible using the original author names; no person or affiliation is inferred from a name alone.

Profiles match an exact author alias and a verified project ID. Original author arrays remain unchanged. Each profile retains primary source URLs, short excerpts and access dates. Links come from project pages, university profiles or the person’s own website. Current affiliations can differ from the institution on the original paper; dated project affiliations are labelled explicitly.

Portraits load from the public profile source. Failed or missing images fall back to initials. Website, X and LinkedIn links appear only when resolved; profile evidence stays in a closed disclosure. A stale personal domain that now hosts unrelated content is omitted.

`bun run research:people` enriches the checked-in corpus. `--publish` reads the live Convex corpus, saves a private backup, adds profiles and verifies record counts. Set `CONVEX_URL` for the intended deployment and use its existing `RESEARCH_WRITE_SECRET`. Never publish the smaller starting corpus over later collection.

Profiles live in optional `project.people` records. Later classification updates that omit profiles retain them for still-credited authors. Changed records remain in `researchRevisions`; an explicit people array can replace the current profiles. No separate identity service or scraping subscription is required.

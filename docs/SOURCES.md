# Initial corpus provenance

Collected and manually checked on **8 October 2026**. `data/corpus.json` contains **22 projects, 22 source records and five hypothesis-led cross-project insights**, covering **nine registry schools**. Source excerpts are short verbatim text; result paragraphs paraphrase what the source reports. “Our interpretation” and “Hypothesis” identify our synthesis. No independent reproduction is claimed.

## School registry

The target registry uses [QS 2026 Engineering & Technology](https://qs-topuniversities.cn/en/university-rankings/university-subject-rankings/2026/engineering-technology). Its public HTML `drupal-settings-json` exposes this [publisher dataset](https://qs-topuniversities.cn/sites/default/files/qs-rankings-data/en/9bf4f2464bcd27837dd44e13b62b70c0.txt). Parse `data`, remove HTML from `title`, convert `rank_display` to a number while preserving ties, then order by numeric rank and exact publisher name. Take the first 50 currently listed institutions.

**Boundary limitation:** the current dataset lists **49 institutions at ranks ≤50**. It has a tied rank 20 followed by rank 22, with only one rank-20 institution currently listed. We do not infer the missing institution. To maintain a fixed 50-school target, the registry includes **Monash at tied rank 51** before Université Paris-Saclay using alphabetical order. Therefore this is a **50-school collection registry**, not a claim that every selected institution has a rank ≤50. Actual publisher ranks remain in the records. `data/registry-provenance.json` records the selection and its exact source URL. The [University of Toronto's 2026 engineering report, Figure 5.2a](https://www.engineering.utoronto.ca/about/annual-reports/by-the-numbers-2026/chapter-5-awards-rankings-2026/) independently reproduces the 49 currently listed rank-≤50 institutions.

Names and countries follow the publisher dataset; school domains and short names are discovery metadata. Homepage discovery URLs indicate planned discovery entry points, not completed collection.

## Evidence handling

All project evidence links point to official university/laboratory reports, author-maintained project pages, or a university-hosted presentation PDF. Each record preserves the access date, source URL, source year, a short exact excerpt, and a locator. The 2022 Deepak Pathak presentation is a **one-page talk abstract**, with **PDF page 1** preserved; it is not represented as a complete slide deck or completed experiment. Other selected evidence is HTML and has section locators rather than fabricated PDF pages.

Years follow the linked publication, conference, university report or explicitly dated showcase. RoboGen uses its ICML 2024 publication year while its page also lists a 2023 preprint. Extreme Parkour uses its 2023 preprint/live demonstration year while the page also lists ICRA 2024. Author arrays contain only names visible on the inspected source and may be selective rather than complete. Shared research is attributed to one registry school for navigation, with joint affiliations stated in the summary; the evidence does not imply exclusive ownership. In particular, RoboGen is attributed to CMU, not Berkeley; Diffusion Policy includes MIT but is hosted at Columbia; Eureka includes Caltech alongside NVIDIA, UPenn and UT Austin.

Waterloo's 2026 bananaHand and roamr abstracts are student capstone descriptions. bananaHand's features are reported team claims without independent reliability measurements. roamr's autonomous navigation is an **aim**, so its stage is Concept and no completed navigation result is asserted. Future deployment applications in other university reports remain proposed applications.

## Coverage and interpretation limits

The initial collection is a hand-selected, non-exhaustive sample across 2021–2026: MIT, Stanford, ETH Zurich, UC Berkeley, Carnegie Mellon, Caltech, Georgia Tech, Waterloo and TU Delft. **41 registry schools have no project in this corpus.** English-language, public project pages and prominent demonstrations are overrepresented. Nine sampled schools do not establish comparable collection completeness at those schools. The 2026 window ends on 8 October and is incomplete.

Five insights connect multiple projects and schools, but all have **Early signal** confidence. They are research/workflow hypotheses, not verified market demand, TAM estimates, novelty claims, safety guarantees or commercialization evidence. Cross-project metrics are deliberately not aggregated because tasks, hardware and evaluation conditions differ.

Raw retrieved HTML, ranking image and publisher dataset were used only as local temporary verification material and are not committed. The repository holds normalized corpus/provenance records, not raw downloads, credentials or logs.

# Opportunity signals

The five signals are investor-facing hypotheses grounded in the current robotics corpus. Short titles name a possible product or customer benefit. Each brief identifies the product, problem, reported research advances, potential buyer, commercial wedge, risks and next diligence questions.

The corpus spans 2021–2026. These signals are not the result of completed collection across the planned 50 schools. New 2025–2026 collection is a separate, ongoing effort.

## Evidence boundaries

`brief.breakthroughs` contains reported research findings and links them to existing corpus sources. `brief.marketOpportunity` describes our commercial interpretation. `brief.marketEvidence` stores short exact excerpts from public primary sources, source URLs and access dates.

`marketStatus: researched` means market context has been checked against those primary sources. It does not mean customer demand, willingness to pay, technical integration or investment readiness has been validated. Optional `marketSize` fields identify the measured market, reporting year, scope and linked evidence. These are broader industry estimates or adjacent hardware proxies; none establishes a proposed product's addressable market. `applications` and `targetCustomers` are potential uses and buyers to validate. A signal without a brief falls back to `marketStatus: hypothesis` and an unvalidated buyer.

## Five distinct opportunities

| Signal                         | Proposed product                                        | First buyer to validate                              |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------- |
| Cheaper robot training data    | Task-specific data tested on customer hardware          | Robot manufacturers and manipulation-model teams     |
| Factory robots with less setup | Teaching and recovery software for one assembly task    | Automation integrators and electronics manufacturers |
| Faster drone inspection maps   | Compact industrial maps with located inspection imagery | Survey firms and drone inspection operators          |
| Safer inspection robots        | Terrain acceptance and recovery tests                   | Robot manufacturers and industrial fleet operators   |
| Cyclist safety tests           | Simulation scenarios derived from cyclist encounters    | Vehicle manufacturers and driving-validation teams   |

The training-data opportunity concerns inputs to robot development. The factory opportunity concerns operation of an installed assembly task. Inspection mapping concerns survey deliverables; terrain testing concerns where a legged robot can operate. These remain separate buying decisions.

## Market context checked on 8 October 2026

- [NVIDIA’s robotics platform](https://www.nvidia.com/en-us/industries/robotics/) supplies simulation and synthetic-data tooling. This establishes a competitive context for training data, not demand for our proposed service.
- [Amazon’s Vulcan](https://www.aboutamazon.com/news/operations/amazon-vulcan-robot-pick-stow-touch) performs picking and stowing. It demonstrates commercial manipulation activity; it does not validate an assembly-software buyer.
- [Flyability’s Elios 3](https://www.flyability.com/elios-3) already links inspection data to 3D models. A new mapping product must prove a useful advantage over existing workflows.
- [ANYbotics](https://www.anybotics.com/) markets autonomous industrial inspection. Independent terrain-testing demand still needs operator interviews.
- [Euro NCAP’s CUPRA Leon assessment](https://www.euroncap.com/assessments/cupra/leon/1122/) includes cyclist-response tests. Engineering simulations do not replace formal vehicle assessment.

Market figures link to their publishers: Mordor Intelligence's [inspection drones](https://www.mordorintelligence.com/industry-reports/inspection-drones-market) and [automotive testing](https://www.mordorintelligence.com/industry-reports/testing-inspection-and-certification-market-for-automotive-industry) estimates; IFR's [January 2025 industrial robot installation report](https://ifr.org/ifr-press-releases/news/top-5-global-robotics-trends-2025); and inspection robot estimates from [The Business Research Company](https://www.thebusinessresearchcompany.com/report/inspection-robots-global-market-report) and [Fortune Business Insights](https://www.fortunebusinessinsights.com/inspection-robots-market-105440). The two robot estimates differ in scope and appear as a range. IFR's hardware installation value is a proxy, not training or setup software revenue.

Excerpts are at most 25 words per source. Existing schools, sources, projects, exact research quotations, dates and PDF references are preserved. No exoskeleton opportunity is claimed: the present corpus does not supply supporting exoskeleton research.

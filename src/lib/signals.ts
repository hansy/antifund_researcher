import type { Insight, SignalBrief } from "./contracts";

/** Older collected signals remain readable until a researched brief is added. */
export function getSignalBrief(insight: Insight): SignalBrief {
  return (
    insight.brief ?? {
      whatItIs: insight.opportunity,
      problem: insight.problem,
      breakthroughs: [{ text: insight.evidence, sourceIds: insight.sourceIds }],
      marketOpportunity: insight.gap,
      buyer: "Buyer to validate",
      marketStatus: "hypothesis",
      marketEvidence: [],
      risks: [insight.counterpoint],
      nextQuestions: [insight.nextQuestion],
    }
  );
}

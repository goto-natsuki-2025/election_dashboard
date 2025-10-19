import {
  buildSummaryIndex,
  loadCandidateDetails,
  loadElectionSummary,
} from "./data-loaders.js";
import {
  buildElectionEvents,
  buildPartyTimeline,
} from "./aggregations.js";
import {
  renderPartyHighlights,
  renderPartyTrendChart,
  renderSummary,
} from "./renderers.js";

async function main() {
  const elections = await loadElectionSummary();
  const summaryIndex = buildSummaryIndex(elections);
  const candidates = await loadCandidateDetails(summaryIndex);

  const { events, municipalityCount } = buildElectionEvents(candidates);
  if (events.length === 0) {
    throw new Error("No election data matched the aggregation criteria");
  }

  const timeline = buildPartyTimeline(events, { topN: 8 });
  if (timeline.series.length === 0 || timeline.dateLabels.length === 0) {
    throw new Error("Insufficient data to build the party timeline");
  }

  renderSummary({
    municipalityCount,
    totalSeats: timeline.totalSeats,
    partyCount: timeline.parties.length,
    minDate: timeline.minDate,
    maxDate: timeline.maxDate,
  });

  renderPartyHighlights(timeline, 6);
  renderPartyTrendChart("party-trend-chart", timeline);
}

main().catch((error) => {
  console.error(error);
  alert(
    [
      "Failed to load or process the data.",
      error instanceof Error ? error.message : String(error),
      "Confirm that the data/ directory is located correctly.",
    ].join("\n"),
  );
});

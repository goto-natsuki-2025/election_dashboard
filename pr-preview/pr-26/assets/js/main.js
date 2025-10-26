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
import { initCompensationDashboard } from "./compensation/dashboard.js";
import { initElectionSearchDashboard } from "./search/dashboard.js";

function setupViewSwitching(activations = {}) {
  const tabs = document.querySelectorAll(".dashboard-tab");
  const views = document.querySelectorAll(".dashboard-view");

  const switchTo = (targetId) => {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.view === targetId;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    views.forEach((view) => {
      const isActive = view.id === targetId;
      view.classList.toggle("is-active", isActive);
      view.hidden = !isActive;
    });

    const callback = activations[targetId];
    if (typeof callback === "function") {
      callback();
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.view;
      if (target) {
        switchTo(target);
      }
    });
  });

  // ensure non-active views are hidden from the start
  views.forEach((view) => {
    if (!view.classList.contains("is-active")) {
      view.hidden = true;
    }
  });
}

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

  const compensationDashboard = await initCompensationDashboard();
  const searchDashboard = initElectionSearchDashboard({ elections, candidates });

  setupViewSwitching({
    "compensation-dashboard": () => {
      requestAnimationFrame(() => {
        compensationDashboard?.resize();
      });
    },
    "search-dashboard": () => {
      requestAnimationFrame(() => {
        searchDashboard?.resize();
      });
    },
  });
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

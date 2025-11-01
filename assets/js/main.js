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
import { initPartyMapDashboard } from "./map/dashboard.js";

function isPromiseLike(value) {
  return value && typeof value.then === "function";
}

function scheduleDeferredWork(task) {
  const run = () => {
    try {
      const result = task();
      if (isPromiseLike(result)) {
        result.catch((error) => console.error(error));
      }
    } catch (error) {
      console.error(error);
    }
  };
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => run(), { timeout: 2000 });
    return;
  }
  setTimeout(run, 0);
}

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
      const result = callback();
      if (isPromiseLike(result)) {
        result.catch((error) => console.error(error));
      }
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

  let compensationInitPromise;
  const ensureCompensationReady = () => {
    if (!compensationInitPromise) {
      compensationInitPromise = initCompensationDashboard();
    }
    return compensationInitPromise;
  };

  let partyMapInitPromise;
  const ensurePartyMapReady = () => {
    if (!partyMapInitPromise) {
      partyMapInitPromise = initPartyMapDashboard({ elections, candidates });
    }
    return partyMapInitPromise;
  };

  let searchInitPromise;
  const ensureSearchReady = () => {
    if (!searchInitPromise) {
      searchInitPromise = Promise.resolve().then(() =>
        initElectionSearchDashboard({ elections, candidates }),
      );
    }
    return searchInitPromise;
  };

  scheduleDeferredWork(() => ensureCompensationReady());
  scheduleDeferredWork(() => ensurePartyMapReady());
  scheduleDeferredWork(() => ensureSearchReady());

  setupViewSwitching({
    "compensation-dashboard": () =>
      ensureCompensationReady()
        .then((dashboard) => {
          requestAnimationFrame(() => {
            dashboard?.resize?.();
          });
        })
        .catch((error) => console.error(error)),
    "choropleth-dashboard": () =>
      ensurePartyMapReady()
        .then((dashboard) => {
          requestAnimationFrame(() => {
            dashboard?.resize?.();
          });
        })
        .catch((error) => console.error(error)),
    "search-dashboard": () =>
      ensureSearchReady()
        .then((dashboard) => {
          requestAnimationFrame(() => {
            dashboard?.resize?.();
          });
        })
        .catch((error) => console.error(error)),
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

import {
  buildSummaryIndex,
  loadCandidateDetails,
  loadElectionSummary,
  loadTopDashboardData,
} from "./data-loaders.js";
import {
  renderPartyHighlights,
  renderPartyTrendChart,
  renderSummary,
} from "./renderers.js";
import { initCompensationDashboard } from "./compensation/dashboard.js";
import { initElectionSearchDashboard } from "./search/dashboard.js";
import { initPartyMapDashboard } from "./map/dashboard.js";

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
      try {
        const result = callback();
        if (result && typeof result.then === "function") {
          result.catch((error) => console.error(error));
        }
      } catch (error) {
        console.error(error);
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
  const topDashboard = await loadTopDashboardData();
  if (
    !Array.isArray(topDashboard.timeline?.dateLabels) ||
    topDashboard.timeline.dateLabels.length === 0
  ) {
    throw new Error("Top dashboard data did not contain any timeline entries");
  }
  renderSummary(topDashboard.summary);
  renderPartyHighlights(topDashboard.timeline, 6);
  renderPartyTrendChart("party-trend-chart", topDashboard.timeline);

  let electionsPromise;
  const ensureElections = () => {
    if (!electionsPromise) {
      electionsPromise = loadElectionSummary();
    }
    return electionsPromise;
  };

  let candidateBundlePromise;
  const ensureCandidateBundle = () => {
    if (!candidateBundlePromise) {
      candidateBundlePromise = ensureElections().then((elections) => {
        const summaryIndex = buildSummaryIndex(elections);
        return loadCandidateDetails(summaryIndex).then((candidates) => ({
          elections,
          candidates,
        }));
      });
    }
    return candidateBundlePromise;
  };

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
      partyMapInitPromise = ensureCandidateBundle().then(({ candidates }) =>
        initPartyMapDashboard({ candidates }),
      );
    }
    return partyMapInitPromise;
  };

  let searchInitPromise;
  const ensureSearchReady = () => {
    if (!searchInitPromise) {
      searchInitPromise = ensureCandidateBundle().then(({ elections, candidates }) =>
        initElectionSearchDashboard({ elections, candidates }),
      );
    }
    return searchInitPromise;
  };

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

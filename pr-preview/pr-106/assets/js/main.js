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
import { DATA_PATH } from "./constants.js";

// Bump to invalidate cached modules when map logic changes (e.g., tie color for top-party metric).
const ASSET_VERSION = "?v=20241124";
const PREFETCHED_RESOURCES = new Set();
function scheduleIdleTask(callback, timeout = 2000) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout });
  } else {
    window.setTimeout(callback, timeout);
  }
}

function prefetchResource(href, { rel = "prefetch", as } = {}) {
  if (!href || PREFETCHED_RESOURCES.has(href)) return;
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  if (as) {
    link.as = as;
  }
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
  PREFETCHED_RESOURCES.add(href);
}

const moduleUrl = (specifier) => new URL(`${specifier}${ASSET_VERSION}`, import.meta.url).href;
const MAP_PREFECTURE_TOPO_PATH = "assets/data/japan.topojson.gz";
const MAP_MUNICIPAL_TOPO_PATH = "assets/data/municipal.topojson.gz";

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

  let compensationModulePromise;
  const loadCompensationModule = () => {
    if (!compensationModulePromise) {
      compensationModulePromise = import(`./compensation/dashboard.js${ASSET_VERSION}`);
    }
    return compensationModulePromise;
  };
  let compensationInitPromise;
  const ensureCompensationReady = () => {
    if (!compensationInitPromise) {
      compensationInitPromise = loadCompensationModule().then(({ initCompensationDashboard }) =>
        initCompensationDashboard(),
      );
    }
    return compensationInitPromise;
  };

  let partyMapModulePromise;
  const loadPartyMapModule = () => {
    if (!partyMapModulePromise) {
      partyMapModulePromise = import(`./map/dashboard.js${ASSET_VERSION}`);
    }
    return partyMapModulePromise;
  };
  let partyMapInitPromise;
  const ensurePartyMapReady = () => {
    if (!partyMapInitPromise) {
      partyMapInitPromise = Promise.all([
        loadPartyMapModule(),
        ensureCandidateBundle(),
      ]).then(([module, { candidates }]) => module.initPartyMapDashboard({ candidates }));
    }
    return partyMapInitPromise;
  };

  let searchModulePromise;
  const loadSearchModule = () => {
    if (!searchModulePromise) {
      searchModulePromise = import(`./search/dashboard.js${ASSET_VERSION}`);
    }
    return searchModulePromise;
  };
  let searchInitPromise;
  const ensureSearchReady = () => {
    if (!searchInitPromise) {
      searchInitPromise = Promise.all([
        loadSearchModule(),
        ensureCandidateBundle(),
      ]).then(([module, { elections, candidates }]) =>
        module.initElectionSearchDashboard({ elections, candidates }),
      );
    }
    return searchInitPromise;
  };

  let winRateModulePromise;
  const loadWinRateModule = () => {
    if (!winRateModulePromise) {
      winRateModulePromise = import(`./win-rate/dashboard.js${ASSET_VERSION}`);
    }
    return winRateModulePromise;
  };
  let winRateInitPromise;
  const ensureWinRateReady = () => {
    if (!winRateInitPromise) {
      winRateInitPromise = loadWinRateModule().then(({ initWinRateDashboard }) =>
        initWinRateDashboard(),
      );
    }
    return winRateInitPromise;
  };

  let optimizationModulePromise;
  const loadOptimizationModule = () => {
    if (!optimizationModulePromise) {
      optimizationModulePromise = import(`./optimization/dashboard.js${ASSET_VERSION}`);
    }
    return optimizationModulePromise;
  };
  let optimizationInitPromise;
  const ensureOptimizationReady = () => {
    if (!optimizationInitPromise) {
      optimizationInitPromise = loadOptimizationModule().then(
        ({ initVoteOptimizationDashboard }) => initVoteOptimizationDashboard(),
      );
    }
    return optimizationInitPromise;
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
    "win-rate-dashboard": () =>
      ensureWinRateReady()
        .then((dashboard) => {
          requestAnimationFrame(() => {
            dashboard?.resize?.();
          });
        })
        .catch((error) => console.error(error)),
    "optimization-dashboard": () =>
      ensureOptimizationReady().catch((error) => console.error(error)),
  });

  scheduleIdleTask(() => {
    prefetchResource(DATA_PATH.elections, { as: "fetch" });
    prefetchResource(DATA_PATH.candidates, { as: "fetch" });
    prefetchResource(DATA_PATH.compensation, { as: "fetch" });
    prefetchResource(DATA_PATH.winRate, { as: "fetch" });
    prefetchResource(DATA_PATH.optimization, { as: "fetch" });
    prefetchResource(MAP_PREFECTURE_TOPO_PATH, { as: "fetch" });
    prefetchResource(MAP_MUNICIPAL_TOPO_PATH, { as: "fetch" });
    prefetchResource(moduleUrl("./compensation/dashboard.js"), { rel: "modulepreload" });
    prefetchResource(moduleUrl("./map/dashboard.js"), { rel: "modulepreload" });
    prefetchResource(moduleUrl("./search/dashboard.js"), { rel: "modulepreload" });
    prefetchResource(moduleUrl("./win-rate/dashboard.js"), { rel: "modulepreload" });
    prefetchResource(moduleUrl("./optimization/dashboard.js"), { rel: "modulepreload" });
  }, 3000);
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

import { formatDate, normaliseString } from "../utils.js";

const WINNING_LABELS = new Set([
  "\u5f53\u9078",
  "\u88dc\u6b20\u5f53\u9078",
  "\u7e70\u4e0a\u5f53\u9078",
  "\u7e70\u308a\u4e0a\u3052\u5f53\u9078",
  "\u5f53\u305b\u3093",
  "\u518d\u9078",
]);
const MAX_TABLE_ROWS = 400;

const TEXT = {
  yearSuffix: "\u5e74",
  electionCount: "\u9078\u6319\u4ef6\u6570",
  candidateCount: "\u5019\u88dc\u8005\u6570",
  winnerCount: "\u5f53\u9078\u8005\u6570",
  unaffiliated: "\u7121\u6240\u5c5e",
  genderUnknown: "\u4e0d\u660e",
  genderBreakdown: "\u6027\u5225\u69cb\u6210",
  medianAgeLabel: "\u5e74\u9f62\u306e\u4e2d\u592e\u5024",
  ageSuffix: "\u6b73",
  noResults: "\u8a72\u5f53\u3059\u308b\u5019\u88dc\u8005\u30c7\u30fc\u30bf\u306f\u3042\u308a\u307e\u305b\u3093",
  resultsPrefix: "\u4ef6\u8868\u793a\u4e2d\uff08\u6700\u5927 ",
  resultsSuffix: " \u4ef6\u307e\u3067\u8868\u793a\uff09",
};

function toDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function buildElectionsForSearch(elections) {
  return elections.map((item) => {
    const sourceKey = `${item.election_name}_${toDateKey(item.election_day)}`;
    return {
      ...item,
      source_key: sourceKey,
      election_day_key: item.election_day ? formatDate(item.election_day) : null,
    };
  });
}

function unique(values) {
  const set = new Set();
  for (const value of values) {
    const text = normaliseString(value);
    if (text) set.add(text);
  }
  return Array.from(set);
}

function computeStats(elections, candidates) {
  const competitionRatios = elections
    .filter((item) => item.candidate_count && item.seats)
    .map((item) => item.candidate_count / item.seats)
    .filter((value) => Number.isFinite(value) && value > 0);

  const averageCompetition =
    competitionRatios.length === 0
      ? "-"
      : (
          competitionRatios.reduce((sum, value) => sum + value, 0) /
          competitionRatios.length
        ).toFixed(2);

  return {
    elections: elections.length,
    candidates: candidates.length,
    parties: unique(candidates.map((candidate) => candidate.party)).length,
    competition: averageCompetition,
  };
}

function renderSummary(stats) {
  const formatNumber = (value) =>
    typeof value === "number" ? value.toLocaleString("ja-JP") : value;
  document.getElementById("search-summary-elections").textContent = formatNumber(
    stats.elections,
  );
  document.getElementById("search-summary-candidates").textContent = formatNumber(
    stats.candidates,
  );
  document.getElementById("search-summary-parties").textContent = formatNumber(
    stats.parties,
  );
  document.getElementById("search-summary-competition").textContent = formatNumber(
    stats.competition,
  );
}

function buildTimelineOption(elections) {
  const yearly = new Map();
  for (const election of elections) {
    if (!(election.election_day instanceof Date)) continue;
    const year = election.election_day.getFullYear();
    yearly.set(year, (yearly.get(year) ?? 0) + 1);
  }
  const years = Array.from(yearly.entries()).sort((a, b) => a[0] - b[0]);
  return {
    grid: { top: 24, left: 48, right: 24, bottom: 32 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: years.map(([year]) => `${year}${TEXT.yearSuffix}`),
      axisLabel: { rotate: 0 },
    },
    yAxis: {
      type: "value",
      name: TEXT.electionCount,
    },
    series: [
      {
        type: "line",
        smooth: true,
        data: years.map(([, count]) => count),
        areaStyle: { opacity: 0.25 },
        lineStyle: { width: 3, color: "#2563eb" },
        symbolSize: 8,
      },
    ],
  };
}

function renderTimelineChart(elementId, elections) {
  const chart = echarts.init(document.getElementById(elementId));
  chart.setOption(buildTimelineOption(elections));
  return chart;
}

function buildPartySeries(candidates) {
  const totals = new Map();
  for (const candidate of candidates) {
    const party = candidate.party || TEXT.unaffiliated;
    if (!totals.has(party)) {
      totals.set(party, { total: 0, winners: 0 });
    }
    const info = totals.get(party);
    info.total += 1;
    if (candidate.outcome && WINNING_LABELS.has(candidate.outcome)) {
      info.winners += 1;
    }
  }
  return Array.from(totals.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 18);
}

function buildPartyOption(candidates) {
  const sortedParties = buildPartySeries(candidates);
  const categories = sortedParties.map(([party]) => party);
  return {
    grid: { top: 32, bottom: 20, left: 120, right: 24 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    legend: {
      top: 0,
      textStyle: { fontSize: 12 },
    },
    xAxis: {
      type: "value",
    },
    yAxis: {
      type: "category",
      data: categories,
      axisLabel: { fontSize: 12 },
    },
    series: [
      {
        name: TEXT.candidateCount,
        type: "bar",
        stack: "total",
        emphasis: { focus: "series" },
        data: sortedParties.map(([, { total, winners }]) => total - winners),
        itemStyle: { color: "#cbd5f5" },
      },
      {
        name: TEXT.winnerCount,
        type: "bar",
        stack: "total",
        emphasis: { focus: "series" },
        data: sortedParties.map(([, { winners }]) => winners),
        itemStyle: { color: "#2563eb" },
      },
    ],
  };
}

function renderPartyChart(elementId, candidates) {
  const chart = echarts.init(document.getElementById(elementId));
  chart.setOption(buildPartyOption(candidates));
  return chart;
}

function buildDemographicsOption(candidates) {
  const ageValues = candidates
    .map((candidate) => {
      if (typeof candidate.age === "number") return candidate.age;
      const parsed = Number.parseFloat(candidate.age);
      return Number.isFinite(parsed) ? parsed : null;
    })
    .filter((value) => value !== null);

  const sortedAge = ageValues.slice().sort((a, b) => a - b);
  const medianAge =
    sortedAge.length === 0
      ? null
      : sortedAge.length % 2 === 1
      ? sortedAge[(sortedAge.length - 1) / 2]
      : (sortedAge[sortedAge.length / 2 - 1] + sortedAge[sortedAge.length / 2]) / 2;

  const byGender = candidates.reduce((acc, candidate) => {
    const gender = candidate.gender || TEXT.genderUnknown;
    acc[gender] = (acc[gender] ?? 0) + 1;
    return acc;
  }, {});

  return {
    tooltip: { trigger: "item" },
    legend: { top: 0 },
    series: [
      {
        name: TEXT.genderBreakdown,
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: true,
        label: { formatter: "{b}: {c}\u4eba ({d}%)" },
        data: Object.entries(byGender).map(([name, value]) => ({
          name,
          value,
        })),
      },
    ],
    graphic:
      medianAge !== null
        ? [
            {
              type: "group",
              left: "center",
              top: "center",
              children: [
                {
                  type: "text",
                  style: {
                    text: TEXT.medianAgeLabel,
                    fill: "#475569",
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: "center",
                  },
                  left: "center",
                  top: "center",
                },
                {
                  type: "text",
                  style: {
                    text: `${medianAge.toFixed(1)} ${TEXT.ageSuffix}`,
                    fill: "#0f172a",
                    fontSize: 18,
                    fontWeight: 700,
                    textAlign: "center",
                  },
                  left: "center",
                  top: 18,
                },
              ],
            },
          ]
        : [],
  };
}

function renderDemographicsChart(elementId, candidates) {
  const chart = echarts.init(document.getElementById(elementId));
  chart.setOption(buildDemographicsOption(candidates));
  return chart;
}

function formatPartyLabel(value) {
  const text = normaliseString(value);
  return text || TEXT.unaffiliated;
}

function renderTable(candidates, filters) {
  const resultsBody = document.getElementById("results-body");
  resultsBody.textContent = "";

  const rows = candidates.slice(0, MAX_TABLE_ROWS);
  const fragment = document.createDocumentFragment();

  for (const candidate of rows) {
    const election = filters.findElection(candidate);
    const partyLabel = formatPartyLabel(candidate.party);
    const outcome = normaliseString(candidate.outcome) || "-";
    const isWinner = outcome && WINNING_LABELS.has(outcome);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="min-width:220px">${election?.election_name ?? "-"}</td>
      <td>${formatDate(election?.election_day ?? null)}</td>
      <td>${election?.seats ?? "-"}</td>
      <td>${election?.candidate_count ?? "-"}</td>
      <td><span class="pill">${partyLabel}</span></td>
      <td><span class="badge${isWinner ? " winner" : ""}">${outcome}</span></td>
    `;
    fragment.appendChild(tr);
  }

  if (rows.length === 0) {
    const empty = document.createElement("tr");
    empty.innerHTML = `<td colspan="6" style="text-align:center; color: var(--text-muted); padding: 32px 16px;">${TEXT.noResults}</td>`;
    fragment.appendChild(empty);
  }

  resultsBody.appendChild(fragment);

  document.getElementById("results-count").textContent = `${rows.length.toLocaleString(
    "ja-JP",
  )}${TEXT.resultsPrefix}${MAX_TABLE_ROWS.toLocaleString("ja-JP")}${TEXT.resultsSuffix}`;
}

function buildFilters(elections) {
  const indexByName = new Map();
  const indexByKey = new Map();

  for (const election of elections) {
    indexByName.set(election.election_name, election);
    indexByKey.set(election.source_key, election);
  }

  return {
    text: "",
    start: null,
    end: null,
    party: "",
    selectedKeys: null,
    indexByName,
    indexByKey,
    matchesElection(candidate) {
      const source = candidate.source_file
        ? candidate.source_file.replace(/\.html$/i, "")
        : candidate.source_key;
      return this.selectedKeys ? this.selectedKeys.has(source) : true;
    },
    findElection(candidate) {
      const source = candidate.source_file
        ? candidate.source_file.replace(/\.html$/i, "")
        : candidate.source_key;
      if (this.indexByKey.has(source)) return this.indexByKey.get(source);
      const [name] = source.split("_");
      return this.indexByName.get(name) ?? null;
    },
  };
}

function filterElections(elections, filters) {
  const text = filters.text.toLowerCase();
  return elections.filter((election) => {
    const matchesText =
      text.length === 0 ||
      normaliseString(election.election_name).toLowerCase().includes(text);

    const matchesStart =
      !filters.start ||
      (election.election_day instanceof Date &&
        election.election_day >= filters.start);

    const matchesEnd =
      !filters.end ||
      (election.election_day instanceof Date && election.election_day <= filters.end);

    return matchesText && matchesStart && matchesEnd;
  });
}

function filterCandidates(candidates, filters) {
  return candidates.filter((candidate) => {
    if (filters.party && candidate.party !== filters.party) return false;
    if (!filters.matchesElection(candidate)) return false;
    return true;
  });
}

export function initElectionSearchDashboard({ elections, candidates }) {
  const preparedElections = buildElectionsForSearch(elections);
  const filters = buildFilters(preparedElections);
  filters.selectedKeys = new Set(preparedElections.map((item) => item.source_key));

  renderSummary(computeStats(preparedElections, candidates));

  const partySelect = document.getElementById("party-select");
  const parties = unique(candidates.map((candidate) => candidate.party))
    .sort((a, b) => a.localeCompare(b, "ja"));
  for (const party of parties) {
    const option = document.createElement("option");
    option.value = party;
    option.textContent = party;
    partySelect.appendChild(option);
  }

  const timelineChart = renderTimelineChart("timeline-chart", preparedElections);
  const partyChart = renderPartyChart("party-chart", candidates);
  const demographicsChart = renderDemographicsChart("demographics-chart", candidates);

  const resizeCharts = () => {
    timelineChart.resize();
    partyChart.resize();
    demographicsChart.resize();
  };

  const update = () => {
    const selectedElections = filterElections(preparedElections, filters);
    filters.selectedKeys = new Set(selectedElections.map((item) => item.source_key));

    const filteredCandidates = filterCandidates(candidates, filters);
    renderTable(filteredCandidates, filters);

    timelineChart.setOption(buildTimelineOption(selectedElections), true);
    partyChart.setOption(buildPartyOption(filteredCandidates), true);
    demographicsChart.setOption(buildDemographicsOption(filteredCandidates), true);
  };

  const searchInput = document.getElementById("search-text");
  searchInput.addEventListener("input", (event) => {
    filters.text = event.target.value.trim();
    update();
  });

  document.getElementById("date-start").addEventListener("change", (event) => {
    const { value } = event.target;
    filters.start = value ? new Date(value) : null;
    update();
  });

  document.getElementById("date-end").addEventListener("change", (event) => {
    const { value } = event.target;
    filters.end = value ? new Date(value) : null;
    update();
  });

  partySelect.addEventListener("change", (event) => {
    filters.party = event.target.value;
    update();
  });

  document.getElementById("reset-button").addEventListener("click", () => {
    filters.text = "";
    filters.start = null;
    filters.end = null;
    filters.party = "";
    searchInput.value = "";
    document.getElementById("date-start").value = "";
    document.getElementById("date-end").value = "";
    partySelect.value = "";
    update();
  });

  window.addEventListener("resize", resizeCharts);
  update();

  return {
    resize: () => resizeCharts(),
  };
}

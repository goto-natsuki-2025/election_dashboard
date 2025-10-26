import { loadCompensationData as loadCompensationDataset } from "./data-loader.js";
const TOP_BAR_PARTY_COUNT = 10;
const TOP_TREND_PARTY_COUNT = 10;
const TABLE_LIMIT = 20;
const MOBILE_YEAR_SPAN_DEFAULT = 10;
const DESKTOP_YEAR_SPAN_DEFAULT = 20;
const charts = [];
function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || navigator.vendor || "";
  return /android|iphone|ipad|ipod|windows phone|mobile/i.test(userAgent);
}
const TEXT = {
  summaryTitle: "議員報酬推計",
  summaryDescription:
    "2020年時点の議員報酬月額と期末手当水準を基準に、当選議員（補欠当選・繰り上げ当選を含む）の在任月数を掛け合わせた推計値です。報酬データが見つからない自治体は集計に含まれていません。",
  totalLabel: "推計総額",
  seatLabel: "座席数",
  municipalityLabel: "自治体数",
  barChartTitle: "政党別推計年額（上位10党）",
  trendChartTitle: "年別推移（推計上位党）",
  tableTitle: "政党別推計年額ランキング",
  tableNote:
    "推計年額は、自治体別に算出した年額（議員報酬月額×(12 + 期末手当率の合計/100)）に当選議員数を掛けて集計しています。",
  yenSuffix: "円",
  billionUnit: "億円",
  millionUnit: "百万円",
};function formatYenShort(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1e8) {
    const billions = Math.round(value / 1e8);
    return `${billions}${TEXT.billionUnit}`;
  }
  if (value >= 1e6) {
    const millions = Math.round(value / 1e6);
    return `${millions}${TEXT.millionUnit}`;
  }
  return `${Math.round(value)}${TEXT.yenSuffix}`;
}
function formatAxisLabel(value) {
  if (!Number.isFinite(value)) return "";
  const billions = Math.round(value / 1e8);
  return `${billions}${TEXT.billionUnit}`;
}
function formatInteger(value) {
  if (!Number.isFinite(value)) return "-";
  return String(Math.round(value));
}
function aggregateMunicipalRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.prefecture}::${row.municipality}::${row.party}::${row.year}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row });
      continue;
    }
    existing.total_compensation += row.total_compensation ?? 0;
    existing.annual_compensation += row.annual_compensation ?? 0;
    existing.bonus_compensation =
      (existing.bonus_compensation ?? 0) + (row.bonus_compensation ?? 0);
    existing.months_in_term = (existing.months_in_term ?? 0) + (row.months_in_term ?? 0);
    existing.bonus_count_march =
      (existing.bonus_count_march ?? 0) + (row.bonus_count_march ?? 0);
    existing.bonus_count_june =
      (existing.bonus_count_june ?? 0) + (row.bonus_count_june ?? 0);
    existing.bonus_count_december =
      (existing.bonus_count_december ?? 0) + (row.bonus_count_december ?? 0);
    existing.seat_count = Math.max(existing.seat_count ?? 0, row.seat_count ?? 0);
    const incomingElectionYear = row.election_year ?? row.year ?? -Infinity;
    const existingElectionYear = existing.election_year ?? existing.year ?? -Infinity;
    if (incomingElectionYear > existingElectionYear) {
      existing.monthly_compensation = row.monthly_compensation;
      existing.bonus_amount_march = row.bonus_amount_march;
      existing.bonus_amount_june = row.bonus_amount_june;
      existing.bonus_amount_december = row.bonus_amount_december;
      existing.term_start = row.term_start;
      existing.term_end = row.term_end;
      existing.election_date = row.election_date;
      existing.election_year = row.election_year ?? row.year;
    }
  }
  return Array.from(map.values());
}
function buildPartyYearRowsFromMunicipalRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.year === undefined || row.year === null) continue;
    const year = Number(row.year);
    if (!Number.isFinite(year)) continue;
    const key = `${row.party}::${year}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        party: row.party,
        year,
        seat_count: 0,
        total_compensation: 0,
        municipalities: new Set(),
      };
      map.set(key, entry);
    }
    entry.seat_count += row.seat_count ?? 0;
    entry.total_compensation += row.total_compensation ?? 0;
    entry.municipalities.add(`${row.prefecture}-${row.municipality}`);
  }
  return Array.from(map.values())
    .map((entry) => ({
      party: entry.party,
      year: entry.year,
      seat_count: entry.seat_count,
      municipality_count: entry.municipalities.size,
      total_compensation: entry.total_compensation,
    }))
    .sort((a, b) => a.year - b.year || a.party.localeCompare(b.party, "ja-JP"));
}
function buildPartySummaryFromMunicipalRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.party;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        party: row.party,
        seat_count: 0,
        total_compensation: 0,
        municipalities: new Set(),
      };
      map.set(key, entry);
    }
    entry.seat_count += row.seat_count ?? 0;
    entry.total_compensation += row.total_compensation ?? 0;
    entry.municipalities.add(`${row.prefecture}-${row.municipality}`);
  }
  return Array.from(map.values()).map((entry) => ({
    party: entry.party,
    seat_count: entry.seat_count,
    total_compensation: entry.total_compensation,
    municipality_count: entry.municipalities.size,
  }));
}
function getYearBounds(rows) {
  let minYear = Number.POSITIVE_INFINITY;
  let maxYear = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const value = Number(row.year);
    if (!Number.isFinite(value)) continue;
    if (value < minYear) minYear = value;
    if (value > maxYear) maxYear = value;
  }
  if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) {
    return { minYear: null, maxYear: null, availableSpan: null };
  }
  return {
    minYear,
    maxYear,
    availableSpan: maxYear - minYear + 1,
  };
}
function deriveCompensationView(rawData, spanYears) {
  const currentYear = new Date().getFullYear();
  const sourceRows = Array.isArray(rawData.municipality_breakdown)
    ? rawData.municipality_breakdown.slice()
    : [];
  const sourceTerms = Array.isArray(rawData.municipality_terms)
    ? rawData.municipality_terms.slice()
    : [];
  const municipalRowsWithinCurrentYear = sourceRows.filter((row) => {
    const value = Number(row.year);
    return Number.isFinite(value) && value <= currentYear;
  });
  const termRowsWithinCurrentYear = sourceTerms.filter((term) => {
    const value = Number(
      term.election_year ??
        (typeof term.term_start === "string" ? Number(term.term_start.slice(0, 4)) : NaN),
    );
    return Number.isFinite(value) && value <= currentYear;
  });
  const rowsForProcessing =
    municipalRowsWithinCurrentYear.length > 0 ? municipalRowsWithinCurrentYear : sourceRows;
  const termsForProcessing =
    termRowsWithinCurrentYear.length > 0 ? termRowsWithinCurrentYear : sourceTerms;
  const { minYear, maxYear, availableSpan } = getYearBounds(rowsForProcessing);
  const effectiveMaxYear =
    maxYear !== null && Number.isFinite(maxYear) ? Math.min(maxYear, currentYear) : maxYear;
  const effectiveSpan =
    availableSpan !== null && Number.isFinite(effectiveMaxYear) && Number.isFinite(minYear)
      ? Math.max(0, effectiveMaxYear - minYear + 1)
      : availableSpan;
  let requestedSpan = Number(spanYears);
  if (!Number.isFinite(requestedSpan) || requestedSpan < 0) {
    requestedSpan = 0;
  }
  if (effectiveSpan !== null) {
    requestedSpan = Math.min(requestedSpan, effectiveSpan);
  }
  const cutoffYear =
    requestedSpan > 0 && Number.isFinite(effectiveMaxYear)
      ? effectiveMaxYear - requestedSpan + 1
      : null;
  const filteredMunicipalityRows =
    cutoffYear !== null
      ? rowsForProcessing.filter(
          (row) => Number(row.year) >= cutoffYear && Number(row.year) <= effectiveMaxYear,
        )
      : rowsForProcessing.filter((row) => Number(row.year) <= effectiveMaxYear);
  const filteredTerms =
    cutoffYear !== null
      ? termsForProcessing.filter((term) => {
          const electionYear = Number(
            term.election_year ??
              (typeof term.term_start === "string" ? term.term_start.slice(0, 4) : NaN),
          );
          return (
            Number.isFinite(electionYear) &&
            electionYear >= cutoffYear &&
            electionYear <= effectiveMaxYear
          );
        })
      : termsForProcessing.filter((term) => {
          const electionYear = Number(
            term.election_year ??
              (typeof term.term_start === "string" ? term.term_start.slice(0, 4) : NaN),
          );
          return Number.isFinite(electionYear) && electionYear <= effectiveMaxYear;
        });
  const aggregatedMunicipality = aggregateMunicipalRows(filteredMunicipalityRows);
  const partyYearRows = buildPartyYearRowsFromMunicipalRows(aggregatedMunicipality);
  const partySummary = buildPartySummaryFromMunicipalRows(aggregatedMunicipality);
  return {
    source_compensation_year: rawData.source_compensation_year,
    party_summary: partySummary,
    rows: partyYearRows,
    municipality_breakdown: aggregatedMunicipality,
    municipality_terms: filteredTerms,
    latest_year: effectiveMaxYear,
    earliest_year: minYear,
    applied_span_years: requestedSpan,
    cutoff_year: cutoffYear,
    available_span_years: effectiveSpan,
  };
}
function renderCompensationView(data) {
  const summary = computeSummary(data);
  renderSummaryCards(summary, data);
  const sortedSummary = data.party_summary
    .slice()
    .sort((a, b) => b.total_compensation - a.total_compensation);
  const topBarParties = sortedSummary.slice(0, TOP_BAR_PARTY_COUNT);
  createBarChart("compensation-bar-chart", topBarParties);
  const trendParties = sortedSummary.slice(0, TOP_TREND_PARTY_COUNT);
  createTrendChart("compensation-trend-chart", data.rows, trendParties);
  renderTable(sortedSummary);
}
function renderSummaryCards(summary, metadata) {
  document.getElementById("comp-summary-total").textContent = formatYenShort(
    summary.totalCompensation,
  );
  document.getElementById("comp-summary-seats").textContent = formatInteger(
    summary.totalSeats,
  );
  document.getElementById("comp-summary-municipalities").textContent = formatInteger(
    summary.totalMunicipalities,
  );
  const note = document.getElementById("comp-summary-note");
  if (note) {
    const sourceYear = metadata?.source_compensation_year ?? 2020;
    note.textContent = `基準年: ${sourceYear}年 / 集計政党数: ${formatInteger(summary.partyCount)}党`;
  }
}
function createBarChart(elementId, parties) {
  const element = document.getElementById(elementId);
  if (!element) return null;
  let chart = echarts.getInstanceByDom(element);
  if (!chart) {
    chart = echarts.init(element, undefined, { renderer: "svg" });
    charts.push(chart);
  }
  const categories = parties.map((item) => item.party);
  const values = parties.map((item) => item.total_compensation);
  chart.setOption(
    {
      grid: { top: 32, left: 120, right: 24, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => formatYenShort(value),
      },
      xAxis: {
        type: "value",
        axisLabel: {
          formatter: formatAxisLabel,
        },
        splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
      },
      yAxis: {
        type: "category",
        data: categories,
        axisLabel: { interval: 0 },
      },
      series: [
        {
          type: "bar",
          data: values,
          itemStyle: {
            color: ({ dataIndex }) => (dataIndex === 0 ? "#2563eb" : "#60a5fa"),
            borderRadius: [6, 6, 6, 6],
          },
        },
      ],
    },
    true,
  );
  return chart;
}
function createTrendChart(elementId, yearlyRows, parties) {
  const element = document.getElementById(elementId);
  if (!element) return null;
  let chart = echarts.getInstanceByDom(element);
  if (!chart) {
    chart = echarts.init(element, undefined, { renderer: "svg" });
    charts.push(chart);
  }
  const years = Array.from(new Set(yearlyRows.map((row) => row.year))).sort((a, b) => a - b);
  const partyYearMap = new Map();
  for (const row of yearlyRows) {
    const key = `${row.party}::${row.year}`;
    partyYearMap.set(key, row.total_compensation ?? 0);
  }
  const series = parties.map((party) => {
    const data = years.map((year) => {
      const key = `${party.party}::${year}`;
      return partyYearMap.get(key) ?? null;
    });
    return {
      name: party.party,
      type: "line",
      smooth: false,
      data,
    };
  });
  chart.setOption(
    {
      grid: { top: 40, left: 76, right: 24, bottom: 32 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => formatYenShort(value),
      },
      legend: {
        type: "scroll",
        top: 0,
      },
      xAxis: {
        type: "category",
        data: years,
      },
      yAxis: {
        type: "value",
        axisLabel: { formatter: formatAxisLabel, align: "right" },
        splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
      },
      series,
    },
    true,
  );
  return chart;
}
function renderTable(rows) {
  const tbody = document.getElementById("compensation-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  const topRows = rows
    .slice()
    .sort((a, b) => b.total_compensation - a.total_compensation)
    .slice(0, TABLE_LIMIT);
  topRows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const rankCell = document.createElement("td");
    rankCell.textContent = `${index + 1}`;
    tr.appendChild(rankCell);
    const partyCell = document.createElement("td");
    partyCell.textContent = row.party || "無所属";
    tr.appendChild(partyCell);
    const seatCell = document.createElement("td");
    seatCell.textContent = row.seat_count;
    tr.appendChild(seatCell);
    const municipalityCell = document.createElement("td");
    municipalityCell.textContent = row.municipality_count;
    tr.appendChild(municipalityCell);
    const valueCell = document.createElement("td");
    valueCell.textContent = formatYenShort(row.total_compensation);
    tr.appendChild(valueCell);
    tbody.appendChild(tr);
  });
}
function updateSpanHelpText(element, viewData) {
  if (!element) return;
  const latestYear = Number(viewData?.latest_year);
  const earliestYear = Number(viewData?.earliest_year);
  const span = Number(viewData?.applied_span_years);
  if (!Number.isFinite(latestYear)) {
    element.textContent = "0 を指定すると全期間を対象にします。";
    return;
  }
  if (span > 0 && Number.isFinite(viewData?.cutoff_year)) {
    element.textContent = `${viewData.cutoff_year}年?${latestYear}年を集計しています（0 を指定すると全期間）。`;
    return;
  }
  if (Number.isFinite(earliestYear)) {
    element.textContent = `${earliestYear}年?${latestYear}年を集計しています。0 を指定すると全期間を対象にします。`;
  } else {
    element.textContent = "0 を指定すると全期間を対象にします。";
  }
}
function computeSummary(data) {
  const totalCompensation = data.party_summary.reduce(
    (sum, item) => sum + item.total_compensation,
    0,
  );
  const totalSeats = data.party_summary.reduce((sum, item) => sum + item.seat_count, 0);
  const municipalities = new Set(
    data.municipality_breakdown.map((item) => `${item.prefecture}-${item.municipality}`),
  );
  return {
    totalCompensation,
    totalSeats,
    totalMunicipalities: municipalities.size,
    partyCount: data.party_summary.length,
  };
}
export async function initCompensationDashboard() {
  const root = document.getElementById("compensation-dashboard");
  if (!root) {
    return null;
  }
  const spanInput = document.getElementById("compensation-year-span");
  const applyButton = document.getElementById("compensation-apply-span");
  const helpElement = document.getElementById("compensation-span-help");
  const mobileDevice = isMobileDevice();
  try {
    const rawData = await loadCompensationDataset();
    const bounds = getYearBounds(Array.isArray(rawData.municipality_breakdown) ? rawData.municipality_breakdown : []);
    const availableSpan = bounds.availableSpan;
    const defaultCandidate = mobileDevice ? MOBILE_YEAR_SPAN_DEFAULT : DESKTOP_YEAR_SPAN_DEFAULT;
    const defaultSpan =
      availableSpan !== null && defaultCandidate > 0
        ? Math.min(defaultCandidate, availableSpan)
        : defaultCandidate;
    if (spanInput) {
      spanInput.value = String(defaultSpan);
    }
    const state = {
      rawData,
      currentSpan: defaultSpan,
      viewData: null,
    };
    const parseSpanInput = () => {
      if (!spanInput) return state.currentSpan ?? 0;
      const value = Number.parseInt(spanInput.value, 10);
      return Number.isFinite(value) ? value : 0;
    };
    const applySpan = (spanValue) => {
      const viewData = deriveCompensationView(rawData, spanValue);
      state.currentSpan = viewData.applied_span_years ?? 0;
      state.viewData = viewData;
      if (spanInput) {
        spanInput.value = String(state.currentSpan);
      }
      updateSpanHelpText(helpElement, viewData);
      const message = document.getElementById("compensation-error");
      if (message) {
        message.hidden = true;
        message.textContent = "";
      }
      renderCompensationView(viewData);
    };
    applySpan(defaultSpan);
    applyButton?.addEventListener("click", () => {
      applySpan(parseSpanInput());
    });
    spanInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applySpan(parseSpanInput());
      }
    });
    spanInput?.addEventListener("change", () => {
      applySpan(parseSpanInput());
    });
    return {
      resize: () => {
        for (const chart of charts) {
          chart.resize();
        }
      },
      applySpan,
    };
  } catch (error) {
    console.error(error);
    const message = document.getElementById("compensation-error");
    if (message) {
      message.hidden = false;
      message.textContent =
        "議員報酬データ（圧縮CSV）の読み込みに失敗しました。データファイルの配置を確認してください。";
    }
  }
  return {
    resize: () => {
      for (const chart of charts) {
        chart.resize();
      }
    },
  };
}


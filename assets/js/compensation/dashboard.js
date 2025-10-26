const SUMMARY_URL = new URL(
  "../../../data/party_compensation_summary_2020.csv",
  import.meta.url,
).toString();
const YEARLY_URL = new URL(
  "../../../data/party_compensation_yearly_2020.csv",
  import.meta.url,
).toString();
const MUNICIPAL_URL = new URL(
  "../../../data/party_compensation_municipal_2020.csv",
  import.meta.url,
).toString();
const TOP_BAR_PARTY_COUNT = 10;
const TOP_TREND_PARTY_COUNT = 5;
const TABLE_LIMIT = 20;

const charts = [];

const TEXT = {
  summaryTitle: "政党別議員報酬推計",
  summaryDescription:
    "2020年時点の議員報酬月額・期末手当水準を用いた推計値です（自治体との突合ができなかったケースは集計に含まれていません）。",
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
};

const SUMMARY_COLUMNS = {
  party: "party",
  totalCompensation: "total_compensation",
  seatCount: "seat_count",
  municipalityCount: "municipality_count",
};

const YEARLY_COLUMNS = {
  party: "party",
  year: "year",
  seatCount: "seat_count",
  municipalityCount: "municipality_count",
  totalCompensation: "total_compensation",
};

const MUNICIPAL_COLUMNS = {
  party: "party",
  year: "year",
  prefecture: "prefecture",
  municipality: "municipality",
  seatCount: "seat_count",
  annualCompensation: "annual_compensation",
  monthlyCompensation: "monthly_compensation",
  bonusCompensation: "bonus_compensation",
  totalCompensation: "total_compensation",
  monthsInTerm: "months_in_term",
  bonusMarch: "bonus_count_march",
  bonusJune: "bonus_count_june",
  bonusDecember: "bonus_count_december",
  bonusAmountMarch: "bonus_amount_march",
  bonusAmountJune: "bonus_amount_june",
  bonusAmountDecember: "bonus_amount_december",
};

function formatYenShort(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1e11) {
    return `${(value / 1e8).toFixed(1)}${TEXT.billionUnit}`;
  }
  if (value >= 1e8) {
    return `${(value / 1e8).toFixed(2)}${TEXT.billionUnit}`;
  }
  if (value >= 1e7) {
    return `${Math.round(value / 1e6)}${TEXT.millionUnit}`;
  }
  return `${Math.round(value).toLocaleString("ja-JP")}${TEXT.yenSuffix}`;
}

function formatAxisLabel(value) {
  return `${(value / 1e8).toFixed(1)}${TEXT.billionUnit}`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

async function loadCsv(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  const csvText = await response.text();
  return Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  }).data;
}

async function loadCompensationData() {
  const [summaryRows, yearlyRows, municipalityRows] = await Promise.all([
    loadCsv(SUMMARY_URL),
    loadCsv(YEARLY_URL),
    loadCsv(MUNICIPAL_URL),
  ]);

  const summary = summaryRows.map((row) => ({
    party: String(row[SUMMARY_COLUMNS.party] ?? "").trim(),
    total_compensation: toNumber(row[SUMMARY_COLUMNS.totalCompensation]) ?? 0,
    seat_count: toNumber(row[SUMMARY_COLUMNS.seatCount]) ?? 0,
    municipality_count: toNumber(row[SUMMARY_COLUMNS.municipalityCount]) ?? 0,
  }));

  const yearly = yearlyRows
    .map((row) => ({
      party: String(row[YEARLY_COLUMNS.party] ?? "").trim(),
      year: toNumber(row[YEARLY_COLUMNS.year]),
      seat_count: toNumber(row[YEARLY_COLUMNS.seatCount]) ?? 0,
      municipality_count: toNumber(row[YEARLY_COLUMNS.municipalityCount]) ?? 0,
      total_compensation: toNumber(row[YEARLY_COLUMNS.totalCompensation]) ?? 0,
    }))
    .filter((row) => row.year !== null);

  const municipality = municipalityRows
    .map((row) => ({
      party: String(row[MUNICIPAL_COLUMNS.party] ?? "").trim(),
      year: toNumber(row[MUNICIPAL_COLUMNS.year]),
      prefecture: row[MUNICIPAL_COLUMNS.prefecture]
        ? String(row[MUNICIPAL_COLUMNS.prefecture]).trim()
        : "",
      municipality: row[MUNICIPAL_COLUMNS.municipality]
        ? String(row[MUNICIPAL_COLUMNS.municipality]).trim()
        : "",
      seat_count: toNumber(row[MUNICIPAL_COLUMNS.seatCount]) ?? 0,
      annual_compensation: toNumber(row[MUNICIPAL_COLUMNS.annualCompensation]) ?? 0,
      monthly_compensation: toNumber(row[MUNICIPAL_COLUMNS.monthlyCompensation]) ?? 0,
      total_compensation: toNumber(row[MUNICIPAL_COLUMNS.totalCompensation]) ?? 0,
      months_in_term: toNumber(row[MUNICIPAL_COLUMNS.monthsInTerm]),
      bonus_count_march: toNumber(row[MUNICIPAL_COLUMNS.bonusMarch]),
      bonus_count_june: toNumber(row[MUNICIPAL_COLUMNS.bonusJune]),
      bonus_count_december: toNumber(row[MUNICIPAL_COLUMNS.bonusDecember]),
    }))
    .filter((row) => row.year !== null && row.prefecture && row.municipality);

  return {
    source_compensation_year: 2020,
    party_summary: summary,
    rows: yearly,
    municipality_breakdown: municipality,
  };
}

function renderSummaryCards(summary, metadata) {
  const formatNumber = (value) => value.toLocaleString("ja-JP");
  document.getElementById("comp-summary-total").textContent = formatYenShort(
    summary.totalCompensation,
  );
  document.getElementById("comp-summary-seats").textContent = formatNumber(summary.totalSeats);
  document.getElementById("comp-summary-municipalities").textContent = formatNumber(
    summary.totalMunicipalities,
  );

  const note = document.getElementById("comp-summary-note");
  if (note) {
    const sourceYear = metadata?.source_compensation_year ?? 2020;
    note.textContent = `基準年: ${sourceYear}年 / 集計政党: ${summary.partyCount.toLocaleString(
      "ja-JP",
    )}党`;
  }
}

function createBarChart(elementId, parties) {
  const element = document.getElementById(elementId);
  if (!element) return null;
  const chart = echarts.init(element, undefined, { renderer: "svg" });
  charts.push(chart);

  const categories = parties.map((item) => item.party);
  const values = parties.map((item) => item.total_compensation);

  chart.setOption({
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
        itemStyle: { color: "#2563eb" },
        barWidth: 18,
      },
    ],
  });
  return chart;
}

function createTrendChart(elementId, rows, parties) {
  const element = document.getElementById(elementId);
  if (!element) return null;
  const chart = echarts.init(element, undefined, { renderer: "svg" });
  charts.push(chart);

  const years = Array.from(new Set(rows.map((row) => row.year))).sort((a, b) => a - b);
  const yearIndex = new Map(years.map((year, idx) => [year, idx]));

  const series = parties.map((party) => {
    const data = new Array(years.length).fill(null);
    for (const row of rows) {
      if (row.party !== party.party) continue;
      const idx = yearIndex.get(row.year);
      if (idx !== undefined) {
        data[idx] = row.total_compensation;
      }
    }
    return {
      name: party.party,
      type: "line",
      smooth: true,
      data,
    };
  });

  chart.setOption({
    grid: { top: 40, left: 56, right: 24, bottom: 32 },
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
      axisLabel: { formatter: formatAxisLabel },
      splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
    },
    series,
  });
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
    seatCell.textContent = row.seat_count.toLocaleString("ja-JP");
    tr.appendChild(seatCell);

    const municipalityCell = document.createElement("td");
    municipalityCell.textContent = row.municipality_count.toLocaleString("ja-JP");
    tr.appendChild(municipalityCell);

    const valueCell = document.createElement("td");
    valueCell.textContent = formatYenShort(row.total_compensation);
    tr.appendChild(valueCell);

    tbody.appendChild(tr);
  });
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

  try {
    const data = await loadCompensationData();
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
  } catch (error) {
    console.error(error);
    const message = document.getElementById("compensation-error");
    if (message) {
      message.hidden = false;
      message.textContent =
        "議員報酬データ（CSV）の読み込みに失敗しました。データファイルの配置を確認してください。";
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

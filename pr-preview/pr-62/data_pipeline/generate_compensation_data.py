import calendar
import math
import re
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DETAILS_PATH = DATA_DIR / "candidate_details.csv.gz"
COMPENSATION_PATH = DATA_DIR / "SeatsAndCompensation.csv"
OUTPUT_SUMMARY_CSV = DATA_DIR / "party_compensation_summary_2020.csv"
OUTPUT_YEARLY_CSV = DATA_DIR / "party_compensation_yearly_2020.csv"
OUTPUT_MUNICIPAL_CSV = DATA_DIR / "party_compensation_municipal_2020.csv"

WINNING_KEYWORDS = [
    "当選",
    "補欠当選",
    "繰上当選",
    "繰り上げ当選",
    "当せん",
    "再選",
]

PREFECTURES = [
    "北海道",
    "青森県",
    "岩手県",
    "宮城県",
    "秋田県",
    "山形県",
    "福島県",
    "茨城県",
    "栃木県",
    "群馬県",
    "埼玉県",
    "千葉県",
    "東京都",
    "神奈川県",
    "新潟県",
    "富山県",
    "石川県",
    "福井県",
    "山梨県",
    "長野県",
    "岐阜県",
    "静岡県",
    "愛知県",
    "三重県",
    "滋賀県",
    "京都府",
    "大阪府",
    "兵庫県",
    "奈良県",
    "和歌山県",
    "鳥取県",
    "島根県",
    "岡山県",
    "広島県",
    "山口県",
    "徳島県",
    "香川県",
    "愛媛県",
    "高知県",
    "福岡県",
    "佐賀県",
    "長崎県",
    "熊本県",
    "大分県",
    "宮崎県",
    "鹿児島県",
    "沖縄県",
]

TRAILING_PATTERNS = [
    "補欠",
    "再",
    "再選",
    "議会議員",
    "議員",
    "議会",
    "市長",
    "町長",
    "村長",
    "区長",
    "知事",
]

SELECTION_PATTERN = re.compile(r"選挙.*$")
WHITESPACE_PATTERN = re.compile(r"[\s\u3000]+")
DATE_PATTERN = re.compile(r"(\d{4})(\d{2})(\d{2})")

TERM_YEARS = 4

# CSV column indices (0-based) for compensation data
MONTHLY_COL_INDEX = 11
BONUS_COLUMN_INDICES: Dict[int, int] = {
    3: 12,
    6: 13,
    12: 14,
}


def to_iso_date(value) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if pd.isna(value) or value is None:
        return ""
    # pandas may store dates as Timestamp
    try:
        return pd.to_datetime(value).date().isoformat()
    except Exception:
        return str(value)


def parse_source(source: str) -> Optional[Tuple[str, str, date]]:
    if not isinstance(source, str) or not source:
        return None
    parts = source.split("_", 1)
    if len(parts) != 2:
        return None
    name_part, date_part = parts

    match = DATE_PATTERN.match(date_part)
    if not match:
        return None
    year, month, day = map(int, match.groups())
    try:
        election_date = date(year, month, day)
    except ValueError:
        return None

    name_part = WHITESPACE_PATTERN.sub("", name_part)
    name_part = SELECTION_PATTERN.sub("", name_part)
    for suffix in TRAILING_PATTERNS:
        if name_part.endswith(suffix):
            name_part = name_part[: -len(suffix)]
    prefecture = next((pref for pref in PREFECTURES if name_part.startswith(pref)), None)
    if prefecture is None:
        return None
    municipality = name_part[len(prefecture) :].strip()
    if not municipality:
        return None
    return prefecture, municipality, election_date


def clean_number(value) -> Optional[float]:
    if pd.isna(value):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    text = text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def add_years_safe(value: date, years: int) -> date:
    try:
        return value.replace(year=value.year + years)
    except ValueError:
        # Handle February 29 on non-leap year
        return value.replace(month=2, day=28, year=value.year + years)


def add_months(value: date, months: int) -> date:
    total_months = value.year * 12 + (value.month - 1) + months
    year = total_months // 12
    month = total_months % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def iterate_months(start: date, end: date):
    current = date(start.year, start.month, 1)
    end_marker = date(end.year, end.month, 1)
    while current < end_marker:
        yield current
        current = add_months(current, 1)


def months_between(start: date, end: date) -> int:
    return sum(1 for _ in iterate_months(start, end))


def count_bonus_occurrences(start: date, end: date, target_month: int) -> int:
    return sum(1 for current in iterate_months(start, end) if current.month == target_month)


def load_seat_terms() -> pd.DataFrame:
    df = pd.read_csv(DETAILS_PATH, encoding="utf-8")
    mask = df["outcome"].fillna("").astype(str).apply(
        lambda value: any(keyword in value for keyword in WINNING_KEYWORDS)
    )
    df = df.loc[mask, ["party", "source_file"]].copy()
    parsed = df["source_file"].apply(parse_source)
    df = df.assign(parsed=parsed)
    df = df.dropna(subset=["parsed"])
    parsed_df = pd.DataFrame(
        df["parsed"].tolist(),
        index=df.index,
        columns=["prefecture", "municipality", "election_date"],
    )
    df = df.join(parsed_df).drop(columns=["parsed"])

    df["election_date"] = pd.to_datetime(df["election_date"]).dt.date
    grouped = (
        df.groupby(["prefecture", "municipality", "election_date", "party"], as_index=False)
        .size()
        .rename(columns={"size": "seat_count"})
    )

    unique_elections = (
        grouped[["prefecture", "municipality", "election_date"]]
        .drop_duplicates()
        .sort_values(["prefecture", "municipality", "election_date"])
    )
    unique_elections["next_election_date"] = unique_elections.groupby(
        ["prefecture", "municipality"]
    )["election_date"].shift(-1)
    unique_elections["term_end"] = unique_elections["next_election_date"]
    missing_mask = unique_elections["term_end"].isna()
    unique_elections.loc[missing_mask, "term_end"] = unique_elections.loc[
        missing_mask, "election_date"
    ].apply(lambda value: add_years_safe(value, TERM_YEARS))
    unique_elections = unique_elections.drop(columns=["next_election_date"])

    grouped = grouped.merge(
        unique_elections,
        on=["prefecture", "municipality", "election_date"],
        how="left",
    )
    return grouped


def load_compensation_reference() -> Dict[Tuple[str, str], Dict[str, float]]:
    df = pd.read_csv(COMPENSATION_PATH, encoding="utf-8")
    monthly_col = df.columns[MONTHLY_COL_INDEX]
    bonus_cols = {month: df.columns[index] for month, index in BONUS_COLUMN_INDICES.items()}

    ref = {}
    for row in df.itertuples(index=False):
        prefecture = WHITESPACE_PATTERN.sub("", str(getattr(row, df.columns[1])))
        municipality = WHITESPACE_PATTERN.sub("", str(getattr(row, df.columns[2])))
        monthly = clean_number(getattr(row, monthly_col))
        if monthly is None:
            continue
        bonus_rates = {}
        for month, column in bonus_cols.items():
            bonus_rates[month] = clean_number(getattr(row, column)) or 0.0
        key = (prefecture, municipality)
        if key not in ref:
            ref[key] = {"monthly": monthly, "bonus_rates": bonus_rates}
    return ref


def build_party_compensation() -> dict:
    seat_terms = load_seat_terms()
    comp_map = load_compensation_reference()

    term_records = []
    for row in seat_terms.itertuples(index=False):
        key = (row.prefecture, row.municipality)
        comp = comp_map.get(key)
        if comp is None:
            continue
        start_date = row.election_date
        end_date = row.term_end
        if not isinstance(start_date, date) or not isinstance(end_date, date):
            continue

        months = months_between(start_date, end_date)
        if months <= 0:
            months = 1

        monthly = comp["monthly"]
        bonus_rates = comp["bonus_rates"]
        bonus_multiplier = 0.0
        bonus_counts = {}
        for month, rate in bonus_rates.items():
            occurrences = count_bonus_occurrences(start_date, end_date, month)
            bonus_counts[month] = occurrences
            if occurrences > 0 and rate:
                bonus_multiplier += (rate / 100.0) * occurrences

        per_seat_total = monthly * (months + bonus_multiplier)
        total_compensation = per_seat_total * row.seat_count

        term_records.append(
            {
                "prefecture": row.prefecture,
                "municipality": row.municipality,
                "party": row.party,
                "election_date": start_date,
                "term_end": end_date,
                "seat_count": row.seat_count,
                "months_in_term": months,
                "bonus_count_march": bonus_counts.get(3, 0),
                "bonus_count_june": bonus_counts.get(6, 0),
                "bonus_count_december": bonus_counts.get(12, 0),
                "monthly_compensation": monthly,
                "per_seat_compensation": per_seat_total,
                "total_compensation": total_compensation,
                "bonus_rate_march": bonus_rates.get(3, 0.0),
                "bonus_rate_june": bonus_rates.get(6, 0.0),
                "bonus_rate_december": bonus_rates.get(12, 0.0),
            }
        )

    term_df = pd.DataFrame(term_records)
    if term_df.empty:
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "currency": "JPY",
            "formula": "Prorated using monthly amount and bonus rates.",
            "source_compensation_year": 2020,
            "rows": [],
            "party_summary": [],
            "municipality_breakdown": [],
        }

    annual_records = []
    for row in term_df.itertuples(index=False):
        bonus_rates = {
            3: row.bonus_rate_march,
            6: row.bonus_rate_june,
            12: row.bonus_rate_december,
        }
        year_months = defaultdict(int)
        year_bonus_counts = defaultdict(lambda: {3: 0, 6: 0, 12: 0})

        for current in iterate_months(row.election_date, row.term_end):
            year = current.year
            year_months[year] += 1
            rate = bonus_rates.get(current.month, 0.0)
            if rate:
                year_bonus_counts[year][current.month] += 1

        for year, months in year_months.items():
            if months <= 0:
                continue
            bonus_multiplier = 0.0
            for month, rate in bonus_rates.items():
                if not rate:
                    continue
                occurrences = year_bonus_counts[year].get(month, 0)
                if occurrences > 0:
                    bonus_multiplier += (rate / 100.0) * occurrences

            per_seat_year_total = row.monthly_compensation * (months + bonus_multiplier)
            total_year_compensation = per_seat_year_total * row.seat_count

            annual_records.append(
                {
                    "party": row.party,
                    "year": year,
                    "prefecture": row.prefecture,
                    "municipality": row.municipality,
                    "seat_count": row.seat_count,
                    "monthly_compensation": row.monthly_compensation,
                    "annual_compensation": per_seat_year_total,
                    "total_compensation": total_year_compensation,
                    "months_in_term": months,
                    "bonus_count_march": year_bonus_counts[year].get(3, 0),
                    "bonus_count_june": year_bonus_counts[year].get(6, 0),
                    "bonus_count_december": year_bonus_counts[year].get(12, 0),
                    "bonus_rate_march": row.bonus_rate_march,
                    "bonus_rate_june": row.bonus_rate_june,
                    "bonus_rate_december": row.bonus_rate_december,
                    "term_start": row.election_date,
                    "term_end": row.term_end,
                    "election_year": row.election_date.year,
                }
            )

    annual_df = pd.DataFrame(annual_records)
    if annual_df.empty:
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "currency": "JPY",
            "formula": "Prorated using monthly amount and bonus rates.",
            "source_compensation_year": 2020,
            "rows": [],
            "party_summary": [],
            "municipality_breakdown": [],
        }

    party_year_rows = []
    for (party, year), group in annual_df.groupby(["party", "year"]):
        party_year_rows.append(
            {
                "party": party,
                "year": int(year),
                "seat_count": int(group["seat_count"].sum()),
                "municipality_count": int(group[["prefecture", "municipality"]].drop_duplicates().shape[0]),
                "total_compensation": float(group["total_compensation"].sum()),
            }
        )

    party_totals = defaultdict(lambda: {"total_compensation": 0.0, "seat_count": 0, "municipalities": set()})
    for row in annual_df.itertuples(index=False):
        entry = party_totals[row.party]
        entry["total_compensation"] += row.total_compensation
        entry["seat_count"] += row.seat_count
        entry["municipalities"].add((row.prefecture, row.municipality))

    party_summary = []
    for party, entry in party_totals.items():
        party_summary.append(
            {
                "party": party,
                "total_compensation": float(entry["total_compensation"]),
                "seat_count": int(entry["seat_count"]),
                "municipality_count": len(entry["municipalities"]),
            }
        )

    municipality_rows = []
    for row in annual_df.itertuples(index=False):
        bonus_amount_march = row.monthly_compensation * (row.bonus_rate_march or 0) / 100.0
        bonus_amount_june = row.monthly_compensation * (row.bonus_rate_june or 0) / 100.0
        bonus_amount_december = row.monthly_compensation * (row.bonus_rate_december or 0) / 100.0
        bonus_total = (
            bonus_amount_march * (row.bonus_count_march or 0)
            + bonus_amount_june * (row.bonus_count_june or 0)
            + bonus_amount_december * (row.bonus_count_december or 0)
        )

        municipality_rows.append(
            {
                "party": row.party,
                "year": int(row.year),
                "prefecture": row.prefecture,
                "municipality": row.municipality,
                "seat_count": int(row.seat_count),
                "annual_compensation": float(row.annual_compensation),
                "monthly_compensation": float(row.monthly_compensation),
                "bonus_compensation": float(bonus_total),
                "total_compensation": float(row.total_compensation),
                "months_in_term": int(row.months_in_term),
                "bonus_count_march": int(row.bonus_count_march),
                "bonus_count_june": int(row.bonus_count_june),
                "bonus_count_december": int(row.bonus_count_december),
                "bonus_amount_march": float(bonus_amount_march),
                "bonus_amount_june": float(bonus_amount_june),
                "bonus_amount_december": float(bonus_amount_december),
                "term_start": to_iso_date(row.term_start),
                "term_end": to_iso_date(row.term_end),
                "election_date": to_iso_date(row.term_start),
                "election_year": int(row.election_year),
            }
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "currency": "JPY",
        "formula": "Prorated using monthly amount and bonus rates.",
        "source_compensation_year": 2020,
        "rows": party_year_rows,
        "party_summary": party_summary,
        "municipality_breakdown": municipality_rows,
    }


def main() -> None:
    data = build_party_compensation()

    summary_df = pd.DataFrame(data["party_summary"])
    if not summary_df.empty:
        summary_df["total_compensation"] = summary_df["total_compensation"].round().astype("Int64")

    yearly_df = pd.DataFrame(data["rows"])
    if not yearly_df.empty:
        yearly_df["total_compensation"] = yearly_df["total_compensation"].round().astype("Int64")

    municipal_df = pd.DataFrame(data["municipality_breakdown"])
    money_columns = [
        "annual_compensation",
        "monthly_compensation",
        "bonus_compensation",
        "total_compensation",
        "bonus_amount_march",
        "bonus_amount_june",
        "bonus_amount_december",
    ]
    if not municipal_df.empty:
        for column in money_columns:
            municipal_df[column] = municipal_df[column].round().astype("Int64")
        if "election_year" in municipal_df.columns:
            municipal_df["election_year"] = municipal_df["election_year"].astype("Int64")

    # ソート
    (
        municipal_df
        .sort_values(
            by=["prefecture", "municipality", "party", "year"],
            inplace=True,
        )
    )

    summary_df.to_csv(OUTPUT_SUMMARY_CSV, index=False, encoding="utf-8")
    yearly_df.to_csv(OUTPUT_YEARLY_CSV, index=False, encoding="utf-8")
    municipal_df.to_csv(OUTPUT_MUNICIPAL_CSV, index=False, encoding="utf-8")

    term_count = len(data["municipality_breakdown"])
    party_count = len(data["party_summary"])
    year_rows = len(data["rows"])
    print(
        "Generated compensation CSVs: "
        f"{OUTPUT_SUMMARY_CSV.name}, {OUTPUT_YEARLY_CSV.name}, {OUTPUT_MUNICIPAL_CSV.name} "
        f"({year_rows} party-year rows, {party_count} parties, {term_count} municipality records)."
    )


if __name__ == "__main__":
    main()

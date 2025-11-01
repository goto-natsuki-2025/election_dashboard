import gzip
import json
import math
import re
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd

from generate_compensation_data import (
    TERM_YEARS,
    WINNING_KEYWORDS,
    add_years_safe,
    build_party_compensation,
    to_iso_date,
)

ROOT = Path(__file__).resolve().parent

DATA_DIR = ROOT / "data"

ELECTION_SUMMARY_PATH = DATA_DIR / "election_summary.csv"
CANDIDATE_DETAILS_PATH = DATA_DIR / "candidate_details.csv.gz"

CANDIDATE_OUTPUT_PATH = DATA_DIR / "candidate_details.json.gz"
ELECTION_OUTPUT_PATH = DATA_DIR / "election_summary.json.gz"
COMPENSATION_OUTPUT_PATH = DATA_DIR / "compensation.json.gz"
TOP_DASHBOARD_OUTPUT_PATH = DATA_DIR / "top_dashboard.json.gz"

PARTY_FOUNDATION_DATES = {
    "自由民主党": datetime(1955, 11, 15),
    "公明党": datetime(1964, 11, 17),
    "日本共産党": datetime(1922, 7, 15),
    "民主党": datetime(1998, 4, 27),
    "民進党": datetime(2016, 3, 27),
    "立憲民主党": datetime(2017, 10, 3),
    "国民民主党": datetime(2018, 5, 7),
    "社会民主党": datetime(1996, 1, 19),
    "日本維新の会": datetime(2012, 9, 12),
    "大阪維新の会": datetime(2010, 4, 19),
    "希望の党": datetime(2017, 9, 25),
}

SOURCE_PATTERN = re.compile(r"^(.*)_(\d{8})$")


def normalise_string(value: Any) -> str:
    return "" if value is None else str(value).strip()


def ensure_party_name(value: Any) -> str:
    text = normalise_string(value)
    if not text or text == "-" or "無所属" in text:
        return "無所属"
    return text


def parse_date(value: Any) -> Optional[date]:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, date):
        return value
    text = normalise_string(value)
    if not text:
        return None
    parsed = pd.to_datetime(text, errors="coerce", utc=False)
    if pd.isna(parsed):
        return None
    if isinstance(parsed, pd.Timestamp):
        parsed = parsed.to_pydatetime()
    if isinstance(parsed, datetime):
        return parsed.date()
    return None


def parse_yyyymmdd(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        year = int(value[0:4])
        month = int(value[4:6])
        day = int(value[6:8])
        return date(year, month, day)
    except Exception:
        return None


def load_election_summary() -> List[Dict[str, Any]]:
    if not ELECTION_SUMMARY_PATH.exists():
        raise FileNotFoundError(f"{ELECTION_SUMMARY_PATH} was not found")
    df = pd.read_csv(ELECTION_SUMMARY_PATH, dtype=object)
    records: List[Dict[str, Any]] = []
    for row in df.to_dict(orient="records"):
        notice = parse_date(row.get("notice_date"))
        election_day = parse_date(row.get("election_day"))
        seats = row.get("seats")
        candidate_count = row.get("candidate_count")
        registered_voters = row.get("registered_voters")
        record = {
            "election_name": normalise_string(row.get("election_name")),
            "notice_date": notice.isoformat() if notice else None,
            "election_day": election_day.isoformat() if election_day else None,
            "seats": clean_numeric(seats),
            "candidate_count": clean_numeric(candidate_count),
            "registered_voters": clean_numeric(registered_voters),
            "note": normalise_string(row.get("note")),
        }
        records.append(record)
    return records


def build_summary_index(
    elections: Iterable[Dict[str, Any]]
) -> Dict[str, List[Dict[str, Any]]]:
    index: Dict[str, List[Dict[str, Any]]] = {}
    for record in elections:
        key = normalise_string(record.get("election_name"))
        day_text = record.get("election_day")
        if not key or not day_text:
            continue
        election_day = parse_date(day_text)
        if election_day is None:
            continue
        index.setdefault(key, []).append({"election_day": election_day})
    for values in index.values():
        values.sort(key=lambda item: item["election_day"], reverse=True)
    return index


def clean_numeric(value: Any) -> Optional[int]:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = normalise_string(value)
    if not text:
        return None
    try:
        number = float(text.replace(",", ""))
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    if abs(number - round(number)) < 1e-6:
        return int(round(number))
    return int(number)


def load_candidate_details(summary_index: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    if not CANDIDATE_DETAILS_PATH.exists():
        raise FileNotFoundError(f"{CANDIDATE_DETAILS_PATH} was not found")
    df = pd.read_csv(CANDIDATE_DETAILS_PATH, dtype=object)
    records: List[Dict[str, Any]] = []
    for row in df.to_dict(orient="records"):
        raw_source = normalise_string(row.get("source_file"))
        cleaned_source = raw_source[:-5] if raw_source.lower().endswith(".html") else raw_source
        match = SOURCE_PATTERN.match(cleaned_source)
        election_key = normalise_string(match.group(1)) if match else cleaned_source
        election_date_code = match.group(2) if match else None
        election_date = parse_yyyymmdd(election_date_code)
        if election_date is None:
            summary_list = summary_index.get(election_key)
            if summary_list:
                election_date = summary_list[0]["election_day"]

        def as_number(value: Any) -> Optional[int]:
            number = clean_numeric(value)
            return number if number is not None else None

        record = {
            "candidate_id": normalise_string(row.get("candidate_id")),
            "name": normalise_string(row.get("name")),
            "kana": normalise_string(row.get("kana")),
            "age": as_number(row.get("age")),
            "gender": normalise_string(row.get("gender")),
            "incumbent_status": normalise_string(row.get("incumbent_status")),
            "profession": normalise_string(row.get("profession")),
            "party": ensure_party_name(row.get("party")),
            "votes": as_number(row.get("votes")),
            "outcome": normalise_string(row.get("outcome")),
            "image_file": normalise_string(row.get("image_file")),
            "source_file": raw_source,
            "source_key": election_key,
            "source_date_code": election_date_code,
            "election_date": election_date.isoformat() if election_date else None,
        }
        records.append(record)
    return records


def is_winning_outcome(value: Any) -> bool:
    text = normalise_string(value)
    if not text:
        return False
    return any(keyword in text for keyword in WINNING_KEYWORDS)


def parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def build_election_events(candidates: List[Dict[str, Any]]):
    events_map: Dict[str, Dict[str, Any]] = {}
    municipality_set = set()

    for candidate in candidates:
        if not is_winning_outcome(candidate.get("outcome")):
            continue
        election_date = parse_iso_datetime(candidate.get("election_date"))
        if not election_date:
            continue

        municipality_key = normalise_string(candidate.get("source_key"))
        if not municipality_key:
            continue

        municipality_set.add(municipality_key)

        date_code = election_date.strftime("%Y%m%d")
        event_key = f"{municipality_key}|{date_code}"
        event = events_map.get(event_key)
        if event is None:
            event = {
                "key": municipality_key,
                "date": election_date,
                "date_code": date_code,
                "winners": defaultdict(int),
            }
            events_map[event_key] = event

        party = ensure_party_name(candidate.get("party"))
        if party:
            event["winners"][party] += 1

    events = []
    for event in events_map.values():
        if event["winners"]:
            events.append(
                {
                    "key": event["key"],
                    "date": event["date"],
                    "date_code": event["date_code"],
                    "winners": dict(event["winners"]),
                }
            )

    events.sort(key=lambda item: item["date"])
    return events, len(municipality_set)


def build_party_timeline(events: List[Dict[str, Any]], top_n: int = 8, term_years: int = TERM_YEARS):
    if not events:
        return {
            "date_labels": [],
            "series": [],
            "parties": [],
            "totals": {},
            "sparkline_values": {},
            "total_seats": 0,
            "min_date": None,
            "max_date": None,
        }

    foundation_dates: Dict[str, datetime] = dict(PARTY_FOUNDATION_DATES)

    events_by_key: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for event in events:
        events_by_key[event["key"]].append(event)

    timeline_events = []
    for key, entries in events_by_key.items():
        entries.sort(key=lambda item: item["date"])
        for index, event in enumerate(entries):
            term_id = f"{event['key']}-{int(event['date'].timestamp())}"
            timeline_events.append({
                "type": "election",
                "date": event["date"],
                "date_code": event["date_code"],
                "key": event["key"],
                "winners": event["winners"],
                "term_id": term_id,
            })

            next_event = entries[index + 1] if index + 1 < len(entries) else None
            if next_event:
                expiration_dt = max(next_event["date"], event["date"])
            else:
                expiration_date = add_years_safe(event["date"].date(), term_years)
                expiration_dt = datetime(expiration_date.year, expiration_date.month, expiration_date.day)

            timeline_events.append({
                "type": "expiration",
                "date": expiration_dt,
                "date_code": expiration_dt.strftime("%Y%m%d"),
                "key": event["key"],
                "winners": event["winners"],
                "term_id": term_id,
            })

    timeline_events.sort(key=lambda item: (item["date"], 0 if item["type"] == "expiration" else 1))

    change_map: Dict[str, Dict[str, Any]] = {}
    active_terms: Dict[str, Dict[str, Any]] = {}

    def apply_change(date_code: str, dt: datetime, party: str, delta: float):
        foundation = foundation_dates.get(party)
        if foundation and dt < foundation:
            return
        bucket = change_map.get(date_code)
        if bucket is None:
            bucket = {"date": dt, "deltas": defaultdict(float)}
            change_map[date_code] = bucket
        else:
            if dt < bucket["date"]:
                bucket["date"] = dt
        next_value = bucket["deltas"][party] + delta
        if abs(next_value) < 1e-9:
            del bucket["deltas"][party]
        else:
            bucket["deltas"][party] = next_value

    for event in timeline_events:
        if event["type"] == "expiration":
            current = active_terms.get(event["key"])
            if not current or current["term_id"] != event["term_id"]:
                continue
            for party, count in current["seats"].items():
                apply_change(event["date_code"], event["date"], party, -count)
            active_terms.pop(event["key"], None)
            continue

        current = active_terms.get(event["key"])
        if current:
            for party, count in current["seats"].items():
                apply_change(event["date_code"], event["date"], party, -count)

        seats_snapshot = {}
        for party, count in event["winners"].items():
            foundation = foundation_dates.get(party)
            if foundation and event["date"] < foundation:
                continue
            apply_change(event["date_code"], event["date"], party, count)
            seats_snapshot[party] = count

        if seats_snapshot:
            active_terms[event["key"]] = {"term_id": event["term_id"], "seats": seats_snapshot}
        else:
            active_terms.pop(event["key"], None)

    sorted_changes = [bucket for bucket in change_map.values() if bucket["deltas"]]
    sorted_changes.sort(key=lambda bucket: bucket["date"])

    if not sorted_changes:
        return {
            "date_labels": [],
            "series": [],
            "parties": [],
            "totals": {},
            "sparkline_values": {},
            "total_seats": 0,
            "min_date": None,
            "max_date": None,
        }

    now = datetime.now()
    effective_changes = [bucket for bucket in sorted_changes if bucket["date"] <= now]
    if not effective_changes:
        effective_changes = sorted_changes

    parties_set = []
    seen_parties = set()
    for bucket in effective_changes:
        for party in bucket["deltas"].keys():
            if party not in seen_parties:
                seen_parties.add(party)
                parties_set.append(party)

    running_totals: Dict[str, int] = {party: 0 for party in parties_set}
    sparkline_values: Dict[str, List[Optional[int]]] = {party: [] for party in parties_set}

    label_dates: List[datetime] = []
    date_labels: List[str] = []

    for bucket in effective_changes:
        for party, delta in bucket["deltas"].items():
            const_value = running_totals.get(party, 0) + delta
            running_totals[party] = max(int(round(const_value)), 0)
        for party in parties_set:
            sparkline_values[party].append(running_totals.get(party, 0))
        label_dates.append(bucket["date"])
        date_labels.append(bucket["date"].strftime("%Y-%m-%d"))

    for party, values in list(sparkline_values.items()):
        foundation = foundation_dates.get(party)
        if not foundation:
            continue
        for index, dt in enumerate(label_dates):
            if dt < foundation:
                values[index] = None
            else:
                break

    totals: Dict[str, int] = {}
    filtered_sparkline: Dict[str, List[Optional[int]]] = {}
    for party, values in sparkline_values.items():
        last_value = 0
        for value in reversed(values):
            if value is not None:
                last_value = value
                break
        if last_value > 0:
            totals[party] = int(round(last_value))
            filtered_sparkline[party] = [None if value is None else int(round(value)) for value in values]

    parties_ordered = [party for party, _ in sorted(totals.items(), key=lambda item: item[1], reverse=True)]

    limited_parties = parties_ordered[:top_n]
    series = [
        {
            "name": party,
            "type": "line",
            "smooth": True,
            "showSymbol": False,
            "emphasis": {"focus": "series"},
            "data": filtered_sparkline.get(party, []),
        }
        for party in limited_parties
    ]

    total_seats = int(sum(totals.values()))
    min_date = effective_changes[0]["date"].isoformat()
    max_date = effective_changes[-1]["date"].isoformat()

    return {
        "date_labels": date_labels,
        "series": series,
        "parties": parties_ordered,
        "totals": totals,
        "sparkline_values": filtered_sparkline,
        "total_seats": total_seats,
        "min_date": min_date,
        "max_date": max_date,
    }


def build_top_dashboard_payload(candidates: List[Dict[str, Any]]):
    events, municipality_count = build_election_events(candidates)
    timeline = build_party_timeline(events)

    summary = {
        "municipality_count": municipality_count,
        "total_seats": timeline["total_seats"],
        "party_count": len(timeline["parties"]),
        "min_date": timeline["min_date"],
        "max_date": timeline["max_date"],
    }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "timeline": timeline,
    }


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if path.suffix == ".gz":
        with gzip.open(path, "wb") as stream:
            stream.write(data)
    else:
        path.write_bytes(data)


def build_payload(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": 1,
        "records": records,
    }


def main() -> None:
    elections = load_election_summary()
    summary_index = build_summary_index(elections)
    candidates = load_candidate_details(summary_index)
    compensation = build_party_compensation()
    top_dashboard = build_top_dashboard_payload(candidates)

    # clean up compensation date fields to ISO strings for safety
    for row in compensation.get("rows", []):
        row["year"] = int(row["year"]) if row.get("year") is not None else None
        row["seat_count"] = int(row["seat_count"]) if row.get("seat_count") is not None else None
    for row in compensation.get("party_summary", []):
        row["seat_count"] = int(row["seat_count"]) if row.get("seat_count") is not None else None
    for row in compensation.get("municipality_breakdown", []):
        if "term_start" in row:
            row["term_start"] = to_iso_date(row["term_start"])
        if "term_end" in row:
            row["term_end"] = to_iso_date(row["term_end"])
        if "election_date" in row:
            row["election_date"] = to_iso_date(row["election_date"])

    # remove obsolete uncompressed files if any
    for stale in [
        DATA_DIR / "candidate_details.json",
        DATA_DIR / "election_summary.json",
        DATA_DIR / "compensation.json",
    ]:
        if stale.exists():
            stale.unlink()

    write_json(ELECTION_OUTPUT_PATH, build_payload(elections))
    write_json(CANDIDATE_OUTPUT_PATH, build_payload(candidates))
    write_json(COMPENSATION_OUTPUT_PATH, compensation)
    write_json(TOP_DASHBOARD_OUTPUT_PATH, top_dashboard)
    print(
        "Generated dashboard data:",
        ELECTION_OUTPUT_PATH.name,
        CANDIDATE_OUTPUT_PATH.name,
        COMPENSATION_OUTPUT_PATH.name,
        TOP_DASHBOARD_OUTPUT_PATH.name,
    )


if __name__ == "__main__":
    main()

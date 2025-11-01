import gzip
import json
import math
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd

from generate_compensation_data import build_party_compensation, to_iso_date

ROOT = Path(__file__).resolve().parent

DATA_DIR = ROOT / "data"

ELECTION_SUMMARY_PATH = DATA_DIR / "election_summary.csv"
CANDIDATE_DETAILS_PATH = DATA_DIR / "candidate_details.csv.gz"

CANDIDATE_OUTPUT_PATH = DATA_DIR / "candidate_details.json.gz"
ELECTION_OUTPUT_PATH = DATA_DIR / "election_summary.json.gz"
COMPENSATION_OUTPUT_PATH = DATA_DIR / "compensation.json.gz"

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
    print(
        "Generated dashboard data:",
        ELECTION_OUTPUT_PATH.name,
        CANDIDATE_OUTPUT_PATH.name,
        COMPENSATION_OUTPUT_PATH.name,
    )


if __name__ == "__main__":
    main()

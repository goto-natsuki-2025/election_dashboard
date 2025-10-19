import sqlite3
from pathlib import Path
from typing import Union

import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
BASE_DB = DATA_DIR / "election_base.db"
DETAILS_DB = DATA_DIR / "election_details.db"


def _decode_text(value: Union[bytes, bytearray, str]):
    if isinstance(value, (bytes, bytearray)):
        for encoding in ("utf-8", "cp932", "shift_jis"):
            try:
                return value.decode(encoding)
            except UnicodeDecodeError:
                continue
        return value.decode("utf-8", errors="replace")
    return value


def read_table(db_path: Path, query: str) -> pd.DataFrame:
    with sqlite3.connect(db_path) as conn:
        conn.text_factory = bytes
        df = pd.read_sql_query(query, conn)
    for column in df.columns:
        if df[column].dtype == object:
            df[column] = df[column].apply(_decode_text)
    return df


base_df = read_table(BASE_DB, "SELECT * FROM election_data")
base_df = base_df.rename(
    columns={
        base_df.columns[0]: "election_name",
        base_df.columns[1]: "notice_date",
        base_df.columns[2]: "election_day",
        base_df.columns[3]: "seats",
        base_df.columns[4]: "candidate_count",
        base_df.columns[5]: "registered_voters",
        base_df.columns[6]: "note",
    }
)
base_df.to_csv(DATA_DIR / "election_summary.csv", index=False, encoding="utf-8")

detail_df = read_table(DETAILS_DB, "SELECT * FROM links_table")
detail_columns = list(detail_df.columns)
detail_df = detail_df.rename(
    columns={
        detail_columns[0]: "candidate_id",
        detail_columns[1]: "name",
        detail_columns[2]: "kana",
        detail_columns[3]: "age",
        detail_columns[4]: "gender",
        detail_columns[5]: "incumbent_status",
        detail_columns[6]: "profession",
        detail_columns[7]: "party",
        detail_columns[8]: "votes",
        detail_columns[9]: "outcome",
        detail_columns[10]: "image_file",
        detail_columns[11]: "source_file",
    }
)
detail_df.to_csv(
    DATA_DIR / "candidate_details.csv.gz",
    index=False,
    encoding="utf-8",
    compression="gzip",
)

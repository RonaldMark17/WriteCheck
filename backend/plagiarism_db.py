import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

DB_PATH = Path(__file__).resolve().parent / "plagiarism.db"

# Optional Supabase table schema for users who want cloud sync
SUPABASE_MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS "plagiarismScans" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    scan_id TEXT NOT NULL UNIQUE,
    filename TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    total_words INTEGER DEFAULT 0,
    plagiarism_score NUMERIC DEFAULT 0,
    identical_words INTEGER DEFAULT 0,
    result_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);
"""


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initialize the local SQLite database table if not already created."""
    with _get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS plagiarism_scans (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                scan_id TEXT NOT NULL UNIQUE,
                filename TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                total_words INTEGER DEFAULT 0,
                plagiarism_score REAL DEFAULT 0.0,
                identical_words INTEGER DEFAULT 0,
                result_data TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                completed_at TEXT
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_scan_id ON plagiarism_scans(scan_id);
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_user_id ON plagiarism_scans(user_id);
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS submission_grades (
                submission_id TEXT PRIMARY KEY,
                grade TEXT,
                feedback TEXT,
                status TEXT DEFAULT 'graded',
                transcribed_text TEXT,
                scan_result TEXT,
                updated_at TEXT NOT NULL
            )
        """)
        # Auto-migrate existing table if missing new columns
        cursor = conn.execute("PRAGMA table_info(submission_grades)")
        col_names = [row[1] for row in cursor.fetchall()]
        if "transcribed_text" not in col_names:
            conn.execute("ALTER TABLE submission_grades ADD COLUMN transcribed_text TEXT")
        if "scan_result" not in col_names:
            conn.execute("ALTER TABLE submission_grades ADD COLUMN scan_result TEXT")
        conn.commit()


def save_submission_grade(
    submission_id: str,
    grade: str,
    feedback: str = "",
    status: str = "graded",
    transcribed_text: Optional[str] = None,
    scan_result: Optional[Union[Dict[str, Any], str]] = None,
) -> Dict[str, Any]:
    init_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    scan_result_str = (
        json.dumps(scan_result)
        if isinstance(scan_result, dict)
        else scan_result
    )
    with _get_connection() as conn:
        conn.execute(
            """
            INSERT INTO submission_grades (
                submission_id, grade, feedback, status, transcribed_text, scan_result, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(submission_id) DO UPDATE SET
                grade = excluded.grade,
                feedback = excluded.feedback,
                status = excluded.status,
                transcribed_text = COALESCE(excluded.transcribed_text, submission_grades.transcribed_text),
                scan_result = COALESCE(excluded.scan_result, submission_grades.scan_result),
                updated_at = excluded.updated_at
            """,
            (submission_id, str(grade), str(feedback), status, transcribed_text, scan_result_str, now_iso),
        )
        conn.commit()
    return {
        "submission_id": submission_id,
        "grade": grade,
        "feedback": feedback,
        "status": status,
        "transcribed_text": transcribed_text,
        "scan_result": scan_result,
        "updated_at": now_iso,
    }


def save_submission_scan(
    submission_id: str,
    transcribed_text: str = "",
    scan_result: Optional[Union[Dict[str, Any], str]] = None,
) -> Dict[str, Any]:
    init_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    scan_result_str = (
        json.dumps(scan_result)
        if isinstance(scan_result, dict)
        else scan_result
    )
    with _get_connection() as conn:
        conn.execute(
            """
            INSERT INTO submission_grades (
                submission_id, grade, feedback, status, transcribed_text, scan_result, updated_at
            ) VALUES (?, '', '', 'submitted', ?, ?, ?)
            ON CONFLICT(submission_id) DO UPDATE SET
                transcribed_text = COALESCE(excluded.transcribed_text, submission_grades.transcribed_text),
                scan_result = COALESCE(excluded.scan_result, submission_grades.scan_result),
                updated_at = excluded.updated_at
            """,
            (submission_id, transcribed_text, scan_result_str, now_iso),
        )
        conn.commit()
    return {
        "submission_id": submission_id,
        "transcribed_text": transcribed_text,
        "scan_result": scan_result,
        "updated_at": now_iso,
    }


def get_submission_grades() -> Dict[str, Dict[str, Any]]:
    init_db()
    with _get_connection() as conn:
        cursor = conn.execute("SELECT * FROM submission_grades")
        rows = cursor.fetchall()
        result = {}
        for r in rows:
            d = dict(r)
            if d.get("scan_result"):
                try:
                    d["scan_result"] = json.loads(d["scan_result"])
                except Exception:
                    pass
            result[d["submission_id"]] = d
        return result



def create_scan(
    user_id: str,
    scan_id: str,
    filename: Optional[str] = None,
    status: str = "processing",
) -> Dict[str, Any]:
    init_db()
    record_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    with _get_connection() as conn:
        conn.execute(
            """
            INSERT INTO plagiarism_scans (
                id, user_id, scan_id, filename, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (record_id, user_id, scan_id, filename, status, now_iso),
        )
        conn.commit()
    return get_scan(scan_id) or {}


def get_scan(scan_id: str) -> Optional[Dict[str, Any]]:
    init_db()
    with _get_connection() as conn:
        cursor = conn.execute(
            "SELECT * FROM plagiarism_scans WHERE scan_id = ?",
            (scan_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return _format_row(row)


def update_scan_completed(
    scan_id: str,
    total_words: int,
    plagiarism_score: float,
    identical_words: int,
    result_data: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    init_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    result_json = json.dumps(result_data, ensure_ascii=False)
    with _get_connection() as conn:
        conn.execute(
            """
            UPDATE plagiarism_scans
            SET status = 'completed',
                total_words = ?,
                plagiarism_score = ?,
                identical_words = ?,
                result_data = ?,
                completed_at = ?
            WHERE scan_id = ?
            """,
            (
                total_words,
                round(float(plagiarism_score), 2),
                identical_words,
                result_json,
                now_iso,
                scan_id,
            ),
        )
        conn.commit()
    return get_scan(scan_id)


def update_scan_failed(
    scan_id: str,
    error_message: str = "Scan failed",
) -> Optional[Dict[str, Any]]:
    init_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    result_json = json.dumps({"error": error_message}, ensure_ascii=False)
    with _get_connection() as conn:
        conn.execute(
            """
            UPDATE plagiarism_scans
            SET status = 'failed',
                result_data = ?,
                completed_at = ?
            WHERE scan_id = ?
            """,
            (result_json, now_iso, scan_id),
        )
        conn.commit()
    return get_scan(scan_id)


def list_user_scans(user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    init_db()
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT * FROM plagiarism_scans
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        )
        rows = cursor.fetchall()
        return [_format_row(r) for r in rows]


def _format_row(row: sqlite3.Row) -> Dict[str, Any]:
    raw_dict = dict(row)
    try:
        raw_dict["result_data"] = json.loads(raw_dict.get("result_data") or "{}")
    except Exception:
        raw_dict["result_data"] = {}
    return raw_dict


# Auto-initialize table on module import
init_db()

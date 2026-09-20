import base64
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"


def _load_env_file():
    """Load key-value pairs from .env if not already loaded into os.environ."""
    if ENV_FILE.exists():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = val


_load_env_file()

COPYLEAKS_AUTH_URL = "https://id.copyleaks.com/v3/account/login/api"
COPYLEAKS_API_BASE = "https://api.copyleaks.com/v3"


class CopyleaksService:
    def __init__(self):
        self._lock = threading.Lock()
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0.0

    @property
    def email(self) -> str:
        _load_env_file()
        email = os.getenv("COPYLEAKS_EMAIL", "").strip()
        if not email:
            raise ValueError(
                "COPYLEAKS_EMAIL is not set in backend environment variables."
            )
        return email

    @property
    def api_key(self) -> str:
        _load_env_file()
        key = os.getenv("COPYLEAKS_API_KEY", "").strip()
        if not key:
            raise ValueError(
                "COPYLEAKS_API_KEY is not set in backend environment variables."
            )
        return key

    @property
    def is_sandbox(self) -> bool:
        _load_env_file()
        val = os.getenv("COPYLEAKS_SANDBOX", "false").lower().strip()
        return val in ("true", "1", "yes")

    @property
    def webhook_base_url(self) -> str:
        _load_env_file()
        return os.getenv("COPYLEAKS_WEBHOOK_URL", "http://localhost:8000").rstrip("/")

    def get_access_token(self, force_refresh: bool = False) -> str:
        """
        Authenticate with Copyleaks and return a valid Bearer token.
        Caches the token for its 48-hour lifetime and reuses it across requests.
        """
        now = time.time()
        # Return cached token if valid with at least 10 minutes buffer
        if not force_refresh and self._access_token and (now < self._token_expires_at - 600):
            return self._access_token

        with self._lock:
            # Double check after acquiring lock
            now = time.time()
            if not force_refresh and self._access_token and (now < self._token_expires_at - 600):
                return self._access_token

            email = self.email
            key = self.api_key

            print(f"[copyleaks] authenticating account: {email}...", flush=True)
            try:
                response = requests.post(
                    COPYLEAKS_AUTH_URL,
                    json={"email": email, "key": key},
                    headers={"Content-Type": "application/json"},
                    timeout=15,
                )
            except requests.RequestException as exc:
                print(f"[copyleaks] connection error during authentication: {exc}", flush=True)
                raise RuntimeError(
                    "Unable to connect to Copyleaks authentication service."
                )

            if response.status_code != 200:
                print(f"[copyleaks] auth failed with status {response.status_code}: {response.text}", flush=True)
                raise RuntimeError("Failed to authenticate with Copyleaks. Please verify your credentials.")

            data = response.json()
            token = data.get("access_token")
            if not token:
                raise RuntimeError("Copyleaks authentication response did not contain an access_token.")

            # Parse expiration timestamp
            expires_str = data.get(".expires")
            if expires_str:
                try:
                    # Clean ISO format string (e.g. 2026-09-22T12:23:44.1552387Z)
                    clean_expires = re.sub(r"(\.\d{6})\d+Z$", r"\1Z", expires_str)
                    if clean_expires.endswith("Z"):
                        clean_expires = clean_expires[:-1] + "+00:00"
                    expires_dt = datetime.fromisoformat(clean_expires)
                    self._token_expires_at = expires_dt.timestamp()
                except Exception:
                    # Default 48h validity
                    self._token_expires_at = now + (48 * 3600)
            else:
                self._token_expires_at = now + (48 * 3600)

            self._access_token = token
            print(f"[copyleaks] authentication successful. Token valid until: {time.ctime(self._token_expires_at)}", flush=True)
            return self._access_token

    def submit_scan(
        self,
        text: Optional[str] = None,
        file_bytes: Optional[bytes] = None,
        filename: Optional[str] = None,
        user_id: str = "anonymous",
        sandbox: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        Submits text or document bytes to Copyleaks Authenticity API.
        PUT https://api.copyleaks.com/v3/scans/submit/file/{scanId}
        """
        if not text and not file_bytes:
            raise ValueError("Either text or file_bytes must be provided for plagiarism scanning.")

        # Determine payload content & filename
        if file_bytes:
            content_b64 = base64.b64encode(file_bytes).decode("utf-8")
            safe_filename = filename or "document.bin"
        else:
            clean_text = (text or "").strip()
            if not clean_text:
                raise ValueError("Text content cannot be empty.")
            content_b64 = base64.b64encode(clean_text.encode("utf-8")).decode("utf-8")
            safe_filename = filename or "essay.txt"

        # Unique scan ID format: max length is 36 chars in Copyleaks API v3
        scan_id = f"p-{int(time.time())}-{uuid.uuid4().hex[:16]}"

        use_sandbox = self.is_sandbox if sandbox is None else sandbox
        
        # Copyleaks requires a public HTTPS webhook URL (rejects localhost/127.0.0.1)
        base_url = self.webhook_base_url
        if "localhost" in base_url or "127.0.0.1" in base_url or not base_url.startswith("http"):
            # Use public compliant placeholder if no public tunnel/domain is configured yet
            base_url = "https://writecheck-scanner.vercel.app"

        webhook_status_url = f"{base_url}/api/plagiarism/webhook/{{STATUS}}"

        token = self.get_access_token()
        submit_url = f"{COPYLEAKS_API_BASE}/scans/submit/file/{scan_id}"

        payload = {
            "base64": content_b64,
            "filename": safe_filename,
            "properties": {
                "webhooks": {
                    "status": webhook_status_url,
                },
                "sandbox": use_sandbox,
                "developerPayload": user_id,
                "expiration": 480,  # 8 hours retention on Copyleaks
            },
        }

        print(f"[copyleaks] submitting scan: {scan_id} (sandbox={use_sandbox}) to {submit_url}...", flush=True)

        try:
            response = requests.put(
                submit_url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                timeout=30,
            )
        except requests.RequestException as exc:
            print(f"[copyleaks] network error submitting scan {scan_id}: {exc}", flush=True)
            raise RuntimeError("Failed to submit document to Copyleaks scanning service.")

        # If token expired or rejected, retry once with refreshed token
        if response.status_code == 401:
            print("[copyleaks] token expired on submit; refreshing and retrying...", flush=True)
            token = self.get_access_token(force_refresh=True)
            response = requests.put(
                submit_url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                timeout=30,
            )

        if response.status_code == 429:
            print("[copyleaks] rate limit encountered (429)", flush=True)
            raise RuntimeError(
                "Copyleaks API rate limit exceeded. Please wait a moment and try again."
            )

        if response.status_code not in (200, 201):
            print(f"[copyleaks] submit failed status={response.status_code}: {response.text}", flush=True)
            raise RuntimeError(
                "Copyleaks service could not process this document. Please verify the content and format."
            )

        print(f"[copyleaks] scan {scan_id} submitted successfully.", flush=True)
        return {
            "scan_id": scan_id,
            "filename": safe_filename,
            "sandbox": use_sandbox,
            "status": "processing",
        }

    def parse_completed_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parses the Copyleaks 'completed' webhook payload into normalized metrics.
        """
        scanned_doc = payload.get("scannedDocument") or {}
        results = payload.get("results") or {}
        score_obj = results.get("score") or {}

        total_words = int(scanned_doc.get("totalWords") or 0)
        identical_words = int(score_obj.get("identicalWords") or 0)
        minor_words = int(score_obj.get("minorChangesWords") or 0)
        related_words = int(score_obj.get("relatedMeaningWords") or 0)

        # Aggregated score is provided by Copyleaks (0 - 100)
        plagiarism_score = score_obj.get("aggregatedScore")
        if plagiarism_score is None:
            # Fallback calculation if aggregatedScore is not directly present
            plagiarism_score = (
                (identical_words / max(1, total_words)) * 100.0 if total_words > 0 else 0.0
            )
        else:
            plagiarism_score = float(plagiarism_score)

        # Matched internet sources
        internet_matches = results.get("internet") or []
        matched_sources: List[Dict[str, Any]] = []
        for match in internet_matches[:10]:
            matched_sources.append({
                "id": match.get("id"),
                "title": match.get("title") or "Matched source",
                "url": match.get("url") or "",
                "matched_words": match.get("matchedWords") or 0,
                "identical_words": match.get("identicalWords") or 0,
            })

        return {
            "total_words": total_words,
            "identical_words": identical_words,
            "minor_words": minor_words,
            "related_words": related_words,
            "plagiarism_score": round(plagiarism_score, 2),
            "matched_sources": matched_sources,
            "raw_results": results,
        }


copyleaks_service = CopyleaksService()

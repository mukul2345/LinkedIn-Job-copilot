"""JobPilot AI — Job scraper service (Cloud Run).

A thin Flask wrapper around python-jobspy that the `searchJobs` Cloud Function
proxies to. It exposes:

    GET  /health   → { "status": "ok" }
    POST /scrape   → { "ok": true, "data": { "jobs": [...], "failed_boards": [...] } }

Contract (must match functions/search.js + functions/lib/normalization.js):

Request body:
    {
        "query":          str,            # search term (required)
        "boards":         [str],          # subset of SUPPORTED_BOARDS (required)
        "location":       str  | None,    # optional location filter
        "results_wanted": int  | None,    # optional cap per board
        "hours_old":      int  | None      # optional recency filter
    }

Response body (success):
    {
        "ok": true,
        "data": {
            "jobs": [
                {
                    "title":        str,
                    "company":      str,
                    "location":     str,
                    "description":  str | None,
                    "salary":       str | None,
                    "url":          str,
                    "source_board": str,   # read by search.js as rawJob.source_board
                    "posted_date":  str | None  # ISO date; SCRAPER_FIELD_MAP.postedDate
                },
                ...
            ],
            "failed_boards": [ { "board": str, "error": str }, ... ]
        }
    }

Each board is scraped in its own thread with a bounded timeout so one slow or
failing board never blocks the others; failures are reported in `failed_boards`
rather than failing the whole request.
"""

import logging
import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

from flask import Flask, jsonify, request

try:
    # python-jobspy exposes scrape_jobs at the package root.
    from jobspy import scrape_jobs
except ImportError:  # pragma: no cover - only hit if dependency missing
    scrape_jobs = None

app = Flask(__name__)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jobpilot-scraper")

# Boards implemented by the current python-jobspy integration.
SUPPORTED_BOARDS = ["linkedin", "indeed", "glassdoor"]
JOBSPY_BOARDS = set(SUPPORTED_BOARDS)

# Per-board scrape timeout (seconds). Bounded so the Cloud Function's own 50s
# scraper timeout is never the thing that trips first.
PER_BOARD_TIMEOUT_SECONDS = int(os.environ.get("PER_BOARD_TIMEOUT_SECONDS", "30"))

# Default number of results requested per board when the caller doesn't specify.
DEFAULT_RESULTS_WANTED = int(os.environ.get("DEFAULT_RESULTS_WANTED", "25"))


@app.route("/health", methods=["GET"])
def health():
    """Liveness probe for Cloud Run."""
    return jsonify({"status": "ok"}), 200


@app.route("/scrape", methods=["POST"])
def scrape():
    """Scrape the requested boards and return a normalized envelope."""
    if scrape_jobs is None:
        logger.error("python-jobspy is not installed; cannot scrape.")
        return jsonify({"ok": False, "error": "scraper_dependency_missing"}), 503

    payload = request.get_json(silent=True) or {}

    query = (payload.get("query") or "").strip()
    boards = payload.get("boards") or []
    location = (payload.get("location") or "").strip() or None
    job_type = (payload.get("job_type") or "").strip() or None
    results_wanted = _coerce_int(payload.get("results_wanted"), DEFAULT_RESULTS_WANTED)
    hours_old = _coerce_int(payload.get("hours_old"), None)

    # --- Input validation (fail fast) ---
    if not query:
        return jsonify({"ok": False, "error": "query_required"}), 400
    if not isinstance(boards, list) or not boards:
        return jsonify({"ok": False, "error": "boards_required"}), 400

    requested = [b for b in boards if b in SUPPORTED_BOARDS]
    if not requested:
        return jsonify({"ok": False, "error": "no_supported_boards"}), 400

    jobs = []
    failed_boards = []

    # Scrape each board concurrently with an individual timeout.
    with ThreadPoolExecutor(max_workers=len(requested)) as executor:
        future_to_board = {
            executor.submit(
                _scrape_single_board,
                board,
                query,
                location,
                job_type,
                results_wanted,
                hours_old,
            ): board
            for board in requested
        }

        for future, board in ((f, future_to_board[f]) for f in future_to_board):
            try:
                board_jobs = future.result(timeout=PER_BOARD_TIMEOUT_SECONDS)
                jobs.extend(board_jobs)
            except FutureTimeout:
                logger.warning("Board timed out: %s", board)
                failed_boards.append({"board": board, "error": "timeout"})
            except Exception as exc:  # noqa: BLE001 - surface per-board failures
                logger.warning("Board failed: %s (%s)", board, exc)
                failed_boards.append({"board": board, "error": str(exc)})

    return (
        jsonify({"ok": True, "data": {"jobs": jobs, "failed_boards": failed_boards}}),
        200,
    )


def _scrape_single_board(board, query, location, job_type, results_wanted, hours_old):
    """Scrape one board and return a list of normalized job dicts.

    Raises on unsupported boards / scrape errors so the caller records them in
    `failed_boards`.
    """
    if board not in JOBSPY_BOARDS:
        raise ValueError(f"board_not_supported_by_scraper:{board}")

    kwargs = {
        "site_name": [board],
        "search_term": query,
        "results_wanted": results_wanted,
    }
    if location:
        kwargs["location"] = location
    if job_type:
        kwargs["job_type"] = job_type
    if hours_old:
        kwargs["hours_old"] = hours_old

    df = scrape_jobs(**kwargs)
    if df is None or df.empty:
        return []

    return [_normalize_job(row, board) for _, row in df.iterrows()]


def _normalize_job(row, board):
    """Flatten a jobspy DataFrame row into the flat schema the Cloud Function
    reads (see SCRAPER_FIELD_MAP in functions/lib/normalization.js)."""
    return {
        "title": _clean(row.get("title")),
        "company": _clean(row.get("company")),
        "location": _clean(row.get("location")),
        "description": _clean(row.get("description")) or None,
        "salary": _format_salary(row),
        "url": _clean(row.get("job_url")),
        "source_board": board,
        "posted_date": _clean(row.get("date_posted")) or None,
    }


def _format_salary(row):
    """Build a human-readable salary string from jobspy min/max fields."""
    min_amount = row.get("min_amount")
    max_amount = row.get("max_amount")
    currency = _clean(row.get("currency"))

    if min_amount and max_amount:
        return f"{currency} {min_amount}-{max_amount}".strip()
    if min_amount:
        return f"{currency} {min_amount}".strip()
    if max_amount:
        return f"{currency} {max_amount}".strip()
    return None


def _clean(value):
    """Coerce a possibly-NaN/None value into a trimmed string ('' if absent)."""
    if value is None:
        return ""
    # pandas NaN is a float that is not equal to itself.
    if isinstance(value, float) and value != value:
        return ""
    return str(value).strip()


def _coerce_int(value, default):
    """Best-effort int coercion; returns default on failure."""
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


if __name__ == "__main__":
    # Local development entrypoint. Cloud Run uses gunicorn (see Dockerfile).
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)

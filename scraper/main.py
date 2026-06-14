"""
Python Scraping Service for JobPilot Enhanced Features.

Flask API wrapping python-jobspy for multi-board job scraping.
Runs on Cloud Run (port 8080) or locally for development.
"""

import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# Boards natively supported by python-jobspy
SUPPORTED_BOARDS = {"linkedin", "indeed", "glassdoor", "adzuna"}

# Boards listed in requirements but not supported by python-jobspy
UNSUPPORTED_BOARDS = {"naukri", "uplers"}

# All recognized board names
ALL_BOARDS = SUPPORTED_BOARDS | UNSUPPORTED_BOARDS

PER_BOARD_TIMEOUT = 30  # seconds
MAX_WORKERS = 6


def scrape_single_board(board, query, location, job_type, results_wanted, hours_old):
    """
    Scrape a single board using python-jobspy.

    Args:
        board: Board name (e.g., "linkedin", "indeed")
        query: Search query string
        location: Location filter
        job_type: Job type filter (fulltime, parttime, contract, internship)
        results_wanted: Number of results to fetch per board
        hours_old: Only return jobs posted within this many hours

    Returns:
        List of job dicts from the board.

    Raises:
        Exception: If scraping fails for any reason.
    """
    from jobspy import scrape_jobs

    kwargs = {
        "site_name": [board],
        "search_term": query,
        "results_wanted": results_wanted,
    }

    if location:
        kwargs["location"] = location

    if hours_old:
        kwargs["hours_old"] = hours_old

    if job_type:
        # python-jobspy expects: fulltime, parttime, contract, internship
        type_map = {
            "full-time": "fulltime",
            "fulltime": "fulltime",
            "part-time": "parttime",
            "parttime": "parttime",
            "contract": "contract",
            "internship": "internship",
        }
        mapped_type = type_map.get(job_type.lower())
        if mapped_type:
            kwargs["job_type"] = mapped_type

    df = scrape_jobs(**kwargs)

    if df is None or df.empty:
        return []

    # Convert DataFrame to list of dicts, replacing NaN with None
    jobs = df.where(df.notnull(), None).to_dict(orient="records")

    # Normalize each job record
    normalized = []
    for job in jobs:
        normalized.append(_normalize_job(job, board))

    return normalized


def _normalize_job(raw_job, board):
    """
    Normalize a raw job dict from python-jobspy into a consistent format.

    Args:
        raw_job: Raw dict from pandas DataFrame row
        board: Source board name

    Returns:
        Normalized job dict with consistent keys.
    """
    def safe_str(val):
        if val is None:
            return None
        return str(val).strip() if str(val).strip() else None

    def safe_date(val):
        if val is None:
            return None
        if hasattr(val, "isoformat"):
            return val.isoformat()
        try:
            return str(val)
        except (ValueError, TypeError):
            return None

    return {
        "title": safe_str(raw_job.get("title")),
        "company": safe_str(raw_job.get("company_name") or raw_job.get("company")),
        "location": safe_str(raw_job.get("location")),
        "description": safe_str(raw_job.get("description")),
        "salary": safe_str(
            raw_job.get("min_amount") and f"{raw_job.get('min_amount')}-{raw_job.get('max_amount')}"
            if raw_job.get("min_amount")
            else raw_job.get("salary")
        ),
        "url": safe_str(raw_job.get("job_url") or raw_job.get("link")),
        "source_board": board,
        "posted_date": safe_date(raw_job.get("date_posted")),
        "job_type": safe_str(raw_job.get("job_type")),
    }


@app.route("/scrape", methods=["POST"])
def scrape_jobs_endpoint():
    """
    POST /scrape - Scrape jobs from multiple boards concurrently.

    Request Body:
    {
        "query": "Backend Developer",
        "boards": ["linkedin", "indeed", "glassdoor", "naukri", "uplers", "adzuna"],
        "location": "India",
        "job_type": "full-time",
        "results_wanted": 100,
        "hours_old": 168
    }

    Response:
    {
        "jobs": [...],
        "failed_boards": [{"board": "glassdoor", "error": "timeout"}],
        "metadata": {"total": 85, "boards_succeeded": 5, "boards_failed": 1}
    }
    """
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))

    data = request.get_json(silent=True)
    if not data:
        return jsonify({
            "ok": False,
            "error": {"code": "INVALID_REQUEST", "message": "Request body must be valid JSON."},
            "meta": {"requestId": request_id},
        }), 400

    query = data.get("query", "").strip()
    boards = data.get("boards", [])
    location = data.get("location")
    job_type = data.get("job_type")
    results_wanted = data.get("results_wanted", 20)
    hours_old = data.get("hours_old")

    # Validate required fields
    if not query:
        return jsonify({
            "ok": False,
            "error": {"code": "INVALID_REQUEST", "message": "Query is required."},
            "meta": {"requestId": request_id},
        }), 400

    if not boards or not isinstance(boards, list):
        return jsonify({
            "ok": False,
            "error": {"code": "INVALID_REQUEST", "message": "At least one board must be specified."},
            "meta": {"requestId": request_id},
        }), 400

    # Validate board names
    invalid_boards = [b for b in boards if b.lower() not in ALL_BOARDS]
    if invalid_boards:
        return jsonify({
            "ok": False,
            "error": {
                "code": "INVALID_REQUEST",
                "message": f"Unrecognized boards: {', '.join(invalid_boards)}. Supported: {', '.join(sorted(ALL_BOARDS))}",
            },
            "meta": {"requestId": request_id},
        }), 400

    logger.info(
        "Scrape request received",
        extra={"request_id": request_id, "query": query, "boards": boards},
    )

    all_jobs = []
    failed_boards = []

    # Immediately mark unsupported boards as failed
    requested_supported = []
    for board in boards:
        board_lower = board.lower()
        if board_lower in UNSUPPORTED_BOARDS:
            failed_boards.append({
                "board": board_lower,
                "error": "Board not supported by scraper",
            })
        else:
            requested_supported.append(board_lower)

    # Scrape supported boards concurrently with per-board timeout
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_board = {}
        for board in requested_supported:
            future = executor.submit(
                scrape_single_board,
                board,
                query,
                location,
                job_type,
                results_wanted,
                hours_old,
            )
            future_to_board[future] = board

        for future in future_to_board:
            board = future_to_board[future]
            try:
                jobs = future.result(timeout=PER_BOARD_TIMEOUT)
                all_jobs.extend(jobs)
                logger.info(f"Board '{board}' returned {len(jobs)} results", extra={"request_id": request_id})
            except FuturesTimeoutError:
                failed_boards.append({"board": board, "error": "timeout"})
                logger.warning(f"Board '{board}' timed out after {PER_BOARD_TIMEOUT}s", extra={"request_id": request_id})
            except Exception as e:
                failed_boards.append({"board": board, "error": str(e)})
                logger.error(f"Board '{board}' failed: {e}", extra={"request_id": request_id})

    boards_succeeded = len(requested_supported) - len([
        fb for fb in failed_boards if fb["board"] in requested_supported
    ])

    response = {
        "ok": True,
        "data": {
            "jobs": all_jobs,
            "failed_boards": failed_boards,
            "metadata": {
                "total": len(all_jobs),
                "boards_succeeded": boards_succeeded,
                "boards_failed": len(failed_boards),
            },
        },
        "meta": {"requestId": request_id},
    }

    logger.info(
        f"Scrape completed: {len(all_jobs)} jobs, {len(failed_boards)} failed boards",
        extra={"request_id": request_id},
    )

    return jsonify(response), 200


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for Cloud Run."""
    return jsonify({"status": "healthy", "timestamp": datetime.utcnow().isoformat()}), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)

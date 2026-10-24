# JobPilot Scraper Service

A small Flask + [python-jobspy](https://pypi.org/project/python-jobspy/) service
that scrapes job boards. The `searchJobs` Cloud Function proxies user searches to
this service; it is **not** called directly by the extension.

## Why this exists

The extension's multi-board search shows **"Job search service is temporarily
down."** whenever the Cloud Function cannot reach this scraper. That happens when:

1. This service is not deployed, or
2. `SCRAPER_SERVICE_URL` in `functions/.env` is unset (it then defaults to
   `http://localhost:8080`, which Cloud Functions cannot reach), or
3. The Cloud Function's service account lacks `run.invoker` on this service.

Deploying this service and wiring the URL fixes the error.

## Endpoints

| Method | Path      | Purpose                        |
|--------|-----------|--------------------------------|
| GET    | `/health` | Liveness probe                 |
| POST   | `/scrape` | Scrape boards, return jobs     |

### `POST /scrape`

Request:

```json
{
  "query": "software developer",
  "boards": ["linkedin", "indeed", "glassdoor"],
  "location": "Bangalore",
  "results_wanted": 25,
  "hours_old": 168
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "jobs": [
      {
        "title": "Software Developer",
        "company": "Acme",
        "location": "Bangalore",
        "description": "…",
        "salary": "INR 100000-200000",
        "url": "https://…",
        "source_board": "indeed",
        "posted_date": "2026-08-20"
      }
    ],
    "failed_boards": [{ "board": "glassdoor", "error": "timeout" }]
  }
}
```

This shape matches `parseScraperPayload` and `normalizeJobRecord` in
`functions/`. Do not change the `data.jobs` / `data.failed_boards` keys or the
per-job field names without updating those files.

> Boards natively supported by python-jobspy: `linkedin`, `indeed`, `glassdoor`.
> `naukri`, `uplers`, and `adzuna` are accepted by the API but reported under
> `failed_boards` until dedicated scrapers are added — so the UI degrades
> gracefully instead of erroring.

## Run locally

```bash
cd scraper
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py                       # serves on :8080

curl localhost:8080/health
curl -s -H 'Content-Type: application/json' \
     -d '{"query":"software developer","boards":["indeed"]}' \
     localhost:8080/scrape | head -c 500
```

## Deploy to Cloud Run

```bash
cd scraper
PROJECT_ID=<your-project> ./deploy.sh
```

Then set the printed URL in `functions/.env`:

```
SCRAPER_SERVICE_URL=https://jobpilot-scraper-xxxxx-uc.a.run.app
```

and redeploy the functions:

```bash
firebase deploy --only functions
```

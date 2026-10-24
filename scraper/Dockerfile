# JobPilot AI scraper — Cloud Run container
FROM python:3.11-slim

# Avoid Python buffering so logs stream to Cloud Logging in real time.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Cloud Run provides $PORT (defaults to 8080). Timeout is generous because
# multi-board scrapes can be slow; the app itself bounds each board.
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 120 app:app"]

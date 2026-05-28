FROM python:3.12-slim

WORKDIR /app

# Dependencies first (better build cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY backend/ ./backend/
COPY static/ ./static/

EXPOSE 8723

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8723/api/health', timeout=4)" || exit 1

CMD ["python", "backend/app.py"]

# Axus Hub — build context is the repo root (so we can COPY libs/auth).
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY libs/auth /libs/auth
COPY axus-hub/hub/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir /libs/auth

COPY axus-hub/hub/backend ./backend
COPY axus-hub/hub/frontend ./frontend

WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

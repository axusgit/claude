# Axus Support — build context is the repo root (so we can COPY libs/auth).
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

# Shared central-identity library + app dependencies
COPY libs/auth /libs/auth
COPY axus-hub/support/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir /libs/auth

# App code + frontend (main.py expects ../frontend)
COPY axus-hub/support/backend ./backend
COPY axus-hub/support/frontend ./frontend

WORKDIR /app/backend
EXPOSE 8000
# Apply migrations, then serve.
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"]

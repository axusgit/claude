# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Axus RMM is a lightweight remote monitoring and management tool for Axus Technologies clients. It is similar in concept to TeamViewer or ConnectWise but simpler — focused on visibility (system metrics, online/offline status) and basic remote management (remote shell, file transfer).

## Architecture

Three components, each in its own subdirectory:

```
agent/    — Python agent installed on client machines
server/   — FastAPI backend; agents connect here, dashboard reads from here
dashboard/ — Browser-based UI for viewing and managing endpoints
```

**Data flow:**
1. Agent runs on a client machine, collects system info (CPU, RAM, disk, OS), and connects to the server via WebSocket.
2. Server authenticates the agent, stores metrics in a database, and forwards remote commands.
3. Dashboard polls the server REST API to display connected machines and their status; sends commands through the server to agents.

## Stack

- **Python 3.11+** throughout
- **FastAPI** + **Uvicorn** for the server
- **psutil** for system metrics in the agent
- **websockets** for persistent agent-to-server connection
- **SQLite** (via SQLAlchemy) for the server database — swap to PostgreSQL for production
- **HTML/CSS/JS** (no framework) for the dashboard

## Setup

### Server
```bash
cd server
python -m venv venv
venv\Scripts\activate       # Windows
pip install -r requirements.txt
uvicorn main:app --reload
```

### Agent
```bash
cd agent
python -m venv venv
venv\Scripts\activate       # Windows
pip install -r requirements.txt
python agent.py --server ws://localhost:8000
```

### Dashboard
Open `dashboard/index.html` in a browser while the server is running.

## Key Files

- `server/main.py` — FastAPI app, REST endpoints, WebSocket handler
- `server/models.py` — SQLAlchemy models (Machine, Metric, User)
- `agent/agent.py` — entry point; connects to server, streams metrics, handles commands
- `agent/collector.py` — psutil wrappers for CPU, RAM, disk, network stats
- `dashboard/index.html` — single-page dashboard
- `dashboard/static/app.js` — dashboard logic (fetch + WebSocket)

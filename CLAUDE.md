# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the Axus Technologies monorepo for internal tooling projects built with Claude Code. Each top-level folder is a self-contained project with its own README and dependencies.

## Projects

| Folder | Description |
|--------|-------------|
| `Axus RMM/` | Remote monitoring and management tool — see its own CLAUDE.md |
| `Axus Hub/` | Clients, tickets, time tracking, and invoicing — FastAPI backend with JWT auth. See its README. |

## Conventions

- Each project lives in its own top-level directory and is independently runnable.
- Python projects use a virtual environment (`venv/`) local to the project folder — never install packages globally.
- Each project has its own `requirements.txt` and `README.md`.

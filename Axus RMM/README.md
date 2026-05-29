# Axus RMM

A lightweight remote monitoring and management tool for Axus Technologies clients.

## Components

- **Agent** — installed on client machines; reports metrics and accepts remote commands
- **Server** — central backend that agents connect to; exposes API for the dashboard
- **Dashboard** — web UI for viewing connected machines and their status

## Quick Start

See [CLAUDE.md](CLAUDE.md) for full setup instructions.

## Requirements

- Python 3.11+
- Windows or Linux on agent machines
- Network access between agents and the server

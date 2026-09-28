"""Entry point for running the Axus Subcontractor Management backend.

Host and port are read from the environment so the same command works locally
and on a server:

    HOST   network interface to bind (default 0.0.0.0)
    PORT   TCP port to listen on (default 8000)
    RELOAD set to any value to enable auto-reload during development

Run with:  python run.py
"""
import os
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=bool(os.getenv("RELOAD")),
    )

"""Entry point for running the Axus Hub backend.

Host and port are read from the environment so the same command works locally
and on a server (e.g. AWS, where the open port may not be 8000):

    HOST   network interface to bind (default 0.0.0.0 so it is reachable
           externally; use 127.0.0.1 to restrict to local only)
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

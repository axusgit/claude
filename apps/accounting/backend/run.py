"""Run Axus Accounting. HOST/PORT/RELOAD from the environment."""
import os
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8002")),
        reload=bool(os.getenv("RELOAD")),
    )

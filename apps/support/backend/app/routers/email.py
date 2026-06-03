import os
from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app import graph, email_intake

router = APIRouter(prefix="/api/email", tags=["email"])


@router.get("/status")
def status(_=Depends(get_current_user)):
    return {
        "configured": graph.is_configured(),
        "mailbox": graph.MAILBOX,
        "poll_seconds": int(os.getenv("EMAIL_POLL_SECONDS", "60")),
    }


@router.post("/poll")
def poll(_=Depends(get_current_user)):
    """Manually trigger one inbox poll (useful for testing)."""
    return email_intake.process_inbox()

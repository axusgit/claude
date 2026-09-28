"""Staff-only AI assist (OpenAI ChatGPT).

Two actions, both staff-gated and both returning a DRAFT for the staff member to review
and edit — nothing is ever sent to a customer automatically:
  * POST /api/ai/rewrite  — polish/rewrite the staff member's draft text.
  * POST /api/ai/suggest  — read the whole ticket (title, description, conversation) and
                            draft a suggested reply.

Disabled gracefully (503) when OPENAI_API_KEY is absent. Length-capped + timed out.
"""
import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.ticket import Ticket, TicketComment
from app.models.user import User, UserRole
from app.auth import require_staff

router = APIRouter(prefix="/api/ai", tags=["ai"])

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

_REWRITE_SYSTEM = (
    "You are an IT support specialist at Axus Technologies writing to a customer. "
    "Rewrite the message below to be clear, professional, warm, and concise. Preserve every "
    "technical fact, number, name, and instruction exactly — never invent or change details. "
    "Fix grammar and tone. Do NOT add a greeting or a sign-off (those are added automatically). "
    "Return ONLY the rewritten message, nothing else."
)
_SUGGEST_SYSTEM = (
    "You are an IT support specialist at Axus Technologies. Read the ticket below (subject, "
    "description, and the full conversation) and draft the next reply to the customer. Be clear, "
    "professional, warm, and concise; address their latest message; suggest concrete next steps. "
    "Only use information present in the ticket — never invent facts, names, or commitments. If key "
    "information is missing, politely ask for it. Do NOT add a greeting or a sign-off. Return ONLY the "
    "suggested reply."
)


def _chat(system: str, user: str, max_tokens: int = 700) -> str:
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="AI is not configured yet.")
    try:
        r = httpx.post(
            OPENAI_URL,
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": AI_MODEL,
                "temperature": 0.4,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
            timeout=45,
        )
        r.raise_for_status()
        return (r.json()["choices"][0]["message"]["content"] or "").strip()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        detail = "AI request was rejected."
        try:
            detail = e.response.json().get("error", {}).get("message", detail)
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=f"AI error: {detail}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")


class RewriteIn(BaseModel):
    text: str


@router.post("/rewrite")
def rewrite(data: RewriteIn, _: User = Depends(require_staff)):
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to rewrite — type a draft first.")
    return {"result": _chat(_REWRITE_SYSTEM, text[:6000])}


class SuggestIn(BaseModel):
    ticket_id: int


@router.post("/suggest")
def suggest(data: SuggestIn, db: Session = Depends(get_db), _: User = Depends(require_staff)):
    t = db.query(Ticket).filter(Ticket.id == data.ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    comments = (db.query(TicketComment)
                .filter(TicketComment.ticket_id == t.id, TicketComment.is_internal == False)  # noqa: E712
                .order_by(TicketComment.created_at).all())
    # label each message by whether the author is Axus staff or the customer
    role_by_id = {u.id: u.role for u in db.query(User).all()}
    lines = []
    for c in comments:
        role = role_by_id.get(c.author_id)
        rv = role.value if hasattr(role, "value") else role
        who = "Axus" if rv in ("admin", "technician") else "Customer"
        lines.append(f"{who}: {(c.body or '').strip()}")
    convo = "\n\n".join(lines) if lines else "(no replies yet)"
    context = (f"Subject: {t.title}\n"
               f"Description:\n{(t.description or '(none)').strip()}\n\n"
               f"Conversation so far:\n{convo}")
    return {"result": _chat(_SUGGEST_SYSTEM, context[:12000])}

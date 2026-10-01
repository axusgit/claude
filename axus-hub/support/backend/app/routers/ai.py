"""Staff-only AI assist (OpenAI ChatGPT).

Two actions, both staff-gated and both returning a DRAFT for the staff member to review
and edit — nothing is ever sent to a customer automatically:
  * POST /api/ai/rewrite  — polish/rewrite the staff member's draft text.
  * POST /api/ai/suggest  — read the whole ticket (title, description, conversation) and
                            draft a suggested reply.

Disabled gracefully (503) when OPENAI_API_KEY is absent. Length-capped + timed out.
"""
import os
import re
import json
import httpx
from typing import List, Optional
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

# NOTE: the app already appends a greeting ("Hi <name>,") and a sign-off
# ("Thank you for choosing our services. / Axus Service Team"), so the AI must NOT add
# any greeting, sign-off, or thanks/gratitude of its own.
_NO_FLUFF = (
    "Do NOT add a greeting, a sign-off, your name, or ANY thanks/gratitude (no 'Thank you', "
    "'Thanks for', 'Thanks!', 'We appreciate', 'Thank you for your patience', etc.) — those are "
    "added automatically elsewhere. Start straight with the substance."
)
_REWRITE_SYSTEM = (
    "You are an IT support specialist at Axus Technologies writing to a customer. "
    "Rewrite the message below into clear, polished, professional customer-facing prose. "
    "Actively improve it: tighten wordy or awkward phrasing, improve flow and structure, "
    "fix grammar and punctuation, and make the tone warm but professional — do this even when "
    "the original is already grammatically correct (always produce a genuinely improved version, "
    "never echo the input unchanged). Preserve every technical fact, number, name, date, and "
    "instruction exactly — never invent, add, or change details. "
    + _NO_FLUFF + " Return ONLY the rewritten message, nothing else."
)
_SUGGEST_SYSTEM = (
    "You are an IT support specialist at Axus Technologies. Read the ticket below (subject, "
    "description, and the full conversation) and draft the next reply to the customer. Be clear, "
    "professional, and concise; address their latest message; suggest concrete next steps. "
    "Only use information present in the ticket — never invent facts, names, or commitments. If key "
    "information is missing, ask for it directly. " + _NO_FLUFF + " Return ONLY the suggested reply."
)


def _chat_raw(messages: list, max_tokens: int = 700, temperature: float = 0.4) -> str:
    """Call the chat API with a prepared messages list (incl. the system message)."""
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="AI is not configured yet.")
    try:
        r = httpx.post(
            OPENAI_URL,
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": AI_MODEL,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "messages": messages,
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


def _chat(system: str, user: str, max_tokens: int = 700, temperature: float = 0.4) -> str:
    return _chat_raw(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=max_tokens, temperature=temperature,
    )


_TICKET_SYSTEM = (
    "You are an IT support specialist at Axus Technologies documenting a support ticket. "
    "From the description below, produce BOTH: (1) a concise Subject line — at most ~9 words, no "
    "trailing period, specific (name the key device, service, or error when present); and (2) a clear, "
    "professional, concise rewrite of the description. Preserve every technical fact, number, name, date, "
    "and instruction exactly — never invent details. " + _NO_FLUFF + " "
    'Return ONLY a JSON object of the form {"subject": "...", "description": "..."} with no other text.'
)


def _parse_ticket_json(raw: str, fallback_desc: str):
    """Pull {subject, description} out of the model's reply; fall back gracefully."""
    m = re.search(r"\{.*\}", raw or "", re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(0))
            subject = str(obj.get("subject") or "").strip()
            desc = str(obj.get("description") or "").strip() or fallback_desc
            return subject, desc
        except Exception:
            pass
    return "", (raw or "").strip() or fallback_desc


class RewriteIn(BaseModel):
    text: str
    context: Optional[str] = None   # e.g. the ticket subject — reference only, never rewritten/echoed
    want_subject: bool = False      # also generate a Subject line (New Ticket description rewrite)


@router.post("/rewrite")
def rewrite(data: RewriteIn, _: User = Depends(require_staff)):
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to rewrite — type a draft first.")
    if data.want_subject:
        raw = _chat(_TICKET_SYSTEM, text[:6000], temperature=0.5)
        subject, desc = _parse_ticket_json(raw, fallback_desc=text)
        return {"result": desc, "subject": subject}
    ctx = (data.context or "").strip()
    user_msg = text[:6000]
    if ctx:
        user_msg = (f"For reference only — the ticket subject is: {ctx[:300]}\n"
                    f"(Do NOT include the subject in your output; rewrite only the message below.)\n\n"
                    f"Message to rewrite:\n{text[:6000]}")
    return {"result": _chat(_REWRITE_SYSTEM, user_msg, temperature=0.6)}


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


# --- Conversational "Ask AI Assistant" for the New Ticket description ------------
# A back-and-forth chat that helps a staff member write a clear ticket description:
# they can ask how to phrase it, what to include, or have it draft one. The staff
# member accepts the result, which drops into the description box. Staff-gated.
_ASK_SYSTEM = (
    "You are an AI writing assistant helping an Axus Technologies IT support technician write a "
    "clear, professional support-ticket DESCRIPTION. Answer their questions about how to phrase, "
    "structure, or improve the write-up, and when they ask, produce a clean, ready-to-paste "
    "description. A good description is factual and concise and covers: what the issue is, the "
    "affected device/service/user, when it started, any error messages, and steps already tried. "
    "Only use information the technician gives you — never invent specifics; if something important "
    "is missing, point out what to add. When you hand over a description they can use, return just "
    "the description text itself with no preamble like 'Here is' and no quotation marks. " + _NO_FLUFF
)


class AskMsg(BaseModel):
    role: str          # "user" (the staff member) or "assistant" (the AI)
    content: str


class AskIn(BaseModel):
    messages: List[AskMsg]
    description: Optional[str] = None   # the current draft in the box, for context


@router.post("/ask")
def ask(data: AskIn, _: User = Depends(require_staff)):
    msgs = [{"role": "system", "content": _ASK_SYSTEM}]
    draft = (data.description or "").strip()
    if draft:
        msgs.append({"role": "system",
                     "content": "The technician's current draft description is:\n" + draft[:4000]})
    for m in (data.messages or [])[-12:]:
        content = (m.content or "").strip()
        if not content:
            continue
        role = "assistant" if m.role == "assistant" else "user"
        msgs.append({"role": role, "content": content[:4000]})
    if not any(m["role"] == "user" for m in msgs):
        raise HTTPException(status_code=400, detail="Ask a question first.")
    return {"result": _chat_raw(msgs, max_tokens=800, temperature=0.5)}

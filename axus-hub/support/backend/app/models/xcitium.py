"""Read-only mirror of the legacy Xcitium (Comodo) Service Desk.

These tables are a one-way import from Xcitium's `clientapi` (see app/xcitium.py):
they are deliberately isolated from the native tickets/clients/users tables so the
mirror can be re-run or wiped without any risk to live Support data. When Axus
decides to cut over, rows here can be promoted into the native tables.

Nothing in the app writes back to Xcitium.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Index
from sqlalchemy.sql import func
from app.database import Base


class XcitiumCustomer(Base):
    """A Xcitium organization (organizationName) — maps to a native Client later."""
    __tablename__ = "xcitium_customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    first_seen = Column(DateTime(timezone=True), server_default=func.now())
    last_synced_at = Column(DateTime(timezone=True), server_default=func.now())


class XcitiumUser(Base):
    """A Xcitium end user (the ticket's `user` object) — maps to a native User later."""
    __tablename__ = "xcitium_users"

    id = Column(Integer, primary_key=True, index=True)
    external_id = Column(String, unique=True, index=True, nullable=False)  # Xcitium user id
    name = Column(String, nullable=True)
    email = Column(String, index=True, nullable=True)
    organization_name = Column(String, index=True, nullable=True)
    last_synced_at = Column(DateTime(timezone=True), server_default=func.now())


class XcitiumTicket(Base):
    """A mirrored ticket. Full source payload kept in `raw_json` for fidelity."""
    __tablename__ = "xcitium_tickets"

    id = Column(Integer, primary_key=True, index=True)
    external_id = Column(Integer, unique=True, index=True, nullable=False)  # Xcitium ticketId
    subject = Column(String, nullable=True)
    status = Column(String, index=True, nullable=True)      # raw Xcitium status (e.g. open/closed)
    priority = Column(String, nullable=True)
    department = Column(String, index=True, nullable=True)
    category = Column(String, nullable=True)
    asset = Column(String, nullable=True)
    device_name = Column(String, nullable=True)
    assignee = Column(String, nullable=True)

    # denormalized reporter/org for easy listing without joins
    username = Column(String, nullable=True)
    user_external_id = Column(String, index=True, nullable=True)
    user_email = Column(String, nullable=True)
    organization_name = Column(String, index=True, nullable=True)

    create_date = Column(DateTime(timezone=True), nullable=True)
    update_date = Column(DateTime(timezone=True), nullable=True)
    last_message = Column(DateTime(timezone=True), nullable=True)
    last_response = Column(DateTime(timezone=True), nullable=True)
    last_resolution = Column(String, nullable=True)

    thread_count = Column(Integer, default=0)
    raw_json = Column(Text, nullable=True)     # complete viewticket payload
    synced_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class XcitiumThread(Base):
    """One message within a mirrored ticket's conversation."""
    __tablename__ = "xcitium_threads"

    id = Column(Integer, primary_key=True, index=True)
    ticket_external_id = Column(Integer, index=True, nullable=False)
    seq = Column(Integer, nullable=False)          # order within the ticket
    created = Column(DateTime(timezone=True), nullable=True)
    poster = Column(String, nullable=True)
    title = Column(String, nullable=True)
    body = Column(Text, nullable=True)             # HTML body as provided by Xcitium


Index("ix_xcitium_threads_ticket_seq", XcitiumThread.ticket_external_id, XcitiumThread.seq)


class XcitiumSyncState(Base):
    """Single-row bookkeeping for the importer (id is always 1)."""
    __tablename__ = "xcitium_sync_state"

    id = Column(Integer, primary_key=True)
    max_ticket_id = Column(Integer, default=0)         # highest id known to exist
    high_water_id = Column(Integer, default=0)         # highest id we've imported through
    tickets_total = Column(Integer, default=0)
    running = Column(Boolean, default=False)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_run_status = Column(String, nullable=True)
    last_full_backfill_at = Column(DateTime(timezone=True), nullable=True)


class XcitiumHealth(Base):
    """Single-row health state for the Xcitium clientapi (id is always 1).

    The Xcitium (Comodo) hosted backend fails often -- its app periodically can't
    reach its own MySQL host and returns an HTML PDOException instead of JSON. This
    row lets the background monitor (app/xcitium_health.py) persist the last observed
    state across restarts so it emails on state *transitions* only (up<->down), never
    on every check and never twice for the same outage.
    """
    __tablename__ = "xcitium_health"

    id = Column(Integer, primary_key=True)
    state = Column(String, nullable=True)              # 'up' | 'down' | None (never checked)
    since = Column(DateTime(timezone=True), nullable=True)          # when the current state began
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(String, nullable=True)         # short reason while down
    consecutive_fails = Column(Integer, default=0)     # debounce before declaring DOWN

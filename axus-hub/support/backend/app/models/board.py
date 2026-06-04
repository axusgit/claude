from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base


DEFAULT_BOARD_NAME = "Support"
PROJECT_BOARD_NAME = "Projects"


class Board(Base):
    """A service board / queue tickets are organized into (Support, Projects,
    Accounting, Talent, …)."""
    __tablename__ = "boards"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


def default_board_id(db):
    """Id of the default board new tickets land on (the Support board)."""
    b = db.query(Board).filter(Board.name == DEFAULT_BOARD_NAME).first()
    return b.id if b else None


def project_board_id(db):
    """Id of the Projects board (where converted projects/SOW work lands)."""
    b = db.query(Board).filter(Board.name == PROJECT_BOARD_NAME).first()
    return b.id if b else None

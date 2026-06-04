from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel

from app.database import get_db
from app.models.board import Board
from app.models.ticket import Ticket
from app.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/boards", tags=["boards"])


class BoardIn(BaseModel):
    name: str
    description: Optional[str] = None


class BoardOut(BaseModel):
    id: int
    name: str
    description: Optional[str]

    class Config:
        from_attributes = True


@router.get("/", response_model=List[BoardOut])
def list_boards(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Board).order_by(Board.name).all()


@router.post("/", response_model=BoardOut)
def create_board(data: BoardIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(Board).filter(Board.name == data.name).first():
        raise HTTPException(status_code=400, detail="A board with that name already exists")
    board = Board(**data.model_dump())
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


@router.put("/{board_id}", response_model=BoardOut)
def update_board(board_id: int, data: BoardIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    board = db.query(Board).filter(Board.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    for key, value in data.model_dump().items():
        setattr(board, key, value)
    db.commit()
    db.refresh(board)
    return board


@router.delete("/{board_id}")
def delete_board(board_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    board = db.query(Board).filter(Board.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    # Unassign tickets from the board rather than orphan them.
    db.query(Ticket).filter(Ticket.board_id == board_id).update({Ticket.board_id: None})
    db.delete(board)
    db.commit()
    return {"status": "deleted", "id": board_id}

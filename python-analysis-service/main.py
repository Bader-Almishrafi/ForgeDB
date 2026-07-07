"""Entry point used by Uvicorn to load the FastAPI application.

This thin file keeps the command `uvicorn main:app --reload` compatible with
the app factory located in `app/main.py`.
"""

from app.main import app


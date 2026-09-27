"""Every error leaves the API as {"error": {"code", "message"}} (CLAUDE.md §6.5).
Messages are plain English the UI can show as-is: what failed and what to do next."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError as PostgrestError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("khata")


class AppError(Exception):
    """`extra` adds fields next to code and message, e.g. the id of the party a name clashes with."""
    def __init__(self, status: int, code: str, message: str, extra: dict | None = None):
        self.status, self.code, self.message, self.extra = status, code, message, extra or {}


def _body(code: str, message: str, extra: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, **(extra or {})}}


PG_ERRORS = {
    "22P02": (422, "invalid_request", "One of the values isn't in the right format. Check it and try again."),
    "22007": (422, "bad_date", "Enter the date like 2026-09-26."),
    "22008": (422, "bad_date", "Enter the date like 2026-09-26."),
    "23503": (422, "invalid_reference", "That customer, supplier or bill doesn't exist."),
    "23505": (409, "already_exists", "That already exists."),
    "23514": (422, "invalid_request", "Those values aren't allowed together. Check them and try again."),
    "42501": (403, "forbidden", "You can only change your own shop's book."),
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        return JSONResponse(_body(exc.code, exc.message, exc.extra), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
        return JSONResponse(_body("invalid_request", f"Check the {field} field and try again."),
                            status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        if exc.status_code == 404:
            return JSONResponse(_body("not_found", "That page or item does not exist."), 404)
        if exc.status_code == 405:
            return JSONResponse(_body("method_not_allowed", "That action is not supported here."), 405)
        return JSONResponse(_body("http_error", str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(PostgrestError)
    async def db_error(_: Request, exc: PostgrestError):
        # Input checks should catch these first; this keeps any that slip through plain-English.
        status, code, message = PG_ERRORS.get(exc.code or "", (None, None, None))
        if status is None:
            log.error("database error %s", exc.code)
            status, code, message = 500, "server_error", "Something went wrong on our side. Try again."
        return JSONResponse(_body(code, message), status_code=status)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")  # stack trace to logs; never secrets in the message
        return JSONResponse(_body("server_error", "Something went wrong on our side. Try again."),
                            status_code=500)


class CatchAllErrors:
    """Pure ASGI middleware, installed INSIDE CORSMiddleware. Starlette sends unhandled exceptions
    to ServerErrorMiddleware, which sits outside every user middleware, so its 500 would carry no
    CORS headers; the browser then reports a network failure and the app would show "No internet"
    for what is really a server bug. Catching here keeps the {"error": ...} body and CORS."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def tracked(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracked)
        except Exception:
            log.exception("unhandled error")  # stack trace to logs; never secrets in the message
            if started:
                raise
            response = JSONResponse(_body("server_error", "Something went wrong on our side. Try again."),
                                    status_code=500)
            await response(scope, receive, send)

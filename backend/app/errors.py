"""Every error leaves the API as {"error": {"code", "message"}} (CLAUDE.md §6.5).
Messages are plain English the UI can show as-is: what failed and what to do next."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("khata")


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def _body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        return JSONResponse(_body(exc.code, exc.message), status_code=exc.status)

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

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")  # stack trace to logs; never secrets in the message
        return JSONResponse(_body("server_error", "Something went wrong on our side. Try again."),
                            status_code=500)

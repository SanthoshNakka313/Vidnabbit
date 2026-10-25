"""Contract-shaped API errors.

Every error leaving the API has the shape
``{"error": {"code": "<code>", "message": "<human readable>"}}``.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    INVALID_URL = "invalid_url"
    UNSUPPORTED_SITE = "unsupported_site"
    DRM_PROTECTED = "drm_protected"
    LOGIN_REQUIRED = "login_required"
    PRIVATE_CONTENT = "private_content"
    BLOCKED_BY_RIGHTS_HOLDER = "blocked_by_rights_holder"
    LIVE_NOT_SUPPORTED = "live_not_supported"
    TOO_LONG = "too_long"
    TOO_LARGE = "too_large"
    RATE_LIMITED = "rate_limited"
    CHALLENGE_REQUIRED = "challenge_required"
    UPSTREAM_ERROR = "upstream_error"
    NOT_FOUND = "not_found"
    INTERNAL = "internal"
    # Not in the v1 contract list: malformed request bodies that are not about a URL
    # (missing takedown field, wrong Content-Type, oversized body). Proposed addition.
    INVALID_REQUEST = "invalid_request"


HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.INVALID_URL: 400,
    ErrorCode.INVALID_REQUEST: 400,
    ErrorCode.UNSUPPORTED_SITE: 422,
    ErrorCode.DRM_PROTECTED: 422,
    ErrorCode.LOGIN_REQUIRED: 422,
    ErrorCode.PRIVATE_CONTENT: 422,
    ErrorCode.LIVE_NOT_SUPPORTED: 422,
    ErrorCode.TOO_LONG: 422,
    ErrorCode.TOO_LARGE: 422,
    ErrorCode.BLOCKED_BY_RIGHTS_HOLDER: 451,
    ErrorCode.CHALLENGE_REQUIRED: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.UPSTREAM_ERROR: 502,
    ErrorCode.INTERNAL: 500,
}

DEFAULT_MESSAGES: dict[ErrorCode, str] = {
    ErrorCode.INVALID_URL: "That doesn't look like a public http(s) link we can fetch.",
    ErrorCode.INVALID_REQUEST: "The request was malformed.",
    ErrorCode.UNSUPPORTED_SITE: "We couldn't find downloadable media at that link.",
    ErrorCode.DRM_PROTECTED: "This content is DRM-protected, so we can't download it.",
    ErrorCode.LOGIN_REQUIRED: (
        "This content needs a login or subscription, so we can't download it."
    ),
    ErrorCode.PRIVATE_CONTENT: "This content is private, so we can't download it.",
    ErrorCode.BLOCKED_BY_RIGHTS_HOLDER: (
        "This content has been removed at the rights holder's request."
    ),
    ErrorCode.LIVE_NOT_SUPPORTED: "Live streams and premieres aren't supported.",
    ErrorCode.TOO_LONG: "This media is longer than the maximum we support.",
    ErrorCode.TOO_LARGE: "This file is larger than the maximum we support.",
    ErrorCode.RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
    ErrorCode.CHALLENGE_REQUIRED: "Please complete the verification challenge and try again.",
    ErrorCode.UPSTREAM_ERROR: "The source site returned an error. Please try again later.",
    ErrorCode.NOT_FOUND: "Not found.",
    ErrorCode.INTERNAL: "Something went wrong on our side.",
}


class ApiError(Exception):
    """An error that maps directly to a contract error response."""

    def __init__(
        self,
        code: ErrorCode,
        message: str | None = None,
        *,
        status: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.code = code
        self.message = message or DEFAULT_MESSAGES[code]
        self.status = status or HTTP_STATUS[code]
        self.headers = headers or {}
        super().__init__(f"{code}: {self.message}")

    def to_dict(self) -> dict[str, Any]:
        return {"code": str(self.code), "message": self.message}

    def body(self) -> dict[str, Any]:
        return {"error": self.to_dict()}

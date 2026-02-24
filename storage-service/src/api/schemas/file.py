"""
Pydantic request/response schemas for file operations.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class FileUploadResponse(BaseModel):
    """Returned after a successful file upload."""
    id: str
    key: str
    bucket: str
    backend: str
    content_type: str
    size_bytes: int
    original_filename: Optional[str] = None
    etag: Optional[str] = None
    created_at: datetime
    metadata: dict = Field(default_factory=dict)

    model_config = {"from_attributes": True}


class FileInfoResponse(FileUploadResponse):
    """Extended file information including update timestamp."""
    updated_at: datetime


class FileListResponse(BaseModel):
    """Paginated list of stored files."""
    items: list[FileUploadResponse]
    count: int
    next_token: Optional[str] = None
    prefix: str = ""


class PresignedDownloadResponse(BaseModel):
    """Presigned download URL."""
    key: str
    url: str
    expires_in: int


class PresignedUploadRequest(BaseModel):
    """Request body for generating a presigned upload URL."""
    filename: str = Field(..., min_length=1, max_length=512)
    content_type: str = Field(..., min_length=3, max_length=128)
    prefix: str = Field(default="", max_length=256)
    expires_in: Optional[int] = Field(default=None, ge=60, le=604800)

    @field_validator("content_type")
    @classmethod
    def validate_content_type(cls, v: str) -> str:
        if "/" not in v:
            raise ValueError("content_type must be a valid MIME type (e.g. image/jpeg)")
        return v


class PresignedUploadResponse(BaseModel):
    """Presigned upload URL and fields."""
    key: str
    url: str
    fields: dict = Field(default_factory=dict)
    method: str = "POST"
    expires_in: int


class DeleteResponse(BaseModel):
    """Confirmation of object deletion."""
    key: str
    deleted: bool = True

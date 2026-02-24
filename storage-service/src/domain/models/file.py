"""
Domain model representing a stored file object.
Framework-agnostic plain Python dataclass.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import uuid4


@dataclass
class StoredFile:
    """Represents a file persisted in a storage backend."""

    key: str                          # Storage key (path within bucket)
    bucket: str                       # Bucket / container name
    backend: str                      # "s3" | "gcs" | "minio"
    content_type: str                 # MIME type
    size_bytes: int                   # File size in bytes
    id: str = field(default_factory=lambda: str(uuid4()))
    original_filename: Optional[str] = None
    etag: Optional[str] = None        # MD5 / ETag from storage backend
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    metadata: dict = field(default_factory=dict)

    @property
    def extension(self) -> str:
        """Return the file extension, including the dot."""
        parts = self.key.rsplit(".", 1)
        return f".{parts[1].lower()}" if len(parts) == 2 else ""

    @property
    def is_image(self) -> bool:
        return self.content_type.startswith("image/")

    @property
    def is_video(self) -> bool:
        return self.content_type.startswith("video/")

    @property
    def is_audio(self) -> bool:
        return self.content_type.startswith("audio/")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "key": self.key,
            "bucket": self.bucket,
            "backend": self.backend,
            "content_type": self.content_type,
            "size_bytes": self.size_bytes,
            "original_filename": self.original_filename,
            "etag": self.etag,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "metadata": self.metadata,
        }

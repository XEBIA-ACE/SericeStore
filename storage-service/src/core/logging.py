"""
Structured logging configuration.

Uses structlog for JSON-formatted, context-aware log output that plays well
with log aggregation pipelines (Datadog, CloudWatch, GCP Logging, etc.).
"""

import logging
import sys
from typing import Any

import structlog
from structlog.types import EventDict, WrappedLogger


def _drop_color_message_key(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    """Remove the 'color_message' key injected by uvicorn."""
    event_dict.pop("color_message", None)
    return event_dict


def configure_logging(log_level: str = "INFO", log_format: str = "json") -> None:
    """
    Set up structlog with stdlib integration.

    Args:
        log_level: Standard Python log-level name (e.g. "INFO").
        log_format: "json" for machine-readable output; "text" for human-readable.
    """
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        _drop_color_message_key,
    ]

    if log_format == "json":
        renderer = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=shared_processors
        + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(log_level)

    # Quiet noisy third-party loggers
    for noisy in ("boto3", "botocore", "urllib3", "google.auth", "PIL"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a structlog logger bound to *name*."""
    return structlog.get_logger(name)

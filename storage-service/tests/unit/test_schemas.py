"""Unit tests for Pydantic request/response schemas."""

import pytest
from pydantic import ValidationError

from src.models.schemas import (
    ImageResizeRequest,
    PresignRequest,
    VideoTranscodeRequest,
)


class TestImageResizeRequest:
    def test_valid(self):
        r = ImageResizeRequest(width=800, height=600, output_format="jpeg")
        assert r.width == 800
        assert r.output_format == "jpeg"

    def test_invalid_format(self):
        with pytest.raises(ValidationError):
            ImageResizeRequest(width=100, height=100, output_format="heic")

    def test_width_too_large(self):
        with pytest.raises(ValidationError):
            ImageResizeRequest(width=99999, height=100)

    def test_zero_dimension(self):
        with pytest.raises(ValidationError):
            ImageResizeRequest(width=0, height=100)


class TestPresignRequest:
    def test_defaults(self):
        r = PresignRequest()
        assert r.expires_in == 3600
        assert r.method == "GET"

    def test_valid_put(self):
        r = PresignRequest(method="put")
        assert r.method == "PUT"

    def test_invalid_method(self):
        with pytest.raises(ValidationError):
            PresignRequest(method="DELETE")

    def test_expires_below_minimum(self):
        with pytest.raises(ValidationError):
            PresignRequest(expires_in=10)

    def test_expires_above_maximum(self):
        with pytest.raises(ValidationError):
            PresignRequest(expires_in=999999)


class TestVideoTranscodeRequest:
    def test_defaults(self):
        r = VideoTranscodeRequest()
        assert r.output_format == "mp4"
        assert r.crf == 23

    def test_invalid_format(self):
        with pytest.raises(ValidationError):
            VideoTranscodeRequest(output_format="rm")

    def test_invalid_crf(self):
        with pytest.raises(ValidationError):
            VideoTranscodeRequest(crf=100)

    def test_invalid_preset(self):
        with pytest.raises(ValidationError):
            VideoTranscodeRequest(preset="lightning")

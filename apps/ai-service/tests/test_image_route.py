"""POST /internal/v1/image-search: credential first, one image part, bounded size, real decoder, fake index."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from tempfile import SpooledTemporaryFile

import anyio
import pytest
from fastapi.testclient import TestClient
from starlette.requests import ClientDisconnect, Request
from starlette.types import Message

from app.api.routes.image_search import _MemoryImageParser, _read_single_image
from app.core.errors import ValidationFailedError
from app.models.registry import ModelRegistry
from tests.conftest import QA_KEY, auth_headers, make_settings
from tests.fakes import CountingLoader, FakeEncoder, FakeGateway, ranked
from tests.imagefactory import animated_webp, jpeg_bytes, padded_image_bytes, png_bytes, png_with_claimed_size

URL = "/internal/v1/image-search"
Factory = Callable[..., TestClient]


def ready_registry(gateway: FakeGateway | None = None) -> ModelRegistry:
    return ModelRegistry(
        image_encoder_loader=CountingLoader(FakeEncoder()),
        vector_gateway=gateway or FakeGateway(results=ranked(0.9, 0.5)),
    )


def upload(data: bytes, content_type: str = "image/png", name: str = "image") -> dict[str, tuple[str, bytes, str]]:
    return {name: ("upload.bin", data, content_type)}


def test_single_image_part_returns_version_stamped_matches(client_factory: Factory) -> None:
    gateway = FakeGateway(results=ranked(0.9, 0.5))
    client = client_factory(registry=ready_registry(gateway))
    response = client.post(f"{URL}?topK=2", files=upload(png_bytes(64, 48)), headers=auth_headers())
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert [m["rank"] for m in data["matches"]] == [1, 2]
    assert data["modelVersion"] == "test-model-1" and data["embeddingVersion"] == "test-emb-1"
    assert gateway.queried_with and gateway.queried_with[0].embedding_version == "test-emb-1"


def test_declared_mime_type_is_ignored_in_favour_of_magic_bytes(client_factory: Factory) -> None:
    client = client_factory(registry=ready_registry())
    spoofed = client.post(URL, files=upload(jpeg_bytes(48, 48), "image/png"), headers=auth_headers())
    assert spoofed.status_code == 200


def test_text_labelled_as_an_image_is_unsupported(client_factory: Factory) -> None:
    client = client_factory(registry=ready_registry())
    response = client.post(URL, files=upload(b"<svg onload=alert(1)>", "image/jpeg"), headers=auth_headers())
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "AI_UNSUPPORTED_MEDIA_TYPE"
    assert "svg" not in response.text


def test_animated_webp_is_refused(client_factory: Factory) -> None:
    client = client_factory(registry=ready_registry())
    response = client.post(URL, files=upload(animated_webp(40, 40), "image/webp"), headers=auth_headers())
    assert response.status_code == 415


def test_decompression_bomb_is_413(client_factory: Factory) -> None:
    client = client_factory(registry=ready_registry())
    response = client.post(URL, files=upload(png_with_claimed_size(10_000, 10_000)), headers=auth_headers())
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "AI_IMAGE_TOO_LARGE"


@pytest.mark.parametrize(
    "files",
    [
        {"photo": ("a.png", png_bytes(40, 40), "image/png")},  # wrong field name
        {"image": ("a.png", png_bytes(40, 40), "image/png"), "extra": ("b.png", png_bytes(40, 40), "image/png")},
    ],
    ids=["wrong-name", "extra-file"],
)
def test_wrong_or_extra_files_are_422(client_factory: Factory, files: dict[str, tuple[str, bytes, str]]) -> None:
    client = client_factory(registry=ready_registry())
    response = client.post(URL, files=files, headers=auth_headers())
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "AI_VALIDATION_FAILED"


def test_extra_text_field_is_422(client_factory: Factory) -> None:
    client = client_factory(registry=ready_registry())
    response = client.post(URL, files=upload(png_bytes(40, 40)), data={"note": "hi"}, headers=auth_headers())
    assert response.status_code == 422


def test_missing_file_is_422(client_factory: Factory) -> None:
    client = client_factory(registry=ready_registry())
    response = client.post(URL, data={"note": "only text"}, headers=auth_headers())
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "AI_VALIDATION_FAILED"


def test_empty_image_part_is_422(client_factory: Factory) -> None:
    client = client_factory(registry=ready_registry())
    response = client.post(URL, files=upload(b""), headers=auth_headers())
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "AI_INVALID_IMAGE"


def test_file_one_byte_over_the_configured_limit_is_413(client_factory: Factory) -> None:
    client = client_factory(make_settings(AI_MAX_IMAGE_BYTES=65_536), registry=ready_registry())
    response = client.post(URL, files=upload(b"\xff\xd8\xff" + b"\x00" * 65_534), headers=auth_headers())  # 65_537 B
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "AI_IMAGE_TOO_LARGE"


def test_body_over_the_route_ceiling_is_413_before_parsing(client_factory: Factory) -> None:
    client = client_factory(make_settings(AI_MAX_IMAGE_BYTES=65_536), registry=ready_registry())
    response = client.post(URL, files=upload(b"\xff\xd8\xff" + b"\x00" * 150_000), headers=auth_headers())
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "AI_PAYLOAD_TOO_LARGE"


def test_other_routes_keep_the_one_megabyte_ceiling(client_factory: Factory) -> None:
    client = client_factory(make_settings(AI_MAX_IMAGE_BYTES=8_388_608), registry=ready_registry())
    response = client.post(
        "/internal/v1/recommendations",
        content=b"{" + b" " * (1_048_576 + 10) + b"}",
        headers={**auth_headers(), "Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_missing_credential_is_401_even_with_a_huge_body(client: TestClient) -> None:
    response = client.post(URL, content=b"x" * (3 * 1024 * 1024), headers={"Content-Type": "image/png"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AI_UNAUTHORIZED"


def test_wrong_environment_is_403_before_the_body_is_read(client: TestClient) -> None:
    response = client.post(
        URL,
        content=b"x" * (3 * 1024 * 1024),
        headers={**auth_headers(environment="production"), "Content-Type": "image/png"},
    )
    assert response.status_code == 403


def test_wrong_key_is_401(client: TestClient) -> None:
    response = client.post(URL, files=upload(png_bytes(40, 40)), headers=auth_headers(key=QA_KEY))
    assert response.status_code == 401


def test_index_not_ready_is_503_and_the_body_is_not_read(client_factory: Factory) -> None:
    client = client_factory(registry=ready_registry(FakeGateway(ready=False)))
    response = client.post(URL, content=b"not multipart at all", headers=auth_headers())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_INDEX_NOT_READY"


def test_no_model_is_503_model_not_ready(client_factory: Factory) -> None:
    client = client_factory(registry=ModelRegistry(vector_gateway=FakeGateway()))
    response = client.post(URL, files=upload(png_bytes(40, 40)), headers=auth_headers())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_MODEL_NOT_READY"


def test_top_k_above_the_configured_cap_is_422(client_factory: Factory) -> None:
    client = client_factory(make_settings(AI_MAX_TOP_K=5), registry=ready_registry())
    response = client.post(f"{URL}?topK=6", files=upload(png_bytes(40, 40)), headers=auth_headers())
    assert response.status_code == 422


def test_capabilities_expose_versions_once_a_model_is_loaded(client_factory: Factory) -> None:
    client = client_factory(registry=ready_registry())
    image = client.get("/internal/v1/capabilities", headers=auth_headers()).json()["data"]["imageSearch"]
    assert image["modelVersion"] == "test-model-1"
    assert image["embeddingVersion"] == "test-emb-1"
    assert "path" not in str(image).lower()


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
@pytest.mark.parametrize("size", [2 * 1024 * 1024, 8 * 1024 * 1024 - 1024])
def test_large_valid_uploads_never_spool_to_disk(
    client_factory: Factory, monkeypatch: pytest.MonkeyPatch, fmt: str, size: int
) -> None:
    def forbidden_rollover(self: object) -> None:
        raise AssertionError("customer uploads must not create a disk temporary file")

    monkeypatch.setattr(SpooledTemporaryFile, "rollover", forbidden_rollover)
    data = padded_image_bytes(fmt, size)
    assert len(data) == size
    response = client_factory(registry=ready_registry()).post(URL, files=upload(data), headers=auth_headers())
    assert response.status_code == 200, response.text


def test_truncated_multipart_is_rejected(client_factory: Factory) -> None:
    payload = b'--part\r\nContent-Disposition: form-data; name="image"; filename="x.png"\r\n\r\n' + png_bytes(64, 48)
    response = client_factory(registry=ready_registry()).post(
        URL, content=payload, headers={**auth_headers(), "Content-Type": "multipart/form-data; boundary=part"}
    )
    assert response.status_code == 422


@pytest.mark.parametrize("termination", ["complete", "malformed", "disconnect", "cancel"])
def test_memory_handles_are_closed_on_every_parser_exit(monkeypatch: pytest.MonkeyPatch, termination: str) -> None:
    observed: list[bool] = []
    close = _MemoryImageParser.close

    def observe_close(parser: _MemoryImageParser) -> None:
        close(parser)
        observed.extend(handle.closed for handle in parser._files_to_close_on_error)

    monkeypatch.setattr(_MemoryImageParser, "close", observe_close)
    data = padded_image_bytes("PNG", 2 * 1024 * 1024)
    body = b'--part\r\nContent-Disposition: form-data; name="image"; filename="x.png"\r\n\r\n' + data
    if termination == "complete":
        body += b"\r\n--part--\r\n"
    reads = 0

    async def receive() -> Message:
        nonlocal reads
        reads += 1
        if reads == 1:
            return {"type": "http.request", "body": body, "more_body": termination in ("disconnect", "cancel")}
        if termination == "cancel":
            raise asyncio.CancelledError()
        return {"type": "http.disconnect"}

    async def run() -> None:
        request = Request(
            {"type": "http", "headers": [(b"content-type", b"multipart/form-data; boundary=part")]},
            receive,
        )
        await _read_single_image(request, 8 * 1024 * 1024)

    failure = {"malformed": ValidationFailedError, "disconnect": ClientDisconnect, "cancel": asyncio.CancelledError}
    if termination in failure:
        with pytest.raises(failure[termination]):
            anyio.run(run)
    else:
        anyio.run(run)
    assert observed and all(observed)

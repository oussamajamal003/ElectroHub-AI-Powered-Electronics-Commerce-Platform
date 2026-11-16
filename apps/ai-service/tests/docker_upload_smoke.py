"""Run inside the built runtime with --read-only, tests/model mounted :ro, and the QA reader only.

This is real HTTP -> decoder -> trained encoder -> pgvector, not a replacement model/index. No photographs or
credentials are printed or written. The runtime image does not contain this test; mount tests read-only to run it.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from tests.imagefactory import padded_image_bytes

BASE = f"http://127.0.0.1:{os.environ['AI_PORT']}"
KEY = os.environ["AI_SERVICE_API_KEY"]
SHM_DIR = "/dev/shm"  # noqa: S108 - bounded Docker tmpfs used by this read-only runtime
AUTH = {"X-ElectroHub-AI-Key": KEY, "X-ElectroHub-AI-Environment": "qa", "X-Request-Id": "docker-upload-closure"}


def call(path: str, body: bytes | None = None, *, authenticate: bool = True) -> tuple[int, object]:
    headers = dict(AUTH) if authenticate else {}
    if body is not None:
        headers["Content-Type"] = "multipart/form-data; boundary=closure"
    request = urllib.request.Request(BASE + path, data=body, headers=headers)  # noqa: S310 -- fixed loopback test server.
    try:
        with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 -- fixed loopback test server.
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def multipart(data: bytes, *, name: str = "image", finish: bool = True) -> bytes:
    return (
        (
            f'--closure\r\nContent-Disposition: form-data; name="{name}"; filename="not-logged.bin"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode()
        + data
        + (b"\r\n--closure--\r\n" if finish else b"")
    )


def main() -> None:
    uid = os.stat("/proc/self").st_uid
    assert uid != 0, "the smoke must use the non-root runtime user"
    assert tempfile.gettempdir() == SHM_DIR, "read-only runtime must use Docker's bounded shared-memory temp directory"
    for protected in ("/srv/ai-service", "/srv/ai-models"):
        probe = os.path.join(protected, ".task-04.2-write-probe")
        try:
            with open(probe, "wb") as stream:
                stream.write(b"probe")
        except OSError:
            continue
        os.unlink(probe)
        raise AssertionError("runtime unexpectedly wrote to a protected read-only path")
    process = subprocess.Popen(
        [sys.executable, "-m", "app"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    checked = 0
    try:
        for _ in range(100):
            try:
                if call("/health")[0] == 200:
                    break
            except OSError:
                time.sleep(0.2)
        else:
            raise AssertionError("runtime did not start")
        status, ready = call("/internal/v1/ready")
        assert status == 200 and isinstance(ready, dict) and ready["data"]["features"]["imageSearch"]["available"]
        # Ignore any runtime/library startup state; compare only the upload request lifecycle.
        shm_before = set(os.listdir(SHM_DIR))
        for fmt in ("JPEG", "PNG", "WEBP"):
            for size in (2 * 1024 * 1024, 8 * 1024 * 1024 - 1024):
                status, result = call("/internal/v1/image-search", multipart(padded_image_bytes(fmt, size)))
                assert status == 200 and isinstance(result, dict) and result["data"]["matches"], (fmt, size, status)
                checked += 1
                print(json.dumps({"check": "valid-upload", "format": fmt, "bytes": size, "status": status}))
        invalid = [
            (multipart(padded_image_bytes("PNG", 8 * 1024 * 1024 + 2)), 413),
            (multipart(b"not an image"), 415),
            (multipart(padded_image_bytes("PNG", 4096), name="wrong"), 422),
            (multipart(padded_image_bytes("PNG", 4096), finish=False), 422),
            (
                multipart(padded_image_bytes("PNG", 4096)).replace(
                    b"--closure--", b'--closure\r\nContent-Disposition: form-data; name="extra"\r\n\r\nx\r\n--closure--'
                ),
                422,
            ),
        ]
        for body, expected in invalid:
            status, _ = call("/internal/v1/image-search", body)
            assert status == expected, (expected, status)
            checked += 1
        assert call("/internal/v1/ready", authenticate=False)[0] == 401
        checked += 1
        assert set(os.listdir(SHM_DIR)) == shm_before, "multipart handling left temporary files behind"
        checked += 1
    finally:
        process.terminate()
        logs, _ = process.communicate(timeout=20)
        assert KEY not in logs and os.environ["AI_VECTOR_DATABASE_URL"] not in logs and "not-logged.bin" not in logs
        # Keep startup diagnostics useful without ever echoing configuration or request material.
        diagnostic_markers = (
            "configurationerror",
            "modulenotfounderror",
            "permissionerror",
            "operationalerror",
            "certificate verify failed",
            "traceback",
            "error:",
        )
        for line in logs.splitlines():
            if any(marker in line.lower() for marker in diagnostic_markers):
                safe = line.replace(KEY, "[redacted]").replace(os.environ["AI_VECTOR_DATABASE_URL"], "[redacted]")
                if "not-logged.bin" not in safe and len(safe) <= 240:
                    print(json.dumps({"check": "runtime-diagnostic", "line": safe[:240]}))
        assert "Traceback" not in logs, "unexpected runtime error"
    print(json.dumps({"checks": checked, "result": "PASS", "uid": uid, "filesystem": "read-only"}))


if __name__ == "__main__":
    main()

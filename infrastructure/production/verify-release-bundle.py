"""Host-side verifier for an offline exact-SHA Docker release bundle."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


IMAGE_NAMES = {"backend", "ai-service", "edge"}
AI_PRODUCTION_RELEASE_MANIFEST = "AI_PRODUCTION_RELEASE.json"
AI_MODEL_MANIFEST = "AI_MODEL_ARTIFACT_PRODUCTION.json"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def verify(manifest_path: Path, expected_sha: str, bundle_dir: Path, *, verify_loaded_images: bool = True) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", expected_sha):
        raise ValueError("expected release SHA is not a full lowercase Git SHA")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or manifest.get("releaseSha") != expected_sha:
        raise ValueError("release manifest SHA does not match the approved exact SHA")
    if (
        not isinstance(manifest.get("images"), list)
        or len(manifest["images"]) != len(IMAGE_NAMES)
        or {item.get("name") for item in manifest["images"] if isinstance(item, dict)} != IMAGE_NAMES
    ):
        raise ValueError("release manifest image list is incomplete or has duplicates")
    for field in ("sourceArchive", "imageArchive", "aiProductionRelease", "aiModelManifest"):
        record = manifest.get(field)
        if not isinstance(record, dict):
            raise ValueError(f"release manifest is missing {field}")
        filename, expected_digest = record.get("file"), record.get("sha256")
        if not isinstance(filename, str) or Path(filename).name != filename or not re.fullmatch(r"[a-f0-9]{64}", str(expected_digest)):
            raise ValueError(f"release manifest has an unsafe {field} path or digest")
        if field == "aiProductionRelease" and filename != AI_PRODUCTION_RELEASE_MANIFEST:
            raise ValueError("release manifest production AI release path is not recognized")
        if field == "aiModelManifest" and filename != AI_MODEL_MANIFEST:
            raise ValueError("release manifest production model artifact path is not recognized")
        file = bundle_dir / filename
        if not file.is_file() or digest(file) != expected_digest:
            raise ValueError(f"release bundle checksum mismatch: {filename}")
    for image in manifest["images"]:
        name = image.get("name")
        reference = f"electrohub/{name}:{expected_sha}"
        if name not in IMAGE_NAMES or image.get("reference") != reference:
            raise ValueError("release image reference does not match the exact SHA")
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", str(image.get("configDigest", ""))):
            raise ValueError("release image config digest is invalid")
        if not verify_loaded_images:
            continue
        loaded = subprocess.run(
            ["docker", "image", "inspect", "--format", "{{.Id}}", reference],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if loaded != image["configDigest"]:
            raise ValueError(f"loaded release image differs from the manifest: {name}")


if __name__ == "__main__":
    preload_only = len(sys.argv) == 5 and sys.argv[1] == "--preload"
    if preload_only:
        _, _, manifest_path, expected_sha, bundle_dir = sys.argv
    elif len(sys.argv) == 4:
        _, manifest_path, expected_sha, bundle_dir = sys.argv
    else:
        print(
            "Usage: verify-release-bundle.py [--preload] <manifest.json> <approved-full-sha> <bundle-directory>",
            file=sys.stderr,
        )
        raise SystemExit(64)
    try:
        verify(Path(manifest_path), expected_sha, Path(bundle_dir), verify_loaded_images=not preload_only)
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
        print(f"Release bundle verification failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
    print("Release bundle file checksums verified before image load." if preload_only
          else "Release bundle checksum and loaded image identities verified.")

"""Create and optionally upload an approved, private AI artifact release archive."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
import tarfile
import urllib.error
import urllib.request
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_verifier():
    spec = importlib.util.spec_from_file_location(
        "electrohub_verifier", Path(__file__).resolve().parents[1] / "verify-model-artifact.py"
    )
    if spec is None or spec.loader is None:
        raise ValueError("release verifier is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def add_directory(archive: tarfile.TarFile, root: Path, directory: Path) -> None:
    directory.resolve().relative_to(root.resolve())
    for path in sorted(directory.rglob("*")):
        if path.is_file():
            archive.add(path, arcname=path.resolve().relative_to(root.resolve()).as_posix(), recursive=False)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--artifact-manifest", type=Path, required=True)
    parser.add_argument("--trusted-release-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--publish-url")
    args = parser.parse_args()

    if args.output.exists():
        print("Artifact output already exists; overwrite is refused", file=sys.stderr)
        return 64

    verifier = load_verifier()
    try:
        manifest = verifier.verify_production_release_metadata(
            args.release, args.artifact_manifest, args.trusted_release_sha256
        )
        release = json.loads(args.release.read_text(encoding="utf-8"))
        model_dir = args.source_root / manifest["model"]["artifactDirectory"]
        relevance_dir = args.source_root / manifest["model"]["relevanceArtifact"]["artifactDirectory"]
        verifier.verify(
            args.artifact_manifest,
            model_dir,
            relevance_dir,
            args.source_root,
            expected_status="APPROVED_PRODUCTION_RELEASE",
        )
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"Artifact publication refused: {error}", file=sys.stderr)
        return 65

    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(args.output, "w:gz", compresslevel=9) as archive:
            archive.add(args.release, arcname="AI_PRODUCTION_RELEASE.json", recursive=False)
            archive.add(args.artifact_manifest, arcname="AI_MODEL_ARTIFACT_PRODUCTION.json", recursive=False)
            add_directory(archive, args.source_root, model_dir)
            add_directory(archive, args.source_root, relevance_dir)
            loader_path = args.source_root / manifest["loader"]["sourcePath"]
            if not loader_path.is_file():
                raise ValueError("approved loader source is missing")
            archive.add(loader_path, arcname=manifest["loader"]["sourcePath"], recursive=False)
    except (OSError, tarfile.TarError) as error:
        print(f"Artifact archive could not be created: {error}", file=sys.stderr)
        return 66

    archive_sha = sha256(args.output)
    release_record = {
        "releaseId": release["releaseId"],
        "releaseManifestSha256": hashlib.sha256(args.release.read_bytes()).hexdigest(),
        "artifactManifestSha256": hashlib.sha256(args.artifact_manifest.read_bytes()).hexdigest(),
        "archiveSha256": archive_sha,
        "status": "APPROVED_PRODUCTION_RELEASE",
    }
    record_path = args.output.with_suffix(args.output.suffix + ".release.json")
    record_path.write_text(json.dumps(release_record, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    publish_url = args.publish_url or os.environ.get("AI_ARTIFACT_PUBLISH_URL")
    publish_token = os.environ.get("AI_ARTIFACT_PUBLISH_TOKEN")
    if publish_url:
        if not publish_token:
            print("Artifact publish token is required when a publish URL is configured", file=sys.stderr)
            return 67
        request = urllib.request.Request(  # noqa: S310 - publish URL is operator-provided and HTTPS restricted
            publish_url,
            data=args.output.read_bytes(),
            method="POST",
            headers={
                "Authorization": "Bearer " + publish_token,
                "Content-Type": "application/gzip",
                "x-upsert": "false",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310 - HTTPS authenticated upload
                if response.status not in {200, 201}:
                    print("Artifact storage rejected the upload", file=sys.stderr)
                    return 68
        except (urllib.error.URLError, TimeoutError, OSError):
            print("Artifact upload failed; existing release objects were not overwritten", file=sys.stderr)
            return 69

    print(json.dumps(release_record, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Hardened privileged host intake and rollback helpers for production releases.

This file is installed separately as root-owned host tooling. It must never be
loaded from, or executed out of, an incoming release bundle.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tarfile
import uuid
import zlib
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Callable, Iterable


SHA_RE = re.compile(r"^[0-9a-f]{40}$")
STAGING_RE = re.compile(r"^\.[0-9a-f]{40}\.staging-[0-9]+$")
EXPECTED_INPUTS = {
    "release-manifest.json": 4 * 1024 * 1024,
    "images.tar": None,
    "source.tar.gz": None,
    "AI_PRODUCTION_RELEASE.json": 4 * 1024 * 1024,
    "AI_MODEL_ARTIFACT_PRODUCTION.json": 4 * 1024 * 1024,
}
EXPECTED_BUNDLE_FILES = {
    "sourceArchive": "source.tar.gz",
    "imageArchive": "images.tar",
    "aiProductionRelease": "AI_PRODUCTION_RELEASE.json",
    "aiModelManifest": "AI_MODEL_ARTIFACT_PRODUCTION.json",
}
IMAGE_NAMES = {"backend", "ai-service", "edge"}
CHUNK_BYTES = 1024 * 1024
MAX_PAX_HEADER_BYTES = 64 * 1024
MAX_TAR_PATH_BYTES = 4096
MAX_TAR_COMPONENT_BYTES = 255

# These are hard ceilings. Operators may choose lower limits in the root-managed
# compose.env, but bundle metadata can never raise them.
HARD_LIMITS = {
    "PROD_RELEASE_MAX_SOURCE_ARCHIVE_BYTES": (1, 2 * 1024**3),
    "PROD_RELEASE_MAX_IMAGE_ARCHIVE_BYTES": (1, 16 * 1024**3),
    "PROD_RELEASE_MAX_SOURCE_MEMBERS": (1, 100_000),
    "PROD_RELEASE_MAX_SOURCE_FILE_BYTES": (1, 1024**3),
    "PROD_RELEASE_MAX_SOURCE_EXPANDED_BYTES": (1, 8 * 1024**3),
}


@dataclass(frozen=True)
class Limits:
    source_archive_bytes: int
    image_archive_bytes: int
    source_members: int
    source_file_bytes: int
    source_expanded_bytes: int


@dataclass(frozen=True)
class ArchiveEntry:
    name: str
    parts: tuple[str, ...]
    is_directory: bool
    size: int
    mode: int


class IntakeError(RuntimeError):
    pass


class PointerRestoreError(RuntimeError):
    pass


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise IntakeError("Release manifest contains duplicate JSON object keys")
        result[key] = value
    return result


def verify_release_bundle_files(bundle_dir: Path, expected_sha: str) -> dict[str, Any]:
    """Verify copied release metadata and all file hashes using fixed host code."""
    if not SHA_RE.fullmatch(expected_sha):
        raise IntakeError("Expected release SHA is not a full lowercase Git SHA")
    manifest_path = bundle_dir / "release-manifest.json"
    metadata = os.lstat(manifest_path)
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or metadata.st_size > 4 * 1024 * 1024:
        raise IntakeError("Release manifest is not a bounded regular file")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"), object_pairs_hook=_unique_json_object)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IntakeError("Release manifest is missing or malformed") from error
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1 or manifest.get("releaseSha") != expected_sha:
        raise IntakeError("Release manifest SHA does not match the requested exact SHA")

    images = manifest.get("images")
    if not isinstance(images, list) or len(images) != len(IMAGE_NAMES):
        raise IntakeError("Release manifest image list is incomplete")
    found_names: set[str] = set()
    for image in images:
        if not isinstance(image, dict):
            raise IntakeError("Release manifest image metadata is malformed")
        name = image.get("name")
        if not isinstance(name, str) or name not in IMAGE_NAMES or name in found_names:
            raise IntakeError("Release manifest image names are invalid or duplicated")
        if image.get("reference") != f"electrohub/{name}:{expected_sha}":
            raise IntakeError("Release image reference does not match the exact SHA")
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", str(image.get("configDigest", ""))):
            raise IntakeError("Release image config digest is invalid")
        found_names.add(name)
    if found_names != IMAGE_NAMES:
        raise IntakeError("Release manifest image list is incomplete")

    for field, expected_name in EXPECTED_BUNDLE_FILES.items():
        record = manifest.get(field)
        if not isinstance(record, dict) or record.get("file") != expected_name:
            raise IntakeError(f"Release manifest {field} path is missing or unrecognized")
        expected_digest = record.get("sha256")
        if not isinstance(expected_digest, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_digest):
            raise IntakeError(f"Release manifest {field} checksum is invalid")
        file_path = bundle_dir / expected_name
        file_metadata = os.lstat(file_path)
        if not stat.S_ISREG(file_metadata.st_mode) or stat.S_ISLNK(file_metadata.st_mode):
            raise IntakeError(f"Release bundle file {expected_name} is not a regular file")
        if _sha256_file(file_path) != expected_digest:
            raise IntakeError(f"Release bundle checksum mismatch: {expected_name}")
    return manifest


def verify_loaded_release_images(bundle_dir: Path, expected_sha: str) -> None:
    manifest = verify_release_bundle_files(bundle_dir, expected_sha)
    for image in manifest["images"]:
        reference = image["reference"]
        try:
            loaded = subprocess.run(
                ["docker", "image", "inspect", "--format", "{{.Id}}", reference],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        except (OSError, subprocess.CalledProcessError) as error:
            raise IntakeError(f"Loaded release image could not be verified: {image['name']}") from error
        if loaded != image["configDigest"]:
            raise IntakeError(f"Loaded release image differs from the verified manifest: {image['name']}")


def parse_limits(values: dict[str, str]) -> Limits:
    parsed: dict[str, int] = {}
    for name, (minimum, maximum) in HARD_LIMITS.items():
        raw = values.get(name, "")
        if not re.fullmatch(r"[0-9]+", raw):
            raise IntakeError(f"Trusted deployment setting {name} must be an integer")
        value = int(raw, 10)
        if value < minimum or value > maximum:
            raise IntakeError(f"Trusted deployment setting {name} is outside the supported safety range")
        parsed[name] = value
    if parsed["PROD_RELEASE_MAX_SOURCE_FILE_BYTES"] > parsed["PROD_RELEASE_MAX_SOURCE_EXPANDED_BYTES"]:
        raise IntakeError("Per-file source limit cannot exceed the aggregate expanded source limit")
    return Limits(
        source_archive_bytes=parsed["PROD_RELEASE_MAX_SOURCE_ARCHIVE_BYTES"],
        image_archive_bytes=parsed["PROD_RELEASE_MAX_IMAGE_ARCHIVE_BYTES"],
        source_members=parsed["PROD_RELEASE_MAX_SOURCE_MEMBERS"],
        source_file_bytes=parsed["PROD_RELEASE_MAX_SOURCE_FILE_BYTES"],
        source_expanded_bytes=parsed["PROD_RELEASE_MAX_SOURCE_EXPANDED_BYTES"],
    )


def parse_env_bytes(content: bytes) -> dict[str, str]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise IntakeError("Root-managed deployment settings are not valid UTF-8") from error
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()
        if name.startswith("export "):
            name = name[7:].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[name] = value
    return values


def open_absolute_directory(path: Path, *, root_owned: bool = True) -> int:
    """Open a directory chain without following symlinks in any component."""
    if os.name != "posix" or not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise IntakeError("Secure host intake requires Linux/POSIX openat and O_NOFOLLOW support")
    if not path.is_absolute() or ".." in path.parts:
        raise IntakeError("A privileged directory path is not canonical and absolute")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    fd = os.open("/", flags)
    try:
        for component in path.parts[1:]:
            next_fd = os.open(component, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            metadata = os.fstat(fd)
            if not stat.S_ISDIR(metadata.st_mode):
                raise IntakeError("A privileged path component is not a directory")
            shared_sticky = metadata.st_uid == 0 and bool(metadata.st_mode & stat.S_ISVTX)
            if root_owned and (metadata.st_uid != 0 or (metadata.st_mode & 0o022 and not shared_sticky)):
                raise IntakeError("A privileged path component must be root-owned and not group/world writable")
        return fd
    except Exception:
        os.close(fd)
        raise


def read_trusted_limits(config_path: Path) -> Limits:
    if os.name != "posix" or not hasattr(os, "O_NOFOLLOW"):
        raise IntakeError("Trusted deployment settings require Linux/POSIX no-follow file opening")
    parent_fd = open_absolute_directory(config_path.parent)
    try:
        fd = os.open(
            config_path.name,
            os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_fd,
        )
    finally:
        os.close(parent_fd)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise IntakeError("Root-managed deployment settings must be a root-owned, non-writable regular file")
        if metadata.st_size > 1024 * 1024:
            raise IntakeError("Root-managed deployment settings exceed the 1 MiB safety limit")
        content = bytearray()
        while True:
            chunk = os.read(fd, CHUNK_BYTES)
            if not chunk:
                break
            content.extend(chunk)
            if len(content) > 1024 * 1024:
                raise IntakeError("Root-managed deployment settings exceed the 1 MiB safety limit")
        return parse_limits(parse_env_bytes(bytes(content)))
    finally:
        os.close(fd)


def _open_child_directory(parent_fd: int, name: str, *, root_owned: bool, private: bool = False) -> int:
    fd = os.open(
        name,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
        dir_fd=parent_fd,
    )
    metadata = os.fstat(fd)
    if not stat.S_ISDIR(metadata.st_mode):
        os.close(fd)
        raise IntakeError(f"{name} is not a directory")
    if root_owned and metadata.st_uid != 0:
        os.close(fd)
        raise IntakeError(f"{name} must be root-owned")
    if metadata.st_mode & 0o022:
        os.close(fd)
        raise IntakeError(f"{name} must not be group- or world-writable")
    if private and (metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700):
        os.close(fd)
        raise IntakeError(f"{name} is not a private root-owned staging directory")
    return fd


def _open_user_intake_directory(path: Path, *, root_owned_parent: bool = True) -> int:
    """Open the SSH-user-owned intake leaf beneath a root-controlled parent."""
    parent_fd = open_absolute_directory(path.parent, root_owned=root_owned_parent)
    try:
        fd = os.open(
            path.name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_fd,
        )
        metadata = os.fstat(fd)
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid == 0 or metadata.st_mode & 0o022:
            os.close(fd)
            raise IntakeError("Incoming bundle root must be a non-root SSH-user-owned directory not writable by group or others")
        return fd
    finally:
        os.close(parent_fd)


def _copy_regular_input(source_dir_fd: int, staging_fd: int, name: str, maximum: int) -> None:
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0)
    source_fd = os.open(name, flags, dir_fd=source_dir_fd)
    destination_fd = -1
    try:
        before = os.fstat(source_fd)
        if not stat.S_ISREG(before.st_mode):
            raise IntakeError(f"Incoming bundle input {name} must be a regular file")
        if before.st_nlink != 1:
            raise IntakeError(f"Incoming bundle input {name} must not have additional hard links")
        if before.st_size < 0 or before.st_size > maximum:
            raise IntakeError(f"Incoming bundle input {name} exceeds its configured byte limit")
        destination_fd = os.open(
            name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=staging_fd,
        )
        copied = 0
        while True:
            chunk = os.read(source_fd, min(CHUNK_BYTES, maximum - copied + 1))
            if not chunk:
                break
            copied += len(chunk)
            if copied > maximum:
                raise IntakeError(f"Incoming bundle input {name} exceeded its configured byte limit while copying")
            view = memoryview(chunk)
            while view:
                written = os.write(destination_fd, view)
                view = view[written:]
        after = os.fstat(source_fd)
        if copied != before.st_size or (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            raise IntakeError(f"Incoming bundle input {name} changed or was truncated during the root-controlled copy")
        os.fsync(destination_fd)
        os.fchmod(destination_fd, 0o600)
    finally:
        if destination_fd >= 0:
            os.close(destination_fd)
        os.close(source_fd)


def _canonical_member_path(raw: str, is_directory: bool) -> tuple[str, ...]:
    if not raw or "\x00" in raw or "\\" in raw or raw.startswith("/") or any(ord(char) < 0x20 or ord(char) == 0x7F for char in raw):
        raise IntakeError("Source archive contains an absolute or non-portable path")
    try:
        raw_size = len(raw.encode("utf-8", errors="strict"))
    except UnicodeEncodeError as error:
        raise IntakeError("Source archive contains a non-portable filename") from error
    if raw_size > MAX_TAR_PATH_BYTES:
        raise IntakeError("Source archive path exceeds the 4096-byte safety limit")
    raw_without_dir_slash = raw[:-1] if is_directory and raw.endswith("/") else raw
    if not raw_without_dir_slash or raw_without_dir_slash.startswith("./"):
        raise IntakeError("Source archive contains a non-canonical path")
    pieces = raw_without_dir_slash.split("/")
    if any(piece in ("", ".", "..") for piece in pieces) or re.match(r"^[A-Za-z]:", pieces[0]):
        raise IntakeError("Source archive contains traversal or ambiguous path components")
    if any(len(piece.encode("utf-8")) > MAX_TAR_COMPONENT_BYTES for piece in pieces):
        raise IntakeError("Source archive path component exceeds the filesystem name limit")
    if PurePosixPath(raw_without_dir_slash).is_absolute():
        raise IntakeError("Source archive contains an absolute path")
    return tuple(pieces)


def _read_exact(stream: Any, size: int) -> bytes:
    result = bytearray()
    while len(result) < size:
        chunk = stream.read(min(CHUNK_BYTES, size - len(result)))
        if not chunk:
            raise IntakeError("Source tar archive ended unexpectedly")
        result.extend(chunk)
    return bytes(result)


def _skip_exact(stream: Any, size: int) -> None:
    remaining = size
    while remaining:
        chunk = stream.read(min(CHUNK_BYTES, remaining))
        if not chunk:
            raise IntakeError("Source tar member ended before its declared size")
        remaining -= len(chunk)


def _octal_field(value: bytes, label: str) -> int:
    if value and value[0] & 0x80:
        raise IntakeError(f"Source tar uses an unsupported base-256 {label} field")
    text = value.strip(b"\x00 ")
    if not text:
        return 0
    if not re.fullmatch(rb"[0-7]+", text):
        raise IntakeError(f"Source tar has an invalid {label} field")
    return int(text, 8)


def _tar_text(value: bytes, label: str) -> str:
    raw = value.split(b"\x00", 1)[0]
    try:
        return raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise IntakeError(f"Source tar {label} is not valid UTF-8") from error


def _parse_pax(payload: bytes) -> dict[str, str]:
    result: dict[str, str] = {}
    offset = 0
    while offset < len(payload):
        space = payload.find(b" ", offset)
        if space <= offset:
            raise IntakeError("Source tar contains malformed PAX metadata")
        length_text = payload[offset:space]
        if not re.fullmatch(rb"[0-9]+", length_text):
            raise IntakeError("Source tar contains malformed PAX record length")
        record_length = int(length_text, 10)
        end = offset + record_length
        if record_length <= space - offset + 3 or end > len(payload) or payload[end - 1:end] != b"\n":
            raise IntakeError("Source tar contains a truncated PAX record")
        record = payload[space + 1:end - 1]
        key_bytes, separator, value_bytes = record.partition(b"=")
        if not separator or not re.fullmatch(rb"[A-Za-z0-9_.-]+", key_bytes):
            raise IntakeError("Source tar contains an invalid PAX key/value record")
        key = key_bytes.decode("ascii")
        if key in result:
            raise IntakeError("Source tar contains duplicate PAX metadata keys")
        try:
            result[key] = value_bytes.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise IntakeError("Source tar PAX metadata is not valid UTF-8") from error
        offset = end
    allowed = {"comment", "path", "size", "mtime", "uid", "gid", "uname", "gname"}
    if set(result) - allowed:
        raise IntakeError("Source tar contains unsupported PAX metadata")
    return result


def _iter_tar_entries(stream: Any, limits: Limits) -> Iterable[ArchiveEntry]:
    tar_stream_limit = limits.source_expanded_bytes + limits.source_members * 2048 + 10 * 1024
    consumed = 0

    class LimitedStream:
        def read(self, size: int = -1) -> bytes:
            nonlocal consumed
            if size < 0:
                size = CHUNK_BYTES
            chunk = stream.read(min(size, CHUNK_BYTES))
            consumed += len(chunk)
            if consumed > tar_stream_limit:
                raise IntakeError("Expanded tar stream exceeds the derived header and content safety limit")
            return chunk

    bounded = LimitedStream()
    global_pax: dict[str, str] = {}
    local_pax: dict[str, str] = {}
    member_count = 0
    zero_blocks = 0
    while True:
        block = bounded.read(512)
        if not block:
            raise IntakeError("Source tar archive is missing its end marker")
        if len(block) != 512:
            raise IntakeError("Source tar archive has a truncated header block")
        if block == b"\x00" * 512:
            zero_blocks += 1
            if zero_blocks == 2:
                if local_pax:
                    raise IntakeError("Source tar has PAX metadata with no following member")
                return
            continue
        if zero_blocks:
            raise IntakeError("Source tar has data after its end marker")

        stored_checksum = _octal_field(block[148:156], "checksum")
        checksum_block = block[:148] + b" " * 8 + block[156:]
        if sum(checksum_block) != stored_checksum:
            raise IntakeError("Source tar header checksum is invalid")
        raw_size = _octal_field(block[124:136], "size")
        member_type = block[156:157]

        if member_type in (b"g", b"x"):
            if raw_size > MAX_PAX_HEADER_BYTES:
                raise IntakeError("Source tar PAX metadata exceeds the 64 KiB per-header limit")
            payload = _read_exact(bounded, raw_size)
            _skip_exact(bounded, (-raw_size) % 512)
            metadata = _parse_pax(payload)
            if member_type == b"g":
                global_pax.update(metadata)
            else:
                if set(local_pax) & set(metadata):
                    raise IntakeError("Source tar has conflicting local PAX metadata keys")
                local_pax.update(metadata)
            continue

        if member_type not in (b"\x00", b"0", b"5"):
            raise IntakeError("Source archive may contain only regular files and directories")
        is_directory = member_type == b"5"
        header_name = _tar_text(block[0:100], "member name")
        prefix = _tar_text(block[345:500], "path prefix")
        if prefix:
            header_name = f"{prefix}/{header_name}"
        metadata = dict(global_pax)
        metadata.update(local_pax)
        name = metadata.get("path", header_name)
        size_text = metadata.get("size")
        if size_text is not None:
            if not re.fullmatch(r"[0-9]+", size_text):
                raise IntakeError("Source tar has an invalid PAX size")
            member_size = int(size_text, 10)
        else:
            member_size = raw_size
        mode = _octal_field(block[100:108], "mode")
        parts = _canonical_member_path(name, is_directory)
        if is_directory and member_size != 0:
            raise IntakeError("Source archive directory members must have zero expanded size")
        member_count += 1
        if member_count > limits.source_members:
            raise IntakeError("Source archive exceeds its configured member-count limit")
        if not is_directory and (member_size < 0 or member_size > limits.source_file_bytes):
            raise IntakeError("Source archive contains a file larger than the configured per-file limit")
        yield ArchiveEntry(name, parts, is_directory, member_size, mode)
        _skip_exact(bounded, member_size)
        _skip_exact(bounded, (-member_size) % 512)
        local_pax = {}


def validate_source_archive(path: Path, limits: Limits) -> list[ArchiveEntry]:
    """Validate gzip expansion and every tar member before creating extracted files."""
    archive_size = path.stat().st_size
    if archive_size <= 0 or archive_size > limits.source_archive_bytes:
        raise IntakeError("Compressed source archive exceeds its configured byte limit")

    expanded_stream = 0
    tar_stream_limit = limits.source_expanded_bytes + limits.source_members * 2048 + 10 * 1024
    try:
        with path.open("rb") as raw, gzip.GzipFile(fileobj=raw, mode="rb") as stream:
            while True:
                chunk = stream.read(CHUNK_BYTES)
                if not chunk:
                    break
                expanded_stream += len(chunk)
                if expanded_stream > tar_stream_limit:
                    raise IntakeError("Expanded tar stream exceeds the derived header and content safety limit")
    except (OSError, EOFError, gzip.BadGzipFile, zlib.error) as error:
        raise IntakeError("Source archive is not a complete valid gzip stream") from error

    entries: list[ArchiveEntry] = []
    seen: set[tuple[str, ...]] = set()
    regular_files: set[tuple[str, ...]] = set()
    total_file_bytes = 0
    try:
        with path.open("rb") as raw, gzip.GzipFile(fileobj=raw, mode="rb") as stream:
            for entry in _iter_tar_entries(stream, limits):
                if entry.parts in seen:
                    raise IntakeError("Source archive contains duplicate paths")
                seen.add(entry.parts)
                if not entry.is_directory:
                    total_file_bytes += entry.size
                    if total_file_bytes > limits.source_expanded_bytes:
                        raise IntakeError("Source archive exceeds its configured aggregate file-size limit")
                    regular_files.add(entry.parts)
                entries.append(entry)
    except IntakeError:
        raise
    except (OSError, EOFError, gzip.BadGzipFile, zlib.error) as error:
        raise IntakeError("Source archive is not a valid supported tar.gz archive") from error

    for entry in entries:
        for index in range(1, len(entry.parts)):
            if entry.parts[:index] in regular_files:
                raise IntakeError("Source archive contains conflicting file and directory paths")
    return entries


def _open_or_create_directory(parent_fd: int, name: str, *, owner_uid: int = 0) -> int:
    try:
        os.mkdir(name, 0o700, dir_fd=parent_fd)
    except FileExistsError:
        pass
    fd = os.open(
        name,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
        dir_fd=parent_fd,
    )
    metadata = os.fstat(fd)
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner_uid or metadata.st_mode & 0o077:
        os.close(fd)
        raise IntakeError("A source extraction directory is not private and root-owned")
    return fd


def _open_member_parent(root_fd: int, components: Iterable[str], *, owner_uid: int = 0) -> tuple[int, str]:
    names = list(components)
    if not names:
        raise IntakeError("Source archive contains an empty path")
    current_fd = os.dup(root_fd)
    try:
        for component in names[:-1]:
            next_fd = _open_or_create_directory(current_fd, component, owner_uid=owner_uid)
            os.close(current_fd)
            current_fd = next_fd
        return current_fd, names[-1]
    except Exception:
        os.close(current_fd)
        raise


def extract_validated_source(
    path: Path,
    destination_fd: int,
    entries: list[ArchiveEntry],
    limits: Limits,
    *,
    owner_uid: int = 0,
) -> None:
    """Extract validated members with openat/O_NOFOLLOW and exclusive file creation."""
    directories = sorted((entry.parts for entry in entries if entry.is_directory), key=lambda item: (len(item), item))
    for parts in directories:
        parent_fd, leaf = _open_member_parent(destination_fd, parts, owner_uid=owner_uid)
        try:
            child_fd = _open_or_create_directory(parent_fd, leaf, owner_uid=owner_uid)
            os.close(child_fd)
        finally:
            os.close(parent_fd)

    written_total = 0
    with tarfile.open(path, mode="r|gz") as archive:
        entry_index = 0
        for member in archive:
            if entry_index >= len(entries):
                raise IntakeError("Source archive changed after its metadata validation")
            expected = entries[entry_index]
            parts = _canonical_member_path(member.name, member.isdir())
            if parts != expected.parts or member.isdir() != expected.is_directory or member.size != expected.size:
                raise IntakeError("Source archive member identity changed after metadata validation")
            entry_index += 1
            if expected.is_directory:
                continue
            parent_fd, leaf = _open_member_parent(destination_fd, parts, owner_uid=owner_uid)
            file_fd = -1
            source = None
            try:
                file_fd = os.open(
                    leaf,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
                    0o600,
                    dir_fd=parent_fd,
                )
                source = archive.extractfile(member)
                if source is None:
                    raise IntakeError("Source archive regular member has no readable content")
                remaining = expected.size
                while remaining:
                    chunk = source.read(min(CHUNK_BYTES, remaining))
                    if not chunk:
                        raise IntakeError("Source archive member ended before its declared size")
                    remaining -= len(chunk)
                    written_total += len(chunk)
                    if written_total > limits.source_expanded_bytes:
                        raise IntakeError("Extracted source exceeds its configured aggregate byte limit")
                    view = memoryview(chunk)
                    while view:
                        count = os.write(file_fd, view)
                        view = view[count:]
                if source.read(1):
                    raise IntakeError("Source archive member exceeded its declared size")
                safe_mode = 0o400 | (0o100 if expected.mode & 0o111 else 0)
                os.fchmod(file_fd, safe_mode)
                os.fsync(file_fd)
            finally:
                if source is not None:
                    source.close()
                if file_fd >= 0:
                    os.close(file_fd)
                os.close(parent_fd)
        if entry_index != len(entries):
            raise IntakeError("Source archive ended before all validated members were extracted")


def _remove_tree_at(parent_fd: int, name: str) -> None:
    fd = _open_child_directory(parent_fd, name, root_owned=True, private=True)
    try:
        for entry in os.listdir(fd):
            metadata = os.stat(entry, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISDIR(metadata.st_mode):
                _remove_tree_at(fd, entry)
            else:
                os.unlink(entry, dir_fd=fd)
    finally:
        os.close(fd)
    os.rmdir(name, dir_fd=parent_fd)


def cleanup_staging(releases_root: Path, staging_name: str) -> None:
    if not STAGING_RE.fullmatch(staging_name):
        raise IntakeError("Refusing cleanup outside a task-owned staging name")
    releases_fd = open_absolute_directory(releases_root)
    try:
        try:
            _remove_tree_at(releases_fd, staging_name)
        except FileNotFoundError:
            return
    finally:
        os.close(releases_fd)


def _require_approved_release_provenance() -> None:
    """Keep production intake disabled until its trust owner and verifier are approved."""
    raise IntakeError(
        "Production release intake is disabled: whole-release provenance trust owner and verification policy are not approved or enrolled"
    )


def prepare_bundle(incoming_root: Path, releases_root: Path, staging_name: str, sha: str, limits: Limits) -> Path:
    # A bundle-provided checksum manifest is not an authentication mechanism.
    # Do not copy, extract, or return bundle content before a trusted provenance
    # verifier has been approved and implemented.
    _require_approved_release_provenance()
    if not SHA_RE.fullmatch(sha) or not re.fullmatch(rf"\.{re.escape(sha)}\.staging-[0-9]+", staging_name):
        raise IntakeError("Release SHA or staging name is invalid")
    if not STAGING_RE.fullmatch(staging_name):
        raise IntakeError("Staging name is not a task-owned exact-SHA path")

    incoming_root_fd = _open_user_intake_directory(incoming_root)
    releases_fd = open_absolute_directory(releases_root)
    staging_fd = -1
    incoming_fd = -1
    created = False
    try:
        incoming_fd = _open_child_directory(incoming_root_fd, sha, root_owned=False)
        if os.fstat(incoming_fd).st_uid != os.fstat(incoming_root_fd).st_uid:
            raise IntakeError("Incoming exact-SHA directory owner does not match the SSH intake owner")
        actual_names = set(os.listdir(incoming_fd))
        if actual_names != set(EXPECTED_INPUTS):
            raise IntakeError("Incoming release directory must contain exactly the five expected regular-file inputs")
        os.mkdir(staging_name, 0o700, dir_fd=releases_fd)
        created = True
        staging_fd = _open_child_directory(releases_fd, staging_name, root_owned=True, private=True)

        for name, metadata_limit in EXPECTED_INPUTS.items():
            limit = metadata_limit
            if name == "source.tar.gz":
                limit = limits.source_archive_bytes
            elif name == "images.tar":
                limit = limits.image_archive_bytes
            assert limit is not None
            _copy_regular_input(incoming_fd, staging_fd, name, limit)

        # Only fixed installed code validates the user-controlled bundle before any
        # source from that bundle is executed by the privileged deployment path.
        verify_release_bundle_files(releases_root / staging_name, sha)
        os.mkdir("source", 0o700, dir_fd=staging_fd)
        source_fd = _open_child_directory(staging_fd, "source", root_owned=True, private=True)
        try:
            source_archive = releases_root / staging_name / "source.tar.gz"
            entries = validate_source_archive(source_archive, limits)
            extract_validated_source(source_archive, source_fd, entries, limits)
        finally:
            os.close(source_fd)
        return releases_root / staging_name
    except Exception:
        if created:
            try:
                if staging_fd >= 0:
                    os.close(staging_fd)
                    staging_fd = -1
                _remove_tree_at(releases_fd, staging_name)
            except Exception:
                # The caller's fixed-path EXIT cleanup retries and reports any failure.
                pass
        raise
    finally:
        if incoming_fd >= 0:
            os.close(incoming_fd)
        if staging_fd >= 0:
            os.close(staging_fd)
        os.close(incoming_root_fd)
        os.close(releases_fd)


def _safe_release_paths(releases_root: Path, current: Path, previous: Path) -> tuple[Path, Path, Path]:
    root = releases_root.resolve(strict=True)
    expected_current = root.parent / "current"
    if current != expected_current:
        raise PointerRestoreError("Current pointer path is outside the fixed release root")
    previous_real = previous.resolve(strict=True)
    expected_previous = root / previous.name
    if previous.name.startswith(".") or not SHA_RE.fullmatch(previous.name) or previous_real != expected_previous:
        raise PointerRestoreError("Previous release is not an immutable exact-SHA directory")
    metadata = os.lstat(previous)
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise PointerRestoreError("Previous release path is not a real directory")
    current_metadata = os.lstat(current)
    if not stat.S_ISLNK(current_metadata.st_mode):
        raise PointerRestoreError("Active release pointer is not a symbolic link")
    return root, expected_current, previous_real


def _create_directory_symlink(target: str, link_path: str) -> None:
    os.symlink(target, link_path, target_is_directory=True)


def restore_pointer(
    releases_root: Path,
    current: Path,
    previous: Path,
    *,
    symlink_fn: Callable[[str, str], None] = _create_directory_symlink,
    replace_fn: Callable[[str, str], None] = os.replace,
    resolve_fn: Callable[[str], str] = lambda value: os.path.realpath(value, strict=True),
) -> Path:
    root, current_path, previous_real = _safe_release_paths(releases_root, current, previous)
    temporary_link = root.parent / f".current-rollback-{os.getpid()}-{uuid.uuid4().hex}"
    target = os.path.relpath(previous_real, root.parent)
    link_created = False
    try:
        symlink_fn(target, str(temporary_link))
        link_created = True
        replace_fn(str(temporary_link), str(current_path))
        resolved = Path(resolve_fn(str(current_path)))
        if resolved != previous_real:
            raise PointerRestoreError("Restored current pointer does not resolve to the explicit previous release")
        return resolved
    except Exception as error:
        if link_created:
            try:
                if stat.S_ISLNK(os.lstat(temporary_link).st_mode):
                    os.unlink(temporary_link)
            except FileNotFoundError:
                pass
            except OSError:
                pass
        if isinstance(error, PointerRestoreError):
            raise
        raise PointerRestoreError(f"Previous pointer creation, replacement or verification failed ({type(error).__name__})") from error


def perform_rollback(
    releases_root: Path,
    current: Path,
    previous: Path,
    *,
    compose_runner: Callable[[list[str]], int],
    critical_logger: Callable[[str], None],
    symlink_fn: Callable[[str, str], None] = _create_directory_symlink,
    replace_fn: Callable[[str, str], None] = os.replace,
    resolve_fn: Callable[[str], str] = lambda value: os.path.realpath(value, strict=True),
) -> bool:
    try:
        verified_previous = restore_pointer(
            releases_root,
            current,
            previous,
            symlink_fn=symlink_fn,
            replace_fn=replace_fn,
            resolve_fn=resolve_fn,
        )
    except Exception as error:
        critical_logger(
            "CRITICAL: previous release pointer could not be restored and verified; "
            "no rollback Compose command was run; manual operator recovery is required "
            f"({type(error).__name__}: {error})."
        )
        return False

    compose_env = verified_previous / "production.compose.env"
    compose_file = verified_previous / "source/infrastructure/production/compose.yaml"
    args = [
        "docker", "compose", "--env-file", str(compose_env), "-f", str(compose_file),
        "-p", "electrohub-production", "up", "-d", "--no-build", "--pull", "never",
        "--wait", "--wait-timeout", "240", "api", "ai-service", "edge",
    ]
    try:
        status = compose_runner(args)
    except Exception as error:
        critical_logger(
            "CRITICAL: previous pointer was restored, but rollback Compose startup raised "
            f"{type(error).__name__}; manual operator recovery is required."
        )
        return False
    if status != 0:
        critical_logger(
            "CRITICAL: previous pointer was restored, but rollback Compose startup failed "
            f"with status {status}; manual operator recovery is required."
        )
        return False
    return True


def _critical(message: str) -> None:
    print(message, file=sys.stderr)
    try:
        import syslog

        syslog.syslog(syslog.LOG_CRIT, message)
    except (ImportError, OSError):
        pass


def _require_root() -> None:
    if os.name != "posix" or not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise IntakeError("Privileged host helper must run as root on Linux")


def _prepare_command(args: argparse.Namespace) -> int:
    _require_root()
    # Fail before reading deployment settings or touching SSH-owned intake.
    _require_approved_release_provenance()
    limits = read_trusted_limits(Path(args.config))
    result = prepare_bundle(Path(args.incoming_root), Path(args.releases_root), args.staging_name, args.sha, limits)
    print(result)
    return 0


def _cleanup_command(args: argparse.Namespace) -> int:
    _require_root()
    cleanup_staging(Path(args.releases_root), args.staging_name)
    return 0


def _verify_loaded_command(args: argparse.Namespace) -> int:
    _require_root()
    verify_loaded_release_images(Path(args.bundle_dir), args.sha)
    return 0


def _verify_files_command(args: argparse.Namespace) -> int:
    _require_root()
    verify_release_bundle_files(Path(args.bundle_dir), args.sha)
    return 0


def _rollback_command(args: argparse.Namespace) -> int:
    _require_root()
    previous = Path(args.previous)
    success = perform_rollback(
        Path(args.releases_root),
        Path(args.current),
        previous,
        compose_runner=lambda command: subprocess.run(command, check=False).returncode,
        critical_logger=_critical,
    )
    if not success:
        _critical(
            "Original deployment failure remains authoritative: "
            f"release={previous.name}, status={args.original_status}, line={args.original_line}."
        )
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--incoming-root", required=True)
    prepare.add_argument("--releases-root", required=True)
    prepare.add_argument("--staging-name", required=True)
    prepare.add_argument("--sha", required=True)
    prepare.add_argument("--config", required=True)
    prepare.set_defaults(handler=_prepare_command)
    cleanup = subparsers.add_parser("cleanup")
    cleanup.add_argument("--releases-root", required=True)
    cleanup.add_argument("--staging-name", required=True)
    cleanup.set_defaults(handler=_cleanup_command)
    verify_loaded = subparsers.add_parser("verify-loaded")
    verify_loaded.add_argument("--bundle-dir", required=True)
    verify_loaded.add_argument("--sha", required=True)
    verify_loaded.set_defaults(handler=_verify_loaded_command)
    verify_files = subparsers.add_parser("verify-files")
    verify_files.add_argument("--bundle-dir", required=True)
    verify_files.add_argument("--sha", required=True)
    verify_files.set_defaults(handler=_verify_files_command)
    rollback = subparsers.add_parser("rollback")
    rollback.add_argument("--releases-root", required=True)
    rollback.add_argument("--current", required=True)
    rollback.add_argument("--previous", required=True)
    rollback.add_argument("--original-status", type=int, required=True)
    rollback.add_argument("--original-line", type=int, required=True)
    rollback.set_defaults(handler=_rollback_command)
    args = parser.parse_args(argv)
    try:
        return args.handler(args)
    except (IntakeError, OSError, ValueError) as error:
        print(f"Host release guard failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

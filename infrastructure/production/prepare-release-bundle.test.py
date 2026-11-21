"""Disposable security tests for privileged release intake and rollback."""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import io
import json
import os
import socket
import stat
import sys
import tarfile
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from typing import Any
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("prepare-release-bundle.py")
SPEC = importlib.util.spec_from_file_location("prepare_release_bundle", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
Limits = MODULE.Limits


def test_limits(**overrides: int) -> Any:
    values = {
        "source_archive_bytes": 1024 * 1024,
        "image_archive_bytes": 1024 * 1024,
        "source_members": 20,
        "source_file_bytes": 1024,
        "source_expanded_bytes": 4096,
    }
    values.update(overrides)
    return Limits(**values)


def write_valid_bundle(root: Path) -> tuple[str, dict[str, bytes]]:
    sha = "0123456789abcdef0123456789abcdef01234567"
    files = {
        "source.tar.gz": tar_gz([("src/main.py", None, b"print('safe')\n", 0o644)]),
        "images.tar": b"disposable image archive fixture",
        "AI_PRODUCTION_RELEASE.json": b'{"status":"fixture"}',
        "AI_MODEL_ARTIFACT_PRODUCTION.json": b'{"status":"fixture"}',
    }
    for name, contents in files.items():
        (root / name).write_bytes(contents)
    manifest = {
        "schemaVersion": 1,
        "releaseSha": sha,
        "images": [
            {"name": name, "reference": f"electrohub/{name}:{sha}", "configDigest": f"sha256:{'a' * 64}"}
            for name in ("backend", "ai-service", "edge")
        ],
    }
    for field, filename in MODULE.EXPECTED_BUNDLE_FILES.items():
        manifest[field] = {"file": filename, "sha256": hashlib.sha256(files[filename]).hexdigest()}
    (root / "release-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return sha, files


def tar_gz(entries: list[tuple[str, bytes | None, bytes | None, int]]) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, kind, data, mode in entries:
            member = tarfile.TarInfo(name)
            member.mode = mode
            if kind is None:
                payload = data or b""
                member.type = tarfile.REGTYPE
                member.size = len(payload)
                archive.addfile(member, io.BytesIO(payload))
            else:
                member.type = kind
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    member.linkname = "target"
                elif kind in (tarfile.CHRTYPE, tarfile.BLKTYPE):
                    member.devmajor = 1
                    member.devminor = 2
                archive.addfile(member)
    return output.getvalue()


class ArchiveValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / "source.tar.gz"
        self.destination = self.root / "private-source"
        self.destination.mkdir()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def validate_rejected_without_writing(self, data: bytes, limits: Any, pattern: str) -> None:
        self.archive.write_bytes(data)
        with self.assertRaisesRegex(MODULE.IntakeError, pattern):
            entries = MODULE.validate_source_archive(self.archive, limits)
            MODULE.extract_validated_source(self.archive, -1, entries, limits)
        self.assertEqual(list(self.destination.iterdir()), [])
        self.assertFalse((self.root / "outside.txt").exists())

    def safe_archive(self) -> bytes:
        return tar_gz([
            ("app/", tarfile.DIRTYPE, None, 0o755),
            ("app/run.sh", None, b"#!/bin/sh\nexit 0\n", 0o755),
        ])

    def test_accepts_safe_archive_metadata(self) -> None:
        self.archive.write_bytes(self.safe_archive())
        entries = MODULE.validate_source_archive(self.archive, test_limits())
        self.assertEqual([entry.parts for entry in entries], [("app",), ("app", "run.sh")])

    def test_extracts_safe_archive_with_private_openat_creation(self) -> None:
        self.archive.write_bytes(self.safe_archive())
        entries = MODULE.validate_source_archive(self.archive, test_limits())
        if os.name != "posix" or not hasattr(os, "O_NOFOLLOW"):
            self.skipTest("POSIX openat/O_NOFOLLOW extraction is unavailable on this local host")
        root_fd = os.open(self.destination, os.O_RDONLY | os.O_DIRECTORY)
        try:
            MODULE.extract_validated_source(self.archive, root_fd, entries, test_limits(), owner_uid=os.geteuid())
        finally:
            os.close(root_fd)
        self.assertEqual((self.destination / "app/run.sh").read_bytes(), b"#!/bin/sh\nexit 0\n")
        self.assertEqual(stat.S_IMODE((self.destination / "app/run.sh").stat().st_mode), 0o500)
        self.assertEqual(stat.S_IMODE((self.destination / "app").stat().st_mode), 0o700)

    def test_untrusted_archive_modes_never_grant_group_or_other_permissions(self) -> None:
        modes = (0o777, 0o755, 0o511, 0o111, 0o666)
        archive_entries = [("app/", tarfile.DIRTYPE, None, 0o777)]
        archive_entries.extend((f"app/mode-{mode:o}", None, b"fixture\n", mode) for mode in modes)
        self.archive.write_bytes(tar_gz(archive_entries))
        entries = MODULE.validate_source_archive(self.archive, test_limits())
        if os.name != "posix" or not hasattr(os, "O_NOFOLLOW"):
            self.skipTest("POSIX openat/O_NOFOLLOW extraction is unavailable on this local host")
        root_fd = os.open(self.destination, os.O_RDONLY | os.O_DIRECTORY)
        try:
            MODULE.extract_validated_source(self.archive, root_fd, entries, test_limits(), owner_uid=os.geteuid())
        finally:
            os.close(root_fd)
        self.assertEqual(stat.S_IMODE((self.destination / "app").stat().st_mode), 0o700)
        for mode in modes:
            expected = 0o500 if mode & 0o111 else 0o400
            actual = stat.S_IMODE((self.destination / "app" / f"mode-{mode:o}").stat().st_mode)
            with self.subTest(archive_mode=oct(mode)):
                self.assertEqual(actual, expected)
                self.assertEqual(actual & 0o077, 0)

    def test_rejects_compressed_archive_over_limit(self) -> None:
        data = tar_gz([("a", None, b"x", 0o644)])
        self.validate_rejected_without_writing(data, test_limits(source_archive_bytes=len(data) - 1), "Compressed source archive")

    def test_rejects_excessive_member_count(self) -> None:
        data = tar_gz([("a", None, b"a", 0o644), ("b", None, b"b", 0o644)])
        self.validate_rejected_without_writing(data, test_limits(source_members=1), "member-count")

    def test_rejects_oversized_individual_file(self) -> None:
        data = tar_gz([("a", None, b"12345", 0o644)])
        self.validate_rejected_without_writing(data, test_limits(source_file_bytes=4), "per-file")

    def test_rejects_excessive_aggregate_expanded_size(self) -> None:
        data = tar_gz([("a", None, b"1234", 0o644), ("b", None, b"5678", 0o644)])
        self.validate_rejected_without_writing(data, test_limits(source_expanded_bytes=7), "aggregate")

    def test_rejects_traversal_and_absolute_paths(self) -> None:
        for name in ("../outside.txt", "/tmp/outside.txt"):
            with self.subTest(path=name):
                self.validate_rejected_without_writing(tar_gz([(name, None, b"escape", 0o644)]), test_limits(), "path")

    def test_rejects_symlink_hardlink_device_and_fifo_members(self) -> None:
        types = (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.FIFOTYPE)
        for member_type in types:
            with self.subTest(member_type=member_type):
                self.validate_rejected_without_writing(tar_gz([("unsafe", member_type, None, 0o644)]), test_limits(), "only regular files and directories")

    def test_rejects_duplicate_and_conflicting_paths(self) -> None:
        duplicate = tar_gz([("same", None, b"one", 0o644), ("same", None, b"two", 0o644)])
        self.validate_rejected_without_writing(duplicate, test_limits(), "duplicate paths")
        conflict = tar_gz([("node", None, b"file", 0o644), ("node/child", None, b"child", 0o644)])
        self.validate_rejected_without_writing(conflict, test_limits(), "conflicting")

    def test_rejects_unbounded_pax_metadata_before_tarfile_parsing(self) -> None:
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz", format=tarfile.PAX_FORMAT) as archive:
            item = tarfile.TarInfo("entry")
            item.pax_headers = {"comment": "x" * (70 * 1024)}
            item.size = 1
            archive.addfile(item, io.BytesIO(b"x"))
        self.validate_rejected_without_writing(output.getvalue(), test_limits(source_expanded_bytes=200_000), "PAX metadata exceeds")


class BundleIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sha, self.files = write_valid_bundle(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_root_managed_example_limits_parse_and_hard_ceiling_rejects_excess(self) -> None:
        example = Path(__file__).with_name("compose.env.example").read_bytes()
        values = MODULE.parse_env_bytes(example)
        limits = MODULE.parse_limits(values)
        self.assertEqual(limits.source_archive_bytes, 512 * 1024**2)
        self.assertEqual(limits.image_archive_bytes, 8 * 1024**3)
        self.assertEqual(limits.source_members, 50_000)
        values["PROD_RELEASE_MAX_IMAGE_ARCHIVE_BYTES"] = str(MODULE.HARD_LIMITS["PROD_RELEASE_MAX_IMAGE_ARCHIVE_BYTES"][1] + 1)
        with self.assertRaisesRegex(MODULE.IntakeError, "safety range"):
            MODULE.parse_limits(values)

    def test_fixed_host_verifier_checks_manifest_and_all_bundle_hashes(self) -> None:
        manifest = MODULE.verify_release_bundle_files(self.root, self.sha)
        self.assertEqual(manifest["releaseSha"], self.sha)
        (self.root / "images.tar").write_bytes(b"tampered")
        with self.assertRaisesRegex(MODULE.IntakeError, "checksum mismatch"):
            MODULE.verify_release_bundle_files(self.root, self.sha)

    def test_fixed_host_verifier_rejects_ambiguous_duplicate_manifest_keys(self) -> None:
        manifest = (self.root / "release-manifest.json").read_text(encoding="utf-8")
        (self.root / "release-manifest.json").write_text(
            manifest.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1', 1),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(MODULE.IntakeError, "duplicate JSON object keys"):
            MODULE.verify_release_bundle_files(self.root, self.sha)

    def test_fixed_host_loaded_image_gate_uses_manifest_digests(self) -> None:
        calls: list[list[str]] = []

        class Result:
            returncode = 0
            stdout = f"sha256:{'a' * 64}\n"

        def fake_run(command: list[str], **_kwargs: Any) -> Result:
            calls.append(command)
            return Result()

        with patch.object(MODULE.subprocess, "run", side_effect=fake_run):
            MODULE.verify_loaded_release_images(self.root, self.sha)
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(command[:3] == ["docker", "image", "inspect"] for command in calls))


class ReleaseProvenanceFailClosedTests(unittest.TestCase):
    def test_prepare_entrypoint_fails_before_bundle_and_activation_side_effects(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pointer = root / "current-pointer.txt"
            pointer.write_text("previous-approved-release\n", encoding="utf-8")
            before = pointer.read_bytes()
            stderr = io.StringIO()

            with (
                patch.object(MODULE, "_require_root"),
                patch.object(MODULE, "read_trusted_limits", side_effect=AssertionError("deployment settings must not be read before provenance approval")),
                patch.object(MODULE, "prepare_bundle", side_effect=AssertionError("bundle intake must not run before provenance approval")),
                patch.object(MODULE, "verify_release_bundle_files", side_effect=AssertionError("bundle verifier must not run")),
                patch.object(MODULE, "extract_validated_source", side_effect=AssertionError("bundle code must not be extracted")),
                patch.object(MODULE.subprocess, "run") as docker_or_compose,
                redirect_stderr(stderr),
            ):
                status = MODULE.main([
                    "prepare",
                    "--incoming-root", str(root / "incoming"),
                    "--releases-root", str(root / "releases"),
                    "--staging-name", f".{('a' * 40)}.staging-123",
                    "--sha", "a" * 40,
                    "--config", str(root / "compose.env"),
                ])

            self.assertEqual(status, 1)
            self.assertIn("whole-release provenance trust owner and verification policy are not approved or enrolled", stderr.getvalue())
            self.assertEqual(pointer.read_bytes(), before)
            self.assertFalse((root / "incoming").exists())
            self.assertFalse((root / "releases").exists())
            docker_or_compose.assert_not_called()


@unittest.skipUnless(os.name == "posix" and hasattr(os, "O_NOFOLLOW") and os.open in os.supports_dir_fd, "POSIX openat/O_NOFOLLOW input checks are unavailable")
class RegularInputTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.incoming = self.root / "incoming"
        self.staging = self.root / "staging"
        self.incoming.mkdir()
        self.staging.mkdir(mode=0o700)
        self.incoming_fd = os.open(self.incoming, os.O_RDONLY | os.O_DIRECTORY)
        self.staging_fd = os.open(self.staging, os.O_RDONLY | os.O_DIRECTORY)

    def tearDown(self) -> None:
        os.close(self.incoming_fd)
        os.close(self.staging_fd)
        self.temp.cleanup()

    def test_rejects_symlink_regular_input_and_preserves_target(self) -> None:
        target = self.root / "target"
        target.write_bytes(b"keep")
        try:
            (self.incoming / "bundle").symlink_to(target)
        except OSError as error:
            self.skipTest(f"symlink fixture unavailable: {error}")
        with self.assertRaises(OSError):
            MODULE._copy_regular_input(self.incoming_fd, self.staging_fd, "bundle", 1024)
        self.assertEqual(target.read_bytes(), b"keep")
        self.assertFalse((self.staging / "bundle").exists())

    def test_rejects_symlinked_incoming_directory(self) -> None:
        link = self.root / "incoming-link"
        try:
            link.symlink_to(self.incoming, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"symlink fixture unavailable: {error}")
        with self.assertRaises(OSError):
            MODULE._open_user_intake_directory(link, root_owned_parent=False)

    def test_rejects_hardlinked_incoming_file(self) -> None:
        (self.incoming / "bundle").write_bytes(b"bundle")
        os.link(self.incoming / "bundle", self.incoming / "second-name")
        with self.assertRaisesRegex(MODULE.IntakeError, "additional hard links"):
            MODULE._copy_regular_input(self.incoming_fd, self.staging_fd, "bundle", 1024)
        self.assertFalse((self.staging / "bundle").exists())

    def test_rejects_fifo_and_socket_inputs(self) -> None:
        os.mkfifo(self.incoming / "fifo")
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            listener.bind(str(self.incoming / "socket"))
            for name in ("fifo", "socket"):
                with self.subTest(name=name), self.assertRaises((MODULE.IntakeError, OSError)):
                    MODULE._copy_regular_input(self.incoming_fd, self.staging_fd, name, 1024)
        finally:
            listener.close()

    def test_copy_rejects_size_over_limit_and_creates_private_copy(self) -> None:
        (self.incoming / "large").write_bytes(b"12345")
        with self.assertRaisesRegex(MODULE.IntakeError, "byte limit"):
            MODULE._copy_regular_input(self.incoming_fd, self.staging_fd, "large", 4)
        (self.incoming / "ok").write_bytes(b"safe")
        MODULE._copy_regular_input(self.incoming_fd, self.staging_fd, "ok", 4)
        self.assertEqual((self.staging / "ok").read_bytes(), b"safe")
        self.assertEqual(stat.S_IMODE((self.staging / "ok").stat().st_mode), 0o600)


class RollbackFailureInjectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.releases = self.root / "releases"
        self.releases.mkdir()
        self.previous = self.releases / ("a" * 40)
        self.candidate = self.releases / ("b" * 40)
        for release in (self.previous, self.candidate):
            (release / "source/infrastructure/production").mkdir(parents=True)
            (release / "production.compose.env").write_text("RELEASE_SHA=test\n", encoding="utf-8")
            (release / "source/infrastructure/production/compose.yaml").write_text("services: {}\n", encoding="utf-8")
        self.current = self.root / "current"
        try:
            self.current.symlink_to(self.candidate, target_is_directory=True)
        except OSError as error:
            self.temp.cleanup()
            self.skipTest(f"symlink fixture unavailable: {error}")
        self.compose_calls: list[list[str]] = []
        self.critical: list[str] = []

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_rollback(self, **operations: Any) -> bool:
        return MODULE.perform_rollback(
            self.releases,
            self.current,
            self.previous,
            compose_runner=lambda args: self.compose_calls.append(args) or 0,
            critical_logger=self.critical.append,
            **operations,
        )

    @staticmethod
    def replace_link_for_fixture(source: str, destination: str) -> None:
        if os.name == "nt":
            # Windows does not provide POSIX rename-over-symlink semantics here;
            # this fixture models the helper's atomic replace boundary only.
            os.unlink(destination)
            os.rename(source, destination)
        else:
            os.replace(source, destination)

    def test_link_creation_failure_never_starts_compose(self) -> None:
        def fail_link(_target: str, _link: str) -> None:
            raise OSError("injected symlink creation failure")

        self.assertFalse(self.run_rollback(symlink_fn=fail_link))
        self.assertEqual(self.compose_calls, [])
        self.assertEqual(self.current.resolve(), self.candidate)
        self.assertTrue(any("no rollback Compose command was run" in item for item in self.critical))

    def test_pointer_replacement_failure_never_starts_compose(self) -> None:
        def fail_replace(_source: str, _destination: str) -> None:
            raise OSError("injected pointer replacement failure")

        self.assertFalse(self.run_rollback(replace_fn=fail_replace))
        self.assertEqual(self.compose_calls, [])
        self.assertEqual(self.current.resolve(), self.candidate)
        self.assertTrue(any("manual operator recovery is required" in item for item in self.critical))

    def test_pointer_verification_mismatch_never_starts_compose(self) -> None:
        self.assertFalse(self.run_rollback(
            replace_fn=self.replace_link_for_fixture,
            resolve_fn=lambda _path: str(self.candidate),
        ))
        self.assertEqual(self.compose_calls, [])
        self.assertTrue(any("no rollback Compose command was run" in item for item in self.critical))

    def test_verified_rollback_uses_only_explicit_immutable_previous_path(self) -> None:
        self.assertTrue(self.run_rollback(replace_fn=self.replace_link_for_fixture), self.critical)
        self.assertEqual(self.current.resolve(), self.previous)
        self.assertEqual(len(self.compose_calls), 1)
        command = self.compose_calls[0]
        normalized = [os.path.normcase(argument) for argument in command]
        self.assertIn(os.path.normcase(str(self.previous / "production.compose.env")), normalized)
        self.assertIn(os.path.normcase(str(self.previous / "source/infrastructure/production/compose.yaml")), normalized)
        self.assertFalse(any(os.path.normcase(str(self.current)) in argument for argument in normalized))
        self.assertEqual(self.critical, [])


if __name__ == "__main__":
    unittest.main()

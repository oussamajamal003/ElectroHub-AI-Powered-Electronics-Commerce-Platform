"""Runs the official Kaggle CLI with ONLY the KAGGLE_* credentials taken from a local env file.

The credential values are never printed or written anywhere; the child process receives them through its environment.
Default source is training/.data/kaggle.env (git-ignored, training-only); --env-file overrides it.

    python kaggle_cli.py --names                    # list which KAGGLE_* names are present (values hidden)
    python kaggle_cli.py datasets status <owner/slug>
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values

DEFAULT_ENV = Path(__file__).resolve().parent / ".data" / "kaggle.env"


def kaggle_environment(env_file: Path) -> dict[str, str]:
    values = {key: value for key, value in dotenv_values(env_file).items() if key.startswith("KAGGLE_") and value}
    if not values:
        raise SystemExit(f"no KAGGLE_* values in {env_file.name}")
    # The owner stores a new-style access token (KGAT_...) as KAGGLE_API_KEY; the CLI reads it as KAGGLE_API_TOKEN.
    if "KAGGLE_API_TOKEN" not in values and values.get("KAGGLE_API_KEY", "").startswith("KGAT_"):
        values["KAGGLE_API_TOKEN"] = values.pop("KAGGLE_API_KEY")
    # OS/process plumbing only: a parent shell may contain commerce or service credentials.
    inherited = {
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "TEMP",
        "TMP",
        "TMPDIR",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "LANG",
        "LC_ALL",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
    }
    clean = {key: value for key, value in os.environ.items() if key.upper() in inherited}
    return {**clean, **values, "PYTHONIOENCODING": "utf-8"}


def main(argv: list[str]) -> int:
    env_file = DEFAULT_ENV
    if argv[:1] == ["--env-file"]:
        env_file, argv = Path(argv[1]), argv[2:]
    environment = kaggle_environment(env_file)
    if argv == ["--names"]:
        print(sorted(key for key in environment if key.startswith("KAGGLE_")))
        return 0
    executable = shutil.which("kaggle", path=str(Path(sys.executable).parent)) or shutil.which("kaggle")
    if executable is None:
        raise SystemExit("kaggle CLI not installed in this environment")
    return subprocess.call([executable, *argv], env=environment)  # noqa: S603 - fixed executable, operator arguments


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

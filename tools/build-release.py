#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
version = manifest["version"]
base = f"1440-please-{version}"

RUNTIME_ROOT_FILES = ["manifest.json", "LICENSE"]
RUNTIME_DIRS = ["background", "content", "lib", "options", "popup"]
SOURCE_EXCLUDES = {".git", "dist", "node_modules", "__pycache__"}


def files_under(directory: Path):
    for path in sorted(directory.rglob("*")):
        if path.is_file() and not any(part in SOURCE_EXCLUDES for part in path.relative_to(ROOT).parts):
            yield path


def add_file(zf: zipfile.ZipFile, path: Path, arcname: str):
    info = zipfile.ZipInfo(arcname)
    info.date_time = (2026, 1, 1, 0, 0, 0)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    zf.writestr(info, path.read_bytes())


def build_xpi(path: Path):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name in RUNTIME_ROOT_FILES:
            add_file(zf, ROOT / name, name)
        for dirname in RUNTIME_DIRS:
            for file in files_under(ROOT / dirname):
                add_file(zf, file, file.relative_to(ROOT).as_posix())


def build_source(path: Path):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for file in files_under(ROOT):
            add_file(zf, file, file.relative_to(ROOT).as_posix())


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


DIST.mkdir(exist_ok=True)
for old in DIST.glob("1440-please-*"):
    if old.is_file():
        old.unlink()

xpi = DIST / f"{base}.xpi"
source = DIST / f"{base}-source.zip"
build_xpi(xpi)
build_source(source)

checksums = DIST / "SHA256SUMS.txt"
checksums.write_text(
    f"{sha256(xpi)}  {xpi.name}\n{sha256(source)}  {source.name}\n",
    encoding="utf-8",
)
print(xpi)
print(source)
print(checksums)

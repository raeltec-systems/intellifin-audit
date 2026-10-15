#!/usr/bin/env python3
"""Check the independent Zobba dependency graph (Python 3.11+, no packages)."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAYERS = {
    "zobba-domain": set(),
    "zobba-application": {"zobba-domain"},
    "zobba-infrastructure": {"zobba-domain", "zobba-application"},
    "zobba-api": {"zobba-domain", "zobba-application", "zobba-infrastructure"},
    "zobba-worker": {"zobba-domain", "zobba-application", "zobba-infrastructure"},
    # The CLI consumes the API-owned interface to emit OpenAPI; it cannot be a
    # dependency of any running service.
    "zobba-cli": {"zobba-domain", "zobba-application", "zobba-infrastructure", "zobba-api"},
}
IGNORED = {"node_modules", "target", "dist", ".git", ".venv"}
ERRORS: list[str] = []
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z_0-9]*")
RAW_STRING_START = re.compile(r'r(#{0,255})"')
RUST_CHARACTER = re.compile(r"'(?:\\.|[^'\\])'")


def require(condition: bool, message: str) -> None:
    if not condition:
        ERRORS.append(message)


def inside(path: Path) -> bool:
    return path.resolve().is_relative_to(ROOT)


def files(name: str):
    for path in ROOT.rglob(name):
        if not IGNORED.intersection(path.relative_to(ROOT).parts):
            yield path


def cargo_graph() -> None:
    toolchain = tomllib.loads((ROOT / "rust-toolchain.toml").read_text())["toolchain"]
    require(toolchain.get("channel") == "1.98.1", "Rust must be pinned to 1.98.1")
    if toolchain.get("channel") != "1.98.1":
        return
    lock = ROOT / "Cargo.lock"
    require(lock.is_file(), "Cargo.lock is required")
    if not lock.is_file():
        return
    original_lock = lock.read_bytes()
    result = subprocess.run(
        ["cargo", "metadata", "--format-version", "1", "--no-deps", "--locked"],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )
    require(result.returncode == 0, "locked cargo metadata failed; run it for diagnostics")
    require(lock.read_bytes() == original_lock, "cargo metadata changed Cargo.lock")
    if result.returncode:
        return
    metadata = json.loads(result.stdout)
    require(Path(metadata["workspace_root"]).resolve() == ROOT, "Cargo workspace escaped zobba/")
    packages = metadata["packages"]
    require({p["name"] for p in packages} == set(LAYERS), "unexpected or missing Cargo workspace member")
    require(
        set(metadata["workspace_members"]) == {p["id"] for p in packages},
        "Cargo workspace members do not match its package graph",
    )
    for package in packages:
        name = package["name"]
        manifest = Path(package["manifest_path"])
        require(inside(manifest), f"{name}: manifest escapes zobba/")
        if name not in LAYERS:
            continue
        expected = ROOT / "crates" / name.removeprefix("zobba-") / "Cargo.toml"
        require(manifest.resolve() == expected.resolve(), f"{name}: unexpected crate location")
        for target in package["targets"]:
            require(inside(Path(target["src_path"])), f"{name}: source target escapes zobba/")
        dependencies = package["dependencies"]
        require(name != "zobba-domain" or not dependencies, "domain must have no crate dependencies")
        for dependency in dependencies:
            dep = dependency["name"]
            dep_path = dependency.get("path")
            if dep in LAYERS:
                require(dep in LAYERS[name], f"{name} -> {dep}: outward dependency")
                require(
                    dep_path is not None
                    and Path(dep_path).resolve() == (ROOT / "crates" / dep.removeprefix("zobba-")).resolve(),
                    f"{name} -> {dep}: owned crate must resolve to its local workspace path",
                )
            elif dep_path:
                require(False, f"{name}: undeclared local crate dependency {dep}")
            if dep_path:
                require(inside(Path(dep_path)), f"{name}: path dependency escapes zobba/")
            if name == "zobba-application":
                require(
                    dep in LAYERS[name] or dep in {"async-trait", "serde", "thiserror", "uuid"},
                    f"application: delivery, storage or vendor dependency {dep} is not admitted",
                )
    manifest = tomllib.loads((ROOT / "Cargo.toml").read_text())
    require("workspace" in manifest, "zobba/Cargo.toml must declare its own workspace")
    for section in ("patch", "replace"):
        require(not manifest.get(section), f"Cargo {section} requires explicit boundary review")


def node_graph() -> None:
    manifests = [(p, json.loads(p.read_text())) for p in files("package.json")]
    names = {data.get("name") for _, data in manifests}
    require((ROOT / "pnpm-lock.yaml").is_file(), "independent pnpm-lock.yaml is required")
    require((ROOT / "pnpm-workspace.yaml").is_file(), "independent pnpm-workspace.yaml is required")
    root_package = json.loads((ROOT / "package.json").read_text())
    require(root_package.get("packageManager") == "pnpm@11.25.0", "pnpm must be pinned to 11.25.0")
    require((ROOT / ".nvmrc").read_text().strip() == "24.20.0", "Node must be pinned to 24.20.0")
    # Only the owned web client and independent synthetic IdP are admitted.
    workspace = (ROOT / "pnpm-workspace.yaml").read_text()
    package_section = re.search(r"^packages:[ \t]*\n(.*?)(?=^\S|\Z)", workspace, re.MULTILINE | re.DOTALL)
    package_patterns = re.findall(
        r"^\s+-\s+[\"']?([^\s\"'#]+)", package_section[1] if package_section else "", re.MULTILINE,
    )
    require(package_patterns == ["web", "fixtures/oidc"], "pnpm workspace must include exactly web and the independent OIDC fixture")
    for path, data in manifests:
        label = str(path.relative_to(ROOT))
        require(inside(path), f"{label}: package manifest escapes zobba/")
        for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            for name, version in data.get(section, {}).items():
                if name in {"oidc-provider", "@zobba/oidc-fixture"}:
                    require(label == "fixtures/oidc/package.json", f"{label}: IdP implementation is fixture infrastructure only")
                require(
                    not name.startswith("@intellifin/") and not re.search(r"drizzle|pg-boss", name),
                    f"{label}: legacy backend dependency {name}",
                )
                if version.startswith("workspace:"):
                    require(name in names, f"{label}: workspace dependency is outside zobba/: {name}")
                elif version.startswith(("file:", "link:")):
                    require(inside(path.parent / version.split(":", 1)[1]), f"{label}: local npm dependency escapes zobba/")
        for command in data.get("scripts", {}).values():
            require(
                not re.search(r"(?:--dir\s+|--prefix\s+|\bcd\s+)['\"]?\.\.(?:/|\s|$)", command),
                f"{label}: script redirects into the historical workspace",
            )
    lock = (ROOT / "pnpm-lock.yaml").read_text()
    require(not re.search(r"@intellifin/|drizzle-orm|drizzle-kit|pg-boss", lock), "pnpm lock includes a legacy backend")
    for local in re.findall(r"(?:link|file):([^\s'\"]+)", lock):
        require(".." not in Path(local).parts, "pnpm lock contains a parent-relative local dependency")


def source_paths() -> None:
    ts_configuration_paths()
    for path in files("*"):
        if path.is_symlink() and not inside(path):
            require(False, f"{path.relative_to(ROOT)}: source symlink escapes zobba/")
            continue
        if not path.is_file() or path.suffix not in {".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}:
            continue
        if not inside(path):
            require(False, f"{path.relative_to(ROOT)}: source symlink escapes zobba/")
            continue
        source = path.read_text()
        label = str(path.relative_to(ROOT))
        if len(source) > 2_000_000:
            require(False, f"{label}: source exceeds the bounded checker limit")
            continue
        if path.suffix == ".rs":
            rust_source_paths(path, source, label)
        else:
            javascript_source_paths(path, source, label)


def tokens(source: str, *, rust: bool) -> list[tuple[str, str]]:
    """Small source-inclusion lexer, not a general language evaluator.

    Comments/string contents cannot masquerade as imports. Unresolved inclusion
    expressions are refused, so macros and escaping cannot hide an external path.
    """
    result = []
    position = 0
    while position < len(source):
        if source[position].isspace():
            position += 1
            continue
        if source.startswith("//", position):
            end = source.find("\n", position)
            position = len(source) if end == -1 else end + 1
            continue
        if source.startswith("/*", position):
            depth = 1
            position += 2
            while position < len(source) and depth:
                if source.startswith("/*", position):
                    depth += 1
                    position += 2
                elif source.startswith("*/", position):
                    depth -= 1
                    position += 2
                else:
                    position += 1
            continue
        raw = RAW_STRING_START.match(source, position) if rust and source[position] == "r" else None
        if raw:
            start = position + len(raw[0])
            end = source.find('"' + raw[1], start)
            if end == -1:
                result.append(("unknown", "unterminated raw string"))
                break
            result.append(("string", source[start:end]))
            position = end + 1 + len(raw[1])
            continue
        quote = source[position]
        if quote == '"' or (not rust and quote in {"'", "`"}):
            end = position + 1
            escaped = False
            while end < len(source):
                if source[end] == "\\":
                    escaped = True
                    end += 2
                elif source[end] == quote:
                    break
                else:
                    end += 1
            value = source[position + 1:end]
            kind = "unknown" if escaped or (quote == "`" and "${" in value) else "string"
            # A template interpolation can execute an import; never silently skip it.
            if quote == "`" and re.search(r"\b(?:import|require)\s*\(", value):
                result.append(("dynamic_inclusion", "template import"))
            result.append((kind, value))
            position = min(end + 1, len(source))
            continue
        if rust and quote == "'":
            character = RUST_CHARACTER.match(source, position)
            if character:
                position += len(character[0])
                continue
        identifier = IDENTIFIER.match(source, position)
        if identifier:
            result.append(("identifier", identifier[0]))
            position += len(identifier[0])
        else:
            result.append(("symbol", source[position]))
            position += 1
    return result


def source_reference(path: Path, value: str, label: str, *, always_path: bool = False) -> None:
    if always_path or value.startswith(".") or Path(value).is_absolute():
        require(inside(path.parent / value), f"{label}: source import escapes zobba/")
    require(not value.startswith("@intellifin/"), f"{label}: legacy package import")


def rust_source_paths(path: Path, source: str, label: str) -> None:
    stream = tokens(source, rust=True)

    def expression(index: int, depth: int = 0) -> tuple[str, int]:
        if depth > 32 or index >= len(stream):
            raise ValueError("unresolved inclusion")
        kind, value = stream[index]
        if kind == "string":
            return value, index + 1
        if kind != "identifier" or value not in {"concat", "env"}:
            raise ValueError("unresolved inclusion")
        if stream[index + 1:index + 3] != [("symbol", "!"), ("symbol", "(")]:
            raise ValueError("unresolved inclusion")
        index += 3
        pieces = []
        while index < len(stream) and stream[index][1] != ")":
            piece, index = expression(index, depth + 1)
            pieces.append(piece)
            if index < len(stream) and stream[index][1] == ",":
                index += 1
            elif index >= len(stream) or stream[index][1] != ")":
                raise ValueError("unresolved inclusion")
        if index >= len(stream):
            raise ValueError("unresolved inclusion")
        if value == "env":
            if pieces != ["CARGO_MANIFEST_DIR"]:
                raise ValueError("unresolved environment inclusion")
            directory = path.parent
            while inside(directory) and not (directory / "Cargo.toml").is_file():
                directory = directory.parent
            if not inside(directory):
                raise ValueError("manifest unavailable")
            return str(directory), index + 1
        return "".join(pieces), index + 1

    for index, token in enumerate(stream):
        macro = token[0] == "identifier" and token[1] in {"include", "include_str", "include_bytes"}
        macro = macro and stream[index + 1:index + 2] == [("symbol", "!")]
        # `path =` is meaningful only inside an attribute; cfg_attr may nest it.
        attribute = (
            token == ("symbol", "#")
            and stream[index + 1:index + 2] == [("symbol", "[")]
            and index + 2 < len(stream)
            and stream[index + 2] in {("identifier", "path"), ("identifier", "cfg_attr")}
        )
        starts = []
        if macro:
            if index + 2 >= len(stream) or stream[index + 2][1] not in {"(", "[", "{"}:
                require(False, f"{label}: unresolved Rust source inclusion")
                continue
            starts.append((index + 3, {"(": ")", "[": "]", "{": "}"}[stream[index + 2][1]]))
        if attribute:
            cursor, depth = index + 2, 1
            while cursor < len(stream) and depth:
                if stream[cursor][1] == "[":
                    depth += 1
                elif stream[cursor][1] == "]":
                    depth -= 1
                if stream[cursor] == ("identifier", "path") and stream[cursor + 1:cursor + 2] == [("symbol", "=")]:
                    starts.append((cursor + 2, None))
                cursor += 1
        for start, closing in starts:
            try:
                value, end = expression(start)
                if closing is not None:
                    if end < len(stream) and stream[end][1] == ",":
                        end += 1
                    if end >= len(stream) or stream[end][1] != closing:
                        raise ValueError("unresolved inclusion")
                source_reference(path, value, label, always_path=True)
            except (ValueError, IndexError):
                require(False, f"{label}: unresolved Rust source inclusion")


def javascript_source_paths(path: Path, source: str, label: str) -> None:
    stream = tokens(source, rust=False)
    for index, token in enumerate(stream):
        if token[0] == "dynamic_inclusion":
            require(False, f"{label}: unresolved JavaScript source inclusion")
        if token[0] != "identifier":
            continue
        value = token[1]
        if value in {"from", "import"} and index + 1 < len(stream) and stream[index + 1][0] == "string":
            source_reference(path, stream[index + 1][1], label)
        if value in {"from", "import"} and index + 1 < len(stream) and stream[index + 1][0] == "unknown":
            require(False, f"{label}: unresolved JavaScript source inclusion")
        opening = index + 1
        if value == "require" and stream[opening:opening + 2] == [("symbol", "."), ("identifier", "resolve")]:
            opening += 2
        if value in {"require", "import"} and stream[opening:opening + 1] == [("symbol", "(")]:
            argument = stream[opening + 1:opening + 2]
            end = stream[opening + 2:opening + 3]
            if len(argument) == 1 and argument[0][0] == "string" and end and end[0][1] in {")", ","}:
                source_reference(path, argument[0][1], label)
            else:
                require(False, f"{label}: unresolved JavaScript source inclusion")
        if value == "URL" and stream[index - 1:index] == [("identifier", "new")]:
            # Source-relative URLs used by generation/build scripts are imports too.
            tail = stream[index + 1:index + 12]
            if ("identifier", "meta") in tail:
                if len(tail) > 2 and tail[0][1] == "(" and tail[1][0] == "string" and tail[2][1] == ",":
                    source_reference(path, tail[1][1], label, always_path=True)
                else:
                    require(False, f"{label}: unresolved source-relative URL")
    if path.name.startswith("vite.config."):
        values = [value for _, value in stream]
        require(
            not any(value in {"alias", "resolve", "root", "mergeConfig", "tsconfigPaths"} for value in values),
            f"{label}: Vite resolver customization requires an explicit checked resolver",
        )
        require(
            not any(values[index:index + 3] == [".", ".", "."] for index in range(len(values)))
            and not any(values[index:index + 2] == ["]", ":"] for index in range(len(values))),
            f"{label}: dynamic Vite configuration cannot establish source isolation",
        )
        defaults = [index for index in range(len(values) - 2) if values[index:index + 2] == ["export", "default"]]
        require(
            len(defaults) == 1,
            f"{label}: Vite requires one directly inspected default configuration export",
        )
        for index in defaults:
            factory = values[index + 2:index + 5] == ["defineConfig", "(", "{"]
            require(
                factory or values[index + 2] == "{",
                f"{label}: unresolved Vite configuration",
            )
            if factory:
                named_import = [
                    ("identifier", "import"), ("symbol", "{"), ("identifier", "defineConfig"),
                    ("symbol", "}"), ("identifier", "from"), ("string", "vite"),
                ]
                require(
                    any(stream[start:start + len(named_import)] == named_import for start in range(len(stream))),
                    f"{label}: defineConfig must be the directly named import from vite",
                )


def ts_configuration_paths() -> None:
    visited = set()

    def inspect(path: Path, *, inherited: bool = False) -> None:
        path = path.resolve()
        if not inside(path):
            require(False, "TypeScript configuration escapes zobba/")
            return
        # An ancestor may already have been checked as a standalone project.
        # Its inherited resolver meaning still needs its own check.
        visit = (path, inherited)
        if visit in visited:
            return
        visited.add(visit)
        label = str(path.relative_to(ROOT))
        try:
            config = json.loads(path.read_text())
            options = config.get("compilerOptions", {})
            # TypeScript retains the declaring file's baseUrl origin across
            # extends, so child paths cannot safely use the child's directory.
            # Until we own a full effective-config resolver, inherited resolver
            # customization is refused even when a child would override it.
            require(
                not inherited or not any(field in options for field in ("baseUrl", "paths", "rootDirs", "typeRoots")),
                f"{label}: inherited TypeScript resolver customization is unsupported",
            )
            base = path.parent / options.get("baseUrl", ".")
            require(inside(base), f"{label}: TypeScript baseUrl escapes zobba/")
            for destinations in options.get("paths", {}).values():
                for destination in destinations:
                    require(inside(base / destination), f"{label}: TypeScript alias escapes zobba/")
            for field in ("files", "include"):
                for destination in config.get(field, []):
                    require(inside(path.parent / destination), f"{label}: TypeScript {field} escapes zobba/")
            for field in ("rootDir", "outDir", "declarationDir"):
                if field in options:
                    require(inside(path.parent / options[field]), f"{label}: TypeScript {field} escapes zobba/")
            for field in ("rootDirs", "typeRoots"):
                for destination in options.get(field, []):
                    require(inside(path.parent / destination), f"{label}: TypeScript {field} escapes zobba/")
            for reference in config.get("references", []):
                target = path.parent / reference["path"]
                inspect(target / "tsconfig.json" if target.is_dir() else target)
            ancestors = config.get("extends", [])
            for parent in ([ancestors] if isinstance(ancestors, str) else ancestors):
                require(parent.startswith(".") or Path(parent).is_absolute(), f"{label}: external TypeScript config package is unsupported")
                target = path.parent / parent
                if target.is_dir():
                    target /= "tsconfig.json"
                elif target.suffix != ".json":
                    target = target.with_suffix(".json")
                inspect(target, inherited=True)
        except (OSError, ValueError, KeyError, TypeError):
            require(False, f"{label}: TypeScript configuration cannot be resolved as owned JSON")

    for path in files("tsconfig*.json"):
        inspect(path)


def main() -> int:
    cargo_graph()
    node_graph()
    source_paths()
    if ERRORS:
        for error in ERRORS:
            print(f"boundary violation: {error}", file=sys.stderr)
        return 1
    print("Zobba boundaries passed: six inward Rust crates and an independent web workspace.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError) as error:
        print(f"boundary check could not complete: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)

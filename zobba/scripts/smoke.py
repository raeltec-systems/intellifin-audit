#!/usr/bin/env python3
"""Build and exercise the real bootstrap processes using a disposable test DB."""

from __future__ import annotations

import contextlib
import ipaddress
import json
import os
import re
import select
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Loopback health requests must not use an inherited outbound HTTP proxy.
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def run(command: list[str], *, env=None) -> None:
    result = subprocess.run(command, cwd=ROOT, env=env, check=False)
    require(result.returncode == 0, f"{command[0]} check failed")


def database_identity(url: str) -> tuple[frozenset[str], int, str, str]:
    """Resolve the same endpoint/database as SQLx, without exposing URL content.

    Routing and database query overrides are intentionally unsupported. In
    particular host/hostaddr must never bypass the failure-injection proxy.
    """
    try:
        require(not any(character.isspace() or ord(character) < 32 for character in url), "database URL contains unsupported whitespace")
        require(re.search(r"%(?![0-9A-Fa-f]{2})", url) is None, "database URL contains invalid escaping")
        parsed = urllib.parse.urlsplit(url)
        require(parsed.scheme in {"postgres", "postgresql"} and bool(parsed.hostname), "database URL must use explicit PostgreSQL TCP")
        require(not parsed.fragment, "database URL fragments are unsupported")
        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
        keys = [key for key, _ in query]
        require(
            all(key in {"sslmode", "ssl-mode", "application_name"} for key in keys)
            and len(set(keys)) == len(keys),
            "database URL query contains an unsupported override",
        )
        host = parsed.hostname
        require("%" not in host and "/" not in host, "database URL must use a TCP hostname")
        database = urllib.parse.unquote(parsed.path.removeprefix("/"), errors="strict")
        username = urllib.parse.unquote(parsed.username or "", errors="strict")
        require(bool(database and username) and "/" not in database and "\x00" not in database + username, "database URL requires an explicit database and role")
        port = parsed.port if parsed.port is not None else int(os.environ.get("PGPORT", "5432"))
        require(0 < port <= 65535, "database port is invalid")
        addresses = set()
        for result in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM):
            address = ipaddress.ip_address(result[4][0])
            if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
                address = address.ipv4_mapped
            addresses.add("loopback" if address.is_loopback else str(address))
        require(bool(addresses), "database hostname did not resolve")
        return frozenset(addresses), port, database, username
    except (ValueError, OSError, UnicodeError):
        raise RuntimeError("database URL identity could not be validated") from None


def test_urls() -> tuple[str, str, str]:
    migration = os.environ.get("ZOBBA_TEST_MIGRATION_DATABASE_URL", "")
    runtime = os.environ.get("ZOBBA_TEST_RUNTIME_DATABASE_URL", "")
    require(bool(migration and runtime), "set both ZOBBA_TEST_*_DATABASE_URL variables to a disposable database")
    require(not os.environ.get("PGOPTIONS"), "PGOPTIONS is unsupported for destructive database checks")
    identities = [database_identity(url) for url in (migration, runtime)]
    for identity in identities:
        require(identity[2].endswith("_test"), "disposable database name must end in _test")
    require(
        identities[0][:3] == identities[1][:3],
        "test migration and runtime URLs must address the same database",
    )
    if os.environ.get("ZOBBA_TEST_ADMIN_DATABASE_URL"):
        administrator = database_identity(os.environ["ZOBBA_TEST_ADMIN_DATABASE_URL"])
        require(
            administrator[:3] == identities[0][:3],
            "test administrator URL must address the same disposable database",
        )
    require(identities[0][3] != identities[1][3], "migration and runtime roles must differ")
    runtime_role = identities[1][3]
    require(re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", runtime_role) is not None, "test runtime role must be a bounded lowercase PostgreSQL identifier")
    for name in ("ZOBBA_MIGRATION_DATABASE_URL", "ZOBBA_RUNTIME_DATABASE_URL"):
        if os.environ.get(name):
            development = database_identity(os.environ[name])
            require(
                not (development[0] & identities[0][0] and development[1:3] == identities[0][1:3]),
                "test database must differ from the configured development database",
            )
    return migration, runtime, runtime_role


class DatabaseProxy:
    """Interrupt only these test processes' PostgreSQL sockets, including pools."""

    def __init__(self, url: str):
        self.identity = database_identity(url)
        self.source = urllib.parse.urlsplit(url)
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.listener.settimeout(0.2)
        self.port = self.listener.getsockname()[1]
        self.stopped = threading.Event()
        self.paused = threading.Event()
        self.lock = threading.Lock()
        self.connections: set[socket.socket] = set()
        self.thread = threading.Thread(target=self.accept, daemon=True)

    @property
    def url(self) -> str:
        credentials = self.source.netloc.rpartition("@")[0]
        netloc = f"{credentials}@127.0.0.1:{self.port}"
        return urllib.parse.urlunsplit(self.source._replace(netloc=netloc))

    def start(self) -> None:
        self.thread.start()

    def accept(self) -> None:
        while not self.stopped.is_set():
            try:
                client, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            with self.lock:
                if self.paused.is_set() or self.stopped.is_set():
                    client.close()
                    continue
                self.connections.add(client)
            threading.Thread(target=self.forward, args=(client,), daemon=True).start()

    def forward(self, client: socket.socket) -> None:
        server = None
        try:
            server = socket.create_connection((self.source.hostname, self.identity[1]), timeout=3)
            with self.lock:
                if self.paused.is_set() or self.stopped.is_set():
                    return
                self.connections.add(server)
            while not self.stopped.is_set() and not self.paused.is_set():
                readable, _, _ = select.select([client, server], [], [], 0.2)
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    (server if source is client else client).sendall(data)
        except (OSError, ValueError):
            pass
        finally:
            for connection in (client, server):
                if connection:
                    with self.lock:
                        self.connections.discard(connection)
                    connection.close()

    def pause(self) -> None:
        """Cut active traffic and refuse new traffic, retaining the same port."""
        with self.lock:
            self.paused.set()
            for connection in self.connections:
                with contextlib.suppress(OSError):
                    connection.shutdown(socket.SHUT_RDWR)
                connection.close()

    def resume(self) -> None:
        require(not self.stopped.is_set(), "cannot resume a closed database proxy")
        self.paused.clear()

    def close(self) -> None:
        self.stopped.set()
        self.pause()
        self.listener.close()
        self.thread.join(timeout=2)


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def health(port: int, route: str) -> tuple[int, dict]:
    try:
        response = HTTP.open(f"http://127.0.0.1:{port}/health/{route}", timeout=8)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response)


def wait_health(process: subprocess.Popen, service: str, port: int, *, ready: bool) -> None:
    deadline = time.monotonic() + 20
    expected = (200, {"service": service, "status": "ready", "schema_version": 12}) if ready else (
        503, {"service": service, "status": "unavailable", "schema_version": None}
    )
    while time.monotonic() < deadline:
        require(process.poll() is None, f"{service} exited before health verification")
        try:
            if health(port, "ready") == expected:
                require(
                    health(port, "live") == (200, {"service": service, "status": "live", "schema_version": None}),
                    f"{service} liveness does not match its owned interface",
                )
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.1)
    raise RuntimeError(f"{service} did not report {'ready' if ready else 'unavailable'} within 20 seconds")


def main() -> None:
    migration, runtime, runtime_role = test_urls()
    print("Smoke uses only the dedicated *_test database; its schema is reset.", flush=True)
    run(["cargo", "build", "--workspace", "--bins", "--locked"])
    metadata = subprocess.run(
        ["cargo", "metadata", "--format-version", "1", "--no-deps", "--locked"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    binaries = Path(json.loads(metadata.stdout)["target_directory"]) / "debug"
    # The real adapter test covers foreign/altered/future schemas, privileges and
    # read-only refusal snapshots, and leaves this disposable database empty.
    run(["cargo", "test", "-p", "zobba-infrastructure", "--test", "bootstrap", "--locked"])
    runtime_env = os.environ.copy()
    runtime_env["ZOBBA_RUNTIME_DATABASE_URL"] = runtime
    # Runtime processes receive no migration credential, including inherited ones.
    for name in ("ZOBBA_MIGRATION_DATABASE_URL", "ZOBBA_TEST_MIGRATION_DATABASE_URL", "ZOBBA_TEST_ADMIN_DATABASE_URL"):
        runtime_env.pop(name, None)
    for service in ("api", "worker"):
        sentinel = "ZOBBA_SMOKE_CREDENTIAL_CONTENT_SENTINEL"
        invalid_env = runtime_env | {
            "ZOBBA_RUNTIME_DATABASE_URL": f"postgresql://smoke:{sentinel}@127.0.0.1:not-a-port/zobba_test"
        }
        invalid = subprocess.run(
            [str(binaries / f"zobba-{service}")], cwd=ROOT, env=invalid_env,
            capture_output=True, text=True, timeout=15, check=False,
        )
        require(invalid.returncode != 0, f"{service} accepted an invalid runtime URL")
        require(sentinel not in invalid.stdout + invalid.stderr, f"{service} disclosed configuration content")
        require(
            invalid.stdout == "" and invalid.stderr == f"{service}: invalid_configuration\n",
            f"{service} invalid-configuration diagnostic is not allowlisted",
        )
        refused = subprocess.run(
            [str(binaries / f"zobba-{service}")], cwd=ROOT, env=runtime_env,
            capture_output=True, text=True, timeout=15, check=False,
        )
        require(refused.returncode != 0, f"{service} accepted an unmigrated database")
        require(
            refused.stdout == "" and refused.stderr == f"{service}: schema_mismatch\n",
            f"{service} did not give the exact allowlisted schema refusal",
        )
    print("API and worker refused invalid URLs and unmigrated schemas without disclosing configuration.", flush=True)
    migration_env = os.environ.copy()
    migration_env["ZOBBA_MIGRATION_DATABASE_URL"] = migration
    for _ in range(2):
        run([str(binaries / "zobba-cli"), "migrate", "--runtime-role", runtime_role], env=migration_env)
    print("Explicit CLI migration succeeded twice.", flush=True)
    proxy = DatabaseProxy(runtime)
    proxy.start()
    processes = []
    try:
        with tempfile.TemporaryDirectory(prefix="zobba-smoke-") as logs:
            with contextlib.ExitStack() as stack:
                service_logs = []
                for service in ("api", "worker"):
                    port = free_port()
                    env = runtime_env | {
                        "ZOBBA_RUNTIME_DATABASE_URL": proxy.url,
                        f"ZOBBA_{service.upper()}_BIND": f"127.0.0.1:{port}",
                    }
                    log = stack.enter_context(open(Path(logs) / f"{service}.log", "w+"))
                    service_logs.append((service, log))
                    process = subprocess.Popen(
                        [str(binaries / f"zobba-{service}")], cwd=ROOT, env=env,
                        stdout=log, stderr=log,
                    )
                    processes.append((process, service, port))
                    wait_health(process, service, port, ready=True)
                print("API and worker returned exact live/ready health responses.", flush=True)
                proxy.pause()
                for process, service, port in processes:
                    wait_health(process, service, port, ready=False)
                print("Database connection loss returned 503 readiness; both processes stayed live.", flush=True)
                original_pids = [process.pid for process, _, _ in processes]
                proxy.resume()
                for process, service, port in processes:
                    wait_health(process, service, port, ready=True)
                require([process.pid for process, _, _ in processes] == original_pids, "readiness recovery replaced a process")
                print("The same API and worker processes recovered readiness after database connections resumed.", flush=True)
                for service, log in service_logs:
                    log.seek(0)
                    lines = [line for line in log.read().splitlines() if line]
                    allowed = {
                        f"{service}: {code}" for code in (
                            "ready", "database_unavailable", "schema_mismatch",
                            "unsafe_runtime_role", "unsupported_postgres",
                        )
                    }
                    if service == "worker":
                        allowed.update(f"worker: {code}" for code in (
                            "discovery_failed", "coordination_failed", "consumption_uncertain",
                            "delivery_release_failed", "authority_failed", "receipt_write_failed",
                            "receipt_retries_exhausted", "reconciliation_failed", "runner_failed",
                            "coordinator_failed", "shutdown_timeout", "process_join_unconfirmed",
                            "process_start_failed",
                        ))
                    require(all(line in allowed for line in lines), f"{service} logged a non-allowlisted field")
                    require(
                        f"{service}: ready" in lines and f"{service}: database_unavailable" in lines,
                        f"{service} readiness/loss telemetry was not observed",
                    )
                print("Startup and dependency-loss telemetry contained only allowlisted service/error codes.", flush=True)
    finally:
        proxy.close()
        for process, _, _ in processes:
            process.terminate()
        for process, _, _ in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    print("Zobba process smoke passed.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        # Never interpolate URLs, driver exceptions or child process output.
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(f"Zobba smoke failed: {message}", file=sys.stderr)
        sys.exit(1)

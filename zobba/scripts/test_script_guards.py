#!/usr/bin/env python3
"""Regression tests for destructive-smoke guards and workspace isolation.

Uses temporary source fixtures, deterministic DNS, and a local TCP echo server;
it never connects to PostgreSQL or runs migrations.
"""

from __future__ import annotations

import importlib.util
import json
import os
import socket
import socketserver
import sys
import tempfile
import threading
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
SCRIPTS = Path(__file__).resolve().parent


def load_script(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


smoke = load_script("zobba_smoke_guards", "smoke.py")
boundaries = load_script("zobba_boundary_guards", "check-boundaries.py")


def fake_getaddrinfo(host, port, *args, **kwargs):
    """Provide aliases without depending on a machine's DNS or IPv6 support."""
    records = {
        "localhost": ["127.0.0.1", "::1"],
        "127.0.0.1": ["127.0.0.1"],
        "::1": ["::1"],
        "::ffff:127.0.0.1": ["::ffff:127.0.0.1"],
        "test-db.internal": ["192.0.2.10"],
        "test-db-alias.internal": ["192.0.2.10"],
        "mixed-db.internal": ["192.0.2.10", "192.0.2.20"],
        "other-db.internal": ["192.0.2.20"],
    }
    if host not in records:
        raise socket.gaierror("unresolvable host")
    return [
        (
            socket.AF_INET6 if ":" in address else socket.AF_INET,
            socket.SOCK_STREAM,
            socket.IPPROTO_TCP,
            "",
            (address, port, 0, 0) if ":" in address else (address, port),
        )
        for address in records[host]
    ]


class DatabaseUrlGuardTests(unittest.TestCase):
    migration = "postgresql://migration:SECRET_MIGRATION@test-db.internal/zobba_test"
    runtime = "postgresql://runtime:SECRET_RUNTIME@test-db.internal/zobba_test"

    def setUp(self):
        self.environment = {
            "ZOBBA_TEST_MIGRATION_DATABASE_URL": self.migration,
            "ZOBBA_TEST_RUNTIME_DATABASE_URL": self.runtime,
        }
        self.enterContext(mock.patch.dict(os.environ, self.environment, clear=True))
        self.enterContext(mock.patch.object(smoke.socket, "getaddrinfo", side_effect=fake_getaddrinfo))

    def assert_refused(self, **overrides):
        with mock.patch.dict(os.environ, self.environment | overrides, clear=True):
            with self.assertRaises(RuntimeError) as failure:
                smoke.test_urls()
        diagnostic = str(failure.exception)
        for sensitive in ("SECRET_MIGRATION", "SECRET_RUNTIME", "SECRET_DEVELOPMENT", "postgresql://"):
            self.assertNotIn(sensitive, diagnostic)
        return diagnostic

    def test_distinct_roles_on_a_dedicated_database_are_accepted(self):
        self.assertEqual(smoke.test_urls(), (self.migration, self.runtime, "runtime"))

    def test_optional_admin_url_can_use_any_role_on_the_same_test_database(self):
        for role in ("admin", "migration", "runtime"):
            with self.subTest(role=role):
                admin = f"postgresql://{role}:SECRET_ADMIN@test-db-alias.internal:5432/zobba%5Ftest"
                with mock.patch.dict(os.environ, {"ZOBBA_TEST_ADMIN_DATABASE_URL": admin}):
                    self.assertEqual(smoke.test_urls(), (self.migration, self.runtime, "runtime"))

    def test_optional_admin_url_cannot_change_database_endpoint_or_query_routing(self):
        admin = "postgresql://admin:SECRET_ADMIN@test-db.internal/zobba_test"
        for candidate in (
            admin.replace("zobba_test", "different_test"),
            admin.replace("zobba_test", "zobba_dev"),
            admin.replace("test-db.internal", "other-db.internal"),
            admin.replace("test-db.internal", "test-db.internal:5433"),
            admin + "?host=other-db.internal",
            admin + "?dbname=different_test",
            admin + "?service=development",
        ):
            with self.subTest(candidate=candidate.split("@", 1)[1]):
                diagnostic = self.assert_refused(ZOBBA_TEST_ADMIN_DATABASE_URL=candidate)
                self.assertNotIn("SECRET_ADMIN", diagnostic)

    def test_identity_decodes_database_and_username_and_defaults_port(self):
        addresses, port, database, username = smoke.database_identity(
            "postgres://run%74ime:SECRET_RUNTIME@test-db.internal/zobba%5Ftest"
        )
        self.assertEqual(addresses, frozenset({"192.0.2.10"}))
        self.assertEqual((port, database, username), (5432, "zobba_test", "runtime"))

    def test_dns_aliases_and_percent_encoded_names_address_the_same_database(self):
        runtime = "postgres://run%74ime:SECRET_RUNTIME@test-db-alias.internal:5432/zobba%5Ftest"
        with mock.patch.dict(os.environ, {"ZOBBA_TEST_RUNTIME_DATABASE_URL": runtime}):
            self.assertEqual(smoke.test_urls(), (self.migration, runtime, "runtime"))

    def test_loopback_spellings_are_equivalent(self):
        for migration_host in ("localhost", "127.0.0.1", "[::1]", "[::ffff:127.0.0.1]"):
            for runtime_host in ("localhost", "127.0.0.1", "[::1]", "[::ffff:127.0.0.1]"):
                with self.subTest(migration_host=migration_host, runtime_host=runtime_host):
                    migration = f"postgresql://migration:SECRET_MIGRATION@{migration_host}/zobba_test"
                    runtime = f"postgresql://runtime:SECRET_RUNTIME@{runtime_host}/zobba_test"
                    with mock.patch.dict(os.environ, {
                        "ZOBBA_TEST_MIGRATION_DATABASE_URL": migration,
                        "ZOBBA_TEST_RUNTIME_DATABASE_URL": runtime,
                    }):
                        self.assertEqual(smoke.test_urls(), (migration, runtime, "runtime"))

    def test_pgport_is_used_only_when_the_url_omits_a_port(self):
        with mock.patch.dict(os.environ, {"PGPORT": "5433"}):
            self.assertEqual(smoke.database_identity(self.runtime)[1], 5433)
            explicit = self.runtime.replace("test-db.internal", "test-db.internal:5434")
            self.assertEqual(smoke.database_identity(explicit)[1], 5434)
            self.assert_refused(ZOBBA_TEST_RUNTIME_DATABASE_URL=explicit, PGPORT="5433")

    def test_invalid_pgport_and_pgoptions_are_refused(self):
        for port in ("invalid", "0", "70000"):
            with self.subTest(port=port):
                self.assert_refused(PGPORT=port)
        self.assert_refused(PGOPTIONS="-c search_path=legacy")

    def test_development_database_aliases_are_refused_for_both_bindings(self):
        for name in ("ZOBBA_MIGRATION_DATABASE_URL", "ZOBBA_RUNTIME_DATABASE_URL"):
            for host in ("test-db-alias.internal", "mixed-db.internal"):
                with self.subTest(name=name, host=host):
                    self.assert_refused(**{
                        name: f"postgresql://development:SECRET_DEVELOPMENT@{host}:5432/zobba%5Ftest"
                    })

    def test_development_loopback_aliases_are_refused(self):
        migration = "postgresql://migration:SECRET_MIGRATION@127.0.0.1/zobba_test"
        runtime = "postgresql://runtime:SECRET_RUNTIME@127.0.0.1/zobba_test"
        for host in ("localhost", "[::1]"):
            with self.subTest(host=host):
                self.assert_refused(
                    ZOBBA_TEST_MIGRATION_DATABASE_URL=migration,
                    ZOBBA_TEST_RUNTIME_DATABASE_URL=runtime,
                    ZOBBA_RUNTIME_DATABASE_URL=f"postgresql://development:SECRET_DEVELOPMENT@{host}/zobba_test",
                )

    def test_distinct_development_database_is_accepted(self):
        for development in (
            "postgresql://development:SECRET_DEVELOPMENT@test-db.internal/zobba_dev",
            "postgresql://development:SECRET_DEVELOPMENT@other-db.internal/zobba_test",
            "postgresql://development:SECRET_DEVELOPMENT@test-db.internal:5433/zobba_test",
        ):
            with self.subTest(development=urllib.parse.urlsplit(development).hostname):
                with mock.patch.dict(os.environ, {"ZOBBA_RUNTIME_DATABASE_URL": development}):
                    self.assertEqual(smoke.test_urls(), (self.migration, self.runtime, "runtime"))

    def test_mismatched_database_endpoint_port_or_name_is_refused(self):
        for runtime in (
            self.runtime.replace("test-db.internal", "other-db.internal"),
            self.runtime.replace("test-db.internal", "test-db.internal:5433"),
            self.runtime.replace("zobba_test", "different_test"),
        ):
            with self.subTest(runtime=runtime.split("@", 1)[1]):
                self.assert_refused(ZOBBA_TEST_RUNTIME_DATABASE_URL=runtime)

    def test_percent_encoded_equivalent_roles_are_refused(self):
        self.assert_refused(
            ZOBBA_TEST_RUNTIME_DATABASE_URL=self.runtime.replace("runtime:", "migra%74ion:")
        )

    def test_only_bounded_lowercase_runtime_role_names_are_accepted(self):
        for role in ("Runtime", "runtime-role", "runtime%20role", "a" * 64, "", "1runtime"):
            with self.subTest(role=role):
                self.assert_refused(
                    ZOBBA_TEST_RUNTIME_DATABASE_URL=self.runtime.replace("runtime:", f"{role}:")
                )

    def test_missing_configuration_and_non_disposable_names_are_refused(self):
        for name in self.environment:
            with self.subTest(name=name):
                self.assert_refused(**{name: ""})
        for database in ("zobba", "zobba_test/other", "", "zobba_test%2Fother"):
            with self.subTest(database=database):
                self.assert_refused(
                    ZOBBA_TEST_MIGRATION_DATABASE_URL=self.migration.replace("zobba_test", database),
                    ZOBBA_TEST_RUNTIME_DATABASE_URL=self.runtime.replace("zobba_test", database),
                )

    def test_migration_role_and_host_must_also_be_explicit(self):
        for migration in (
            "postgresql://test-db.internal/zobba_test",
            "postgresql:///zobba_test",
            "postgresql://migration:SECRET_MIGRATION@%2Ftmp/zobba_test",
        ):
            with self.subTest(case=migration.split(":", 1)[0]):
                self.assert_refused(ZOBBA_TEST_MIGRATION_DATABASE_URL=migration)

    def test_endpoint_database_service_user_and_unknown_query_overrides_are_refused(self):
        keys = (
            "host", "hostaddr", "port", "dbname", "database", "user", "username", "password",
            "service", "servicefile", "passfile", "options", "search_path", "target_session_attrs",
            "host-name", "host_name", "user-name", "user_name", "database-name", "database_name",
            "socket", "sslrootcert", "application-name", "unknown_future_option", "HOST", "DBNAME", "USER",
        )
        for binding in self.environment:
            for key in keys:
                with self.subTest(binding=binding, key=key):
                    query = urllib.parse.urlencode({key: "override"})
                    self.assert_refused(**{binding: self.environment[binding] + "?" + query})
        for key in ("%68ost", "%64bname", "%75ser", "%73ervice"):
            with self.subTest(encoded_key=key):
                self.assert_refused(ZOBBA_TEST_RUNTIME_DATABASE_URL=self.runtime + f"?{key}=override")

    def test_development_url_query_overrides_are_also_refused(self):
        for key in ("host", "hostaddr", "port", "dbname", "user", "service"):
            with self.subTest(key=key):
                self.assert_refused(
                    ZOBBA_RUNTIME_DATABASE_URL=(
                        "postgresql://development:SECRET_DEVELOPMENT@other-db.internal/zobba_dev"
                        f"?{key}=override"
                    )
                )

    def test_safe_query_options_are_accepted_without_changing_identity(self):
        for key, value in (
            ("sslmode", "disable"), ("ssl-mode", "require"),
            ("application_name", "zobba-smoke"),
        ):
            with self.subTest(key=key):
                runtime = self.runtime + "?" + urllib.parse.urlencode({key: value})
                with mock.patch.dict(os.environ, {"ZOBBA_TEST_RUNTIME_DATABASE_URL": runtime}):
                    self.assertEqual(smoke.test_urls(), (self.migration, runtime, "runtime"))

    def test_ambiguous_queries_fragments_and_invalid_escapes_are_refused(self):
        for suffix in (
            "?sslmode=disable&sslmode=require", "?sslmode", "?=override",
            "#ignored", "?application_name=bad%GG", "?application_name=bad value",
        ):
            with self.subTest(suffix=suffix):
                self.assert_refused(ZOBBA_TEST_RUNTIME_DATABASE_URL=self.runtime + suffix)

    def test_malformed_urls_and_resolution_failures_have_credential_safe_errors(self):
        for runtime in (
            self.runtime.replace("test-db.internal", "missing.internal"),
            self.runtime.replace("test-db.internal", "test-db.internal:not-a-port"),
            self.runtime.replace("test-db.internal", "test-db.internal:70000"),
            self.runtime.replace("postgresql:", "https:"),
            "postgresql://runtime:SECRET_RUNTIME@[broken/zobba_test",
        ):
            with self.subTest(case=runtime.rsplit("/", 1)[-1]):
                self.assert_refused(ZOBBA_TEST_RUNTIME_DATABASE_URL=runtime)

    def test_dns_error_content_is_never_in_the_diagnostic(self):
        with mock.patch.object(smoke.socket, "getaddrinfo", side_effect=socket.gaierror("SECRET_RUNTIME")):
            self.assert_refused()


class FixtureWorkspaceGuardTests(unittest.TestCase):
    def setUp(self):
        temporary = self.enterContext(tempfile.TemporaryDirectory(prefix="zobba-fixture-guard-"))
        self.root = Path(temporary)
        self.enterContext(mock.patch.object(boundaries, "ROOT", self.root))
        self.enterContext(mock.patch.object(boundaries, "ERRORS", []))
        (self.root / ".nvmrc").write_text("24.20.0\n")
        (self.root / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
        (self.root / "pnpm-workspace.yaml").write_text("packages:\n  - web\n  - fixtures/oidc\n")
        self.manifest("package.json", {"name": "zobba-workspace", "packageManager": "pnpm@11.25.0"})
        self.manifest("web/package.json", {"name": "@zobba/web"})
        self.manifest("fixtures/oidc/package.json", {"name": "@zobba/oidc-fixture", "dependencies": {"oidc-provider": "9.12.2"}})

    def manifest(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def test_separate_owned_idp_fixture_is_accepted(self):
        boundaries.node_graph()
        self.assertEqual(boundaries.ERRORS, [])

    def test_web_cannot_depend_on_fixture_or_idp_implementation(self):
        for name, version in (("oidc-provider", "9.12.2"), ("@zobba/oidc-fixture", "workspace:*")):
            with self.subTest(dependency=name):
                boundaries.ERRORS.clear()
                self.manifest("web/package.json", {"name": "@zobba/web", "dependencies": {name: version}})
                boundaries.node_graph()
                self.assertTrue(any("fixture infrastructure only" in error for error in boundaries.ERRORS))

    def test_additional_workspace_package_is_refused(self):
        (self.root / "pnpm-workspace.yaml").write_text("packages:\n  - web\n  - fixtures/oidc\n  - ../legacy\n")
        boundaries.node_graph()
        self.assertTrue(any("exactly web" in error for error in boundaries.ERRORS))


class SourceBoundaryGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = self.enterContext(tempfile.TemporaryDirectory(prefix="zobba-guard-test-"))
        self.root = Path(self.temporary) / "zobba"
        self.root.mkdir()
        self.enterContext(mock.patch.object(boundaries, "ROOT", self.root))
        self.enterContext(mock.patch.object(boundaries, "ERRORS", []))
        self.write("crates/application/Cargo.toml", '[package]\nname = "zobba-application"\n')
        self.write("crates/application/src/owned.rs", "pub const OWNED: bool = true;\n")
        self.write("web/src/owned.ts", "export const owned = true;\n")
        self.write_json("web/tsconfig.json", {"compilerOptions": {}, "include": ["src"]})
        legacy = Path(self.temporary) / "legacy"
        legacy.mkdir()
        (legacy / "backend.rs").write_text("pub const LEGACY: bool = true;\n")
        (legacy / "backend.ts").write_text("export const legacy = true;\n")
        (legacy / "tsconfig.json").write_text("{}\n")

    def write(self, relative, content):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        return target

    def write_json(self, relative, data):
        return self.write(relative, json.dumps(data))

    def check(self):
        boundaries.ERRORS.clear()
        boundaries.source_paths()
        return list(boundaries.ERRORS)

    def assert_refused(self, label):
        errors = self.check()
        self.assertTrue(errors, f"unsafe {label} was accepted")
        self.assertTrue(any(label in error for error in errors), errors)

    def test_owned_literal_rust_and_javascript_imports_are_accepted(self):
        self.write("crates/application/src/lib.rs", '''
include!("owned.rs");
const DATA: &str = include_str!(r#"owned.rs"#);
const BYTES: &[u8] = include_bytes!(r##"owned.rs"##);
#[path = r#"owned.rs"#] mod own;
''')
        self.write("web/src/index.ts", '''
import { owned } from './owned';
export { owned } from './owned';
const lazy = import('./owned');
const common = require('./owned');
''')
        self.assertEqual(self.check(), [])

    def test_owned_rust_concatenation_and_manifest_directory_are_accepted(self):
        self.write("crates/application/src/lib.rs", '''
include!(concat!("own", "ed.rs"));
const DATA: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/owned.rs"));
''')
        self.assertEqual(self.check(), [])

    def test_rust_literal_raw_literal_and_path_attribute_escapes_are_refused(self):
        for source in (
            'include!("../../../../legacy/backend.rs");',
            'include_str!(r"../../../../legacy/backend.rs");',
            'include_bytes!(r###"../../../../legacy/backend.rs"###);',
            '#[path = r#"../../../../legacy/backend.rs"#] mod legacy;',
            'include!(concat!("../../", "../../legacy/backend.rs"));',
            'include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../legacy/backend.rs"));',
        ):
            with self.subTest(source=source):
                self.write("crates/application/src/lib.rs", source)
                self.assert_refused("crates/application/src/lib.rs")

    def test_rust_dynamic_include_paths_are_refused(self):
        for source in (
            'include!(env!("EXTERNAL_RUST_SOURCE"));',
            'include_str!(SOURCE_PATH);',
            'include_bytes!(concat!(env!("OUT_DIR"), "/generated.bin"));',
            'include!(format!("{}/legacy.rs", root));',
        ):
            with self.subTest(source=source):
                self.write("crates/application/src/lib.rs", source)
                self.assert_refused("crates/application/src/lib.rs")

    def test_rust_route_metadata_is_allowed_but_conditional_source_paths_are_checked(self):
        self.write("crates/application/src/lib.rs", '''
#[utoipa::path(get, path = "/health/live", responses((status = 200)))]
pub async fn live() {}
''')
        self.assertEqual(self.check(), [])
        self.write("crates/application/src/lib.rs", '''
#[cfg_attr(feature = "legacy", path = r"../../../../legacy/backend.rs")]
mod borrowed;
''')
        self.assert_refused("crates/application/src/lib.rs")

    def test_static_javascript_import_escapes_and_legacy_packages_are_refused(self):
        for source in (
            "import { legacy } from '../../../legacy/backend';",
            "export { legacy } from '../../../legacy/backend';",
            "const legacy = import('../../../legacy/backend');",
            "const legacy = require('../../../legacy/backend');",
            "import '@intellifin/domain';",
        ):
            with self.subTest(source=source):
                self.write("web/src/index.ts", source)
                self.assert_refused("web/src/index.ts")

    def test_dynamic_javascript_imports_and_requires_are_refused(self):
        for source in (
            "const legacy = import(sourcePath);",
            "const legacy = import(prefix + '/legacy');",
            "const legacy = import(`../../../${moduleName}`);",
            "const legacy = require(sourcePath);",
        ):
            with self.subTest(source=source):
                self.write("web/src/index.ts", source)
                self.assert_refused("web/src/index.ts")

    def test_escaped_javascript_static_imports_are_refused_as_unresolved(self):
        for source in (
            r'import "\x2e\x2e/../../legacy/backend.js";',
            r'import { legacy } from "\x2e\x2e/../../legacy/backend.js";',
        ):
            with self.subTest(source=source):
                self.write("web/src/index.ts", source)
                self.assert_refused("web/src/index.ts")
                self.assertTrue(any("unresolved" in error for error in boundaries.ERRORS), boundaries.ERRORS)

    def test_source_symlink_escape_is_refused(self):
        (self.root / "web/src/borrowed.ts").symlink_to(Path(self.temporary) / "legacy/backend.ts")
        self.assert_refused("web/src/borrowed.ts")

    def test_unimported_source_directory_symlink_escape_is_refused(self):
        (self.root / "web/src/borrowed").symlink_to(Path(self.temporary) / "legacy", target_is_directory=True)
        self.assert_refused("web/src/borrowed")

    def test_owned_typescript_configuration_paths_are_accepted(self):
        self.write_json("web/tsconfig.base.json", {"compilerOptions": {"strict": True}})
        self.write_json("web/tsconfig.child.json", {"include": ["src"]})
        self.write_json("web/tsconfig.json", {
            "extends": "./tsconfig.base.json",
            "compilerOptions": {"baseUrl": ".", "paths": {"@owned/*": ["src/*"]}},
            "include": ["src/**/*.ts"],
            "files": ["src/owned.ts"],
            "references": [{"path": "./tsconfig.child.json"}],
        })
        self.assertEqual(self.check(), [])

    def test_typescript_resolution_configuration_cannot_escape_workspace(self):
        for fragment in (
            {"compilerOptions": {"baseUrl": "../../legacy"}},
            {"compilerOptions": {"paths": {"@legacy/*": ["../../legacy/*"]}}},
            {"compilerOptions": {"baseUrl": ".", "paths": {"@legacy/*": ["../../legacy/*"]}}},
            {"extends": "../../legacy/tsconfig.json"},
            {"extends": ["../../legacy/tsconfig.json"]},
            {"include": ["../../legacy/**/*.ts"]},
            {"files": ["../../legacy/backend.ts"]},
            {"references": [{"path": "../../legacy"}]},
        ):
            with self.subTest(fragment=fragment):
                self.write_json("web/tsconfig.json", fragment)
                label = "TypeScript configuration" if "extends" in fragment or "references" in fragment else "web/tsconfig.json"
                self.assert_refused(label)

    def test_typescript_absolute_paths_and_symlink_aliases_cannot_escape(self):
        legacy = Path(self.temporary) / "legacy"
        (self.root / "web/borrowed").symlink_to(legacy, target_is_directory=True)
        for path in (str(legacy / "*"), "borrowed/*"):
            with self.subTest(path=path):
                self.write_json("web/tsconfig.json", {"compilerOptions": {"paths": {"@legacy/*": [path]}}})
                self.assert_refused("web/tsconfig.json")

    def test_extended_local_typescript_config_is_checked(self):
        self.write_json("web/tsconfig.json", {"extends": "./tsconfig.shared.json"})
        self.write_json("web/tsconfig.shared.json", {"compilerOptions": {"paths": {"legacy": ["../../legacy/backend"]}}})
        self.assert_refused("web/tsconfig.shared.json")

    def test_inherited_typescript_baseurl_cannot_rebase_child_aliases_outside_workspace(self):
        self.write_json("tsconfig.base.json", {"compilerOptions": {"baseUrl": "."}})
        self.write("web/src/index.ts", "import '@legacy/backend';\n")
        for inherited in ("../tsconfig.base.json", ["../tsconfig.base.json"]):
            with self.subTest(extends=inherited):
                self.write_json("web/tsconfig.json", {
                    "extends": inherited,
                    "compilerOptions": {"paths": {"@legacy/*": ["../legacy/*"]}},
                })
                self.assert_refused("tsconfig")

    def test_transitive_typescript_baseurl_inheritance_cannot_hide_an_alias_escape(self):
        self.write_json("tsconfig.base.json", {"compilerOptions": {"baseUrl": "."}})
        self.write_json("web/tsconfig.shared.json", {"extends": "../tsconfig.base.json"})
        self.write_json("web/tsconfig.json", {
            "extends": "./tsconfig.shared.json",
            "compilerOptions": {"paths": {"@legacy/*": ["../legacy/*"]}},
        })
        self.write("web/src/index.ts", "import '@legacy/backend';\n")
        self.assert_refused("tsconfig")

    def test_vite_alias_configuration_requires_explicit_resolver_support(self):
        for alias in (
            "alias: { '@legacy': '../../legacy' }",
            "alias: [{ find: '@legacy', replacement: '../../legacy' }]",
            "'alias': { '@owned': './src' }",
        ):
            with self.subTest(alias=alias):
                self.write("web/vite.config.ts", f"export default {{ resolve: {{ {alias} }} }};\n")
                self.assert_refused("web/vite.config.ts")

    def test_vite_indirect_default_exports_cannot_hide_external_aliases(self):
        self.write("web/shared.config.ts", "export default " + json.dumps({
            "resolve": {"alias": {"@legacy": str(Path(self.temporary) / "legacy")}},
        }) + ";\n")
        for source in (
            "export { default } from './shared.config';",
            "import config from './shared.config'; export default config;",
        ):
            with self.subTest(source=source):
                self.write("web/vite.config.ts", source)
                self.assert_refused("web/vite.config.ts")

    def test_vite_direct_defineconfig_default_export_is_accepted(self):
        self.write("web/vite.config.ts", '''
import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5173 } });
''')
        self.assertEqual(self.check(), [])

    def test_vite_defineconfig_must_be_the_named_import_from_vite(self):
        external_alias = json.dumps(str(Path(self.temporary) / "legacy"))
        self.write("web/shared.config.ts", (
            "export function defineConfig(config) { return { ...config, "
            "resolve: { alias: { '@legacy': " + external_alias + " } } }; }\n"
        ))
        for source in (
            "import { defineConfig } from './shared.config'; export default defineConfig({plugins: []});",
            "export default defineConfig({plugins: []});",
            "function defineConfig(config) { return config; } export default defineConfig({plugins: []});",
        ):
            with self.subTest(source=source):
                self.write("web/vite.config.ts", source)
                self.assert_refused("web/vite.config.ts")


class EchoHandler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            while data := self.request.recv(4096):
                self.request.sendall(data)
        except OSError:
            pass


class EchoServer(socketserver.ThreadingTCPServer):
    daemon_threads = True


class DatabaseProxyRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.server = EchoServer(("127.0.0.1", 0), EchoHandler)
        self.server_thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True,
        )
        self.server_thread.start()
        self.addCleanup(self.close_server)
        target_port = self.server.server_address[1]
        self.proxy = smoke.DatabaseProxy(f"postgresql://runtime:SECRET_RUNTIME@127.0.0.1:{target_port}/zobba_test")
        self.proxy.start()
        self.addCleanup(self.proxy.close)

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)

    def connection(self):
        client = socket.create_connection(("127.0.0.1", self.proxy.port), timeout=2)
        self.addCleanup(client.close)
        client.settimeout(2)
        return client

    def assert_echo(self, client, payload):
        client.sendall(payload)
        received = b""
        while len(received) < len(payload):
            chunk = client.recv(len(payload) - len(received))
            self.assertTrue(chunk, "proxy closed a healthy connection")
            received += chunk
        self.assertEqual(received, payload)

    def assert_disconnected(self, client):
        try:
            client.sendall(b"must-not-reach-database")
            self.assertEqual(client.recv(4096), b"")
        except (ConnectionResetError, BrokenPipeError):
            pass

    def test_pause_drops_existing_connections_and_resume_uses_same_port(self):
        original_port = self.proxy.port
        original_url = self.proxy.url
        active = self.connection()
        self.assert_echo(active, b"before-pause")
        self.proxy.pause()
        self.assert_disconnected(active)
        self.assert_disconnected(self.connection())
        self.proxy.resume()
        self.assertEqual(self.proxy.port, original_port)
        self.assertEqual(self.proxy.url, original_url)
        self.assert_echo(self.connection(), b"after-resume")

    def test_proxy_can_recover_more_than_once_and_close_is_idempotent(self):
        for cycle in range(2):
            with self.subTest(cycle=cycle):
                active = self.connection()
                self.assert_echo(active, b"healthy")
                self.proxy.pause()
                self.assert_disconnected(active)
                self.proxy.resume()
        self.assert_echo(self.connection(), b"recovered")
        self.proxy.close()
        self.proxy.close()
        self.assertFalse(self.proxy.thread.is_alive())


if __name__ == "__main__":
    unittest.main()

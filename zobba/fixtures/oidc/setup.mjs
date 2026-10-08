#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixtureDirectory = resolve(process.env.ZOBBA_FIXTURE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '.local'));
const expectedFiles = ['ca.pem', 'ca-key.pem', 'app-cert.pem', 'app-key.pem', 'idp-cert.pem', 'idp-key.pem', 'fixture.json', 'env.sh'];
const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

export function setup(directory = fixtureDirectory) {
  if (existsSync(directory)) {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('fixture_directory_invalid');
    for (const name of expectedFiles) {
      const path = join(directory, name);
      if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('fixture_incomplete_remove_local_directory_to_regenerate');
      chmodSync(path, 0o600);
    }
    if (JSON.parse(readFileSync(join(directory, 'fixture.json'), 'utf8')).version !== 1) throw new Error('fixture_version_unsupported');
    for (const name of ['ca.pem', 'app-cert.pem', 'idp-cert.pem']) openssl('x509', '-checkend', '86400', '-noout', '-in', join(directory, name));
    openssl('verify', '-CAfile', join(directory, 'ca.pem'), '-verify_hostname', 'localhost', join(directory, 'app-cert.pem'));
    openssl('verify', '-CAfile', join(directory, 'ca.pem'), '-verify_ip', '127.0.0.1', join(directory, 'idp-cert.pem'));
    chmodSync(directory, 0o700);
    return directory;
  }
  mkdirSync(dirname(directory), { recursive: true });
  const temporary = `${directory}-tmp-${randomUUID()}`;
  mkdirSync(temporary, { mode: 0o700 });
  const path = (name) => join(temporary, name);
  try {
    openssl('req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '30', '-subj', '/CN=Zobba synthetic fixture CA', '-keyout', path('ca-key.pem'), '-out', path('ca.pem'), '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
    for (const [name, hostname] of [['app', 'localhost'], ['idp', '127.0.0.1']]) {
      openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', `/CN=${hostname}`, '-keyout', path(`${name}-key.pem`), '-out', path(`${name}.csr`));
      writeFileSync(path(`${name}.ext`), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n', { mode: 0o600 });
      openssl('x509', '-req', '-in', path(`${name}.csr`), '-CA', path('ca.pem'), '-CAkey', path('ca-key.pem'), '-set_serial', `0x${randomBytes(16).toString('hex')}`, '-days', '14', '-sha256', '-extfile', path(`${name}.ext`), '-out', path(`${name}-cert.pem`));
      openssl('verify', '-CAfile', path('ca.pem'), path(`${name}-cert.pem`));
      rmSync(path(`${name}.csr`));
      rmSync(path(`${name}.ext`));
    }
    const keys = Array.from({ length: 3 }, () => {
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      return { ...privateKey.export({ format: 'jwk' }), use: 'sig', alg: 'RS256', kid: randomUUID() };
    });
    const config = {
      version: 1,
      issuer: 'https://127.0.0.1:9443',
      public_origin: 'https://localhost:5173',
      redirect_uri: 'https://localhost:5173/api/auth/callback',
      client_id: 'zobba-local',
      client_secret: randomBytes(32).toString('base64url'),
      admin_secret: randomBytes(32).toString('base64url'),
      account_password: randomBytes(24).toString('base64url'),
      cookie_keys: [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')],
      keys,
      accounts: ['auditor-a', 'manager-a', 'auditor-b', 'admin-only', 'admin-b-only', 'unassigned'],
    };
    writeFileSync(path('fixture.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    const variables = {
      ZOBBA_LOCAL_FIXTURES: '1',
      ZOBBA_OIDC_ISSUER: config.issuer,
      ZOBBA_OIDC_CLIENT_ID: config.client_id,
      ZOBBA_OIDC_CLIENT_SECRET: config.client_secret,
      ZOBBA_PUBLIC_ORIGIN: config.public_origin,
      ZOBBA_OIDC_REDIRECT_URI: config.redirect_uri,
      ZOBBA_OIDC_CA_FILE: join(directory, 'ca.pem'),
      ZOBBA_LOCAL_TLS_CERT: join(directory, 'app-cert.pem'),
      ZOBBA_LOCAL_TLS_KEY: join(directory, 'app-key.pem'),
      ZOBBA_FIXTURE_DIR: directory,
    };
    writeFileSync(path('env.sh'), `# Generated synthetic local credentials. Do not commit or print.\n${Object.entries(variables).map(([name, value]) => `export ${name}=${shellQuote(value)}`).join('\n')}\n`, { mode: 0o600 });
    for (const name of expectedFiles) chmodSync(path(name), 0o600);
    renameSync(temporary, directory);
    return directory;
  } catch {
    rmSync(temporary, { recursive: true, force: true });
    throw new Error('fixture_setup_failed');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const directory = setup();
    console.log(`Synthetic OIDC fixture prepared; source ${shellQuote(join(directory, 'env.sh'))} in each shell.`);
  } catch (error) {
    const safeErrors = new Set(['fixture_directory_invalid', 'fixture_incomplete_remove_local_directory_to_regenerate', 'fixture_version_unsupported']);
    console.error(safeErrors.has(error.message) ? error.message : 'fixture_setup_failed');
    process.exitCode = 1;
  }
}

"""Build the review/download package. Run in the repository; requires Pandoc."""
from pathlib import Path
from hashlib import sha256
import re
import subprocess
import urllib.parse
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PLAN = ROOT / '_bmad-output/planning-artifacts'
SELECTION = [
    ROOT / 'README.md', ROOT / 'AGENTS.md', ROOT / 'CLAUDE.md',
    PLAN / 'ACTIVE-BASELINE.md', PLAN / 'sprint-change-proposal-2026-09-30.md',
    PLAN / 'epics.md',
    PLAN / 'zobba-build-plan-2026-09-30',
    PLAN / 'zobba-operating-budget-2026-09-30',
    PLAN / 'zobba-product-architecture-2026-09-30',
    PLAN / 'prds/prd-IntelliFin Audit-2026-08-31',
    PLAN / 'architecture/architecture-IntelliFin Audit-2026-09-01',
    PLAN / 'ux-designs/ux-Zobba-2026-09-25',
    PLAN / 'ux-designs/ux-IntelliFin Audit-2026-09-01',
    PLAN / 'ux-designs/zobba-design-system-v1.0',
    ROOT / '_bmad-output/specs/spec-IntelliFin Audit',
    ROOT / '_bmad-output/implementation-artifacts/sprint-status.yaml',
    ROOT / '_bmad-output/implementation-artifacts/archive/pre-revision-3-2026-09-30',
]


def rebase_link(match):
    label, target = match.group(1), match.group(2)
    if re.match(r'^[a-z]+:', target) or target.startswith('#'):
        return match.group(0)
    path, marker, fragment = target.partition('#')
    resolved = (HERE / urllib.parse.unquote(path)).resolve()
    relative = resolved.relative_to(ROOT).as_posix()
    return f'[{label}]({urllib.parse.quote(relative, safe="/")}{marker}{fragment})'


def main():
    files = {}
    for selected in SELECTION:
        if not selected.exists():
            raise FileNotFoundError(selected)
        for path in sorted(selected.rglob('*')) if selected.is_dir() else [selected]:
            if not path.is_file() or path.is_symlink():
                continue
            if path.suffix in {'.zip', '.pyc'} or '__pycache__' in path.parts:
                continue
            if path == HERE / 'MANIFEST.sha256':
                continue
            files[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    start = re.sub(r'\[([^\]\n]+)\]\(([^)\n]+)\)', rebase_link,
                   (HERE / 'START-HERE.md').read_text())
    files['START-HERE.md'] = start.encode()
    html = subprocess.run(
        ['pandoc', '--from=gfm', '--to=html5', '--standalone',
         '--metadata', 'title=Zobba build handoff'],
        input=start, text=True, capture_output=True, check=True).stdout
    style = '<style>body{max-width:860px;margin:48px auto;padding:0 24px;font:17px/1.6 system-ui;color:#252420;background:#fbfaf7}h1,h2{line-height:1.2}a{color:#4936c8}code{font-size:.9em}header{display:none}</style>'
    files['START-HERE.html'] = html.replace('</head>', style + '</head>').encode()
    manifest = ''.join(f'{sha256(data).hexdigest()}  {name}\n'
                       for name, data in sorted(files.items())).encode()
    (HERE / 'MANIFEST.sha256').write_bytes(manifest)
    files['MANIFEST.sha256'] = manifest
    target = HERE / 'Zobba-Build-Handoff.zip'
    prefix = 'Zobba-Build-Handoff/'
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(prefix + name, date_time=(2026, 9, 30, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None, 'ZIP CRC failed'
        assert len(archive.namelist()) == len(files)
        for name, data in files.items():
            assert archive.read(prefix + name) == data, name
    print(f'{target.name}: {len(files)} files, {target.stat().st_size:,} bytes')
    print(f'SHA256 {sha256(target.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    main()

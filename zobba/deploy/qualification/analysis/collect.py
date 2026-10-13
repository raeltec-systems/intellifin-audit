# Trusted collection for one Zobba analysis attempt (Story 22.4). One script for
# both sandboxes, so they report the same facts for the same tree:
#
#   python3 -I collect.py local <per-file> <total> <files>
#       Test-only Docker sandbox: prints the manifest, with base64 contents, to
#       stdout (run with `docker exec` in the idle holder container).
#   python3 -I collect.py
#       Fargate `collect` container: reads /control/collect.json, uploads each
#       read file to its presigned slot and the manifest last.
#
# It reports lstat facts only (links are never followed) and never fails on a
# hostile entry: an unreadable entry is reported as kind "other", a name longer
# than the path bound is reported truncated and withheld as "too_long", and the
# entry count is bounded, so the manifest always fits its limit. A file whose
# bytes are not read carries the reason ("slots", "budget", "unreadable").
# The worker validates paths, types, sizes and SHA-256 again before registering.
import base64, json, os, stat, sys

ENTRIES_MAX = 1024  # zobba_domain::analysis::COLLECT_ENTRIES_MAX
PATH_BYTES_MAX = 256  # zobba_domain::analysis::COLLECT_PATH_BYTES_MAX
DEPTH_MAX = 16


def kind_of(mode):
    if stat.S_ISDIR(mode):
        return "directory"
    if stat.S_ISREG(mode):
        return "regular"
    if stat.S_ISLNK(mode):
        return "symlink"
    if stat.S_ISFIFO(mode):
        return "fifo"
    if stat.S_ISSOCK(mode):
        return "socket"
    if stat.S_ISCHR(mode) or stat.S_ISBLK(mode):
        return "device"
    return "other"


def read_file(full, info):
    """Exactly the lstat'ed regular file, or None. Reads at most size + 1."""
    try:
        fd = os.open(full, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return None
    try:
        again = os.fstat(fd)
        if not stat.S_ISREG(again.st_mode) or again.st_ino != info.st_ino:
            return None
        chunks, remaining = [], info.st_size + 1
        while remaining > 0:
            chunk = os.read(fd, min(remaining, 1 << 20))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)
    except OSError:
        return None
    finally:
        os.close(fd)


def inventory(root, per, total, files, store):
    """Walk `root` in sorted byte order. `store(entry, data, slot)` keeps the
    bytes of a read file and returns False if it could not."""
    entries = []
    state = {"truncated": False, "used": 0, "read_bytes": 0, "read_files": 0}

    def walk(relative, depth, parent):
        directory = os.path.join(root, relative) if relative else root
        try:
            names = sorted(os.listdir(directory))
        except OSError:
            if parent is not None:
                parent.update(kind="other", withheld="unreadable")
            return
        for name in names:
            if len(entries) >= ENTRIES_MAX:
                state["truncated"] = True
                return
            path = os.path.join(relative, name) if relative else name
            entry = {"path_hex": path[:PATH_BYTES_MAX].hex(), "kind": "other", "links": 0, "size": 0}
            entries.append(entry)
            if len(path) >= PATH_BYTES_MAX:
                entry["withheld"] = "too_long"
            full = os.path.join(root, path)
            try:
                info = os.lstat(full)
            except OSError:
                entry.setdefault("withheld", "unreadable")
                continue
            kind = kind_of(info.st_mode)
            entry.update(kind=kind, links=info.st_nlink, size=info.st_size)
            if kind == "regular":
                state["used"] += info.st_size
                if "withheld" not in entry and info.st_nlink == 1 and info.st_size <= per:
                    if state["read_files"] >= files:
                        entry["withheld"] = "slots"
                    elif state["read_bytes"] + info.st_size > total:
                        entry["withheld"] = "budget"
                    else:
                        data = read_file(full, info)
                        if data is None or not store(entry, data, state["read_files"]):
                            entry["withheld"] = "unreadable"
                        else:
                            state["read_files"] += 1
                            state["read_bytes"] += len(data)
            elif kind == "directory" and "withheld" not in entry and depth < DEPTH_MAX:
                walk(path, depth + 1, entry)

    walk(b"", 0, None)
    return entries, state["truncated"], state["used"]


def local(per, total, files):
    def store(entry, data, _slot):
        entry["content"] = base64.b64encode(data).decode()
        return True

    root = b"/output"
    entries, truncated, used = inventory(root, per, total, files, store)
    vfs = os.statvfs(root)
    json.dump(
        {"free": vfs.f_bavail * vfs.f_frsize, "used": used, "truncated": truncated, "entries": entries},
        sys.stdout,
    )


def upload(url, data):
    import urllib.request

    request = urllib.request.Request(url, data=data, method="PUT")
    urllib.request.urlopen(request, timeout=60).close()


def fargate():
    put = upload
    with open("/control/collect.json") as handle:
        collect = json.load(handle)
    slots = collect["slots"]

    def store(entry, data, slot):
        try:
            put(slots[slot], data)
        except Exception:
            return False
        entry["slot"] = slot
        return True

    total = int(collect["output_total_bytes"])
    entries, truncated, used = inventory(
        b"/output", int(collect["output_file_bytes"]), total, len(slots), store
    )
    manifest = {"full": used > total, "used": used, "truncated": truncated, "entries": entries}
    put(collect["manifest"], json.dumps(manifest).encode())


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "local":
        local(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
    elif len(sys.argv) == 1:
        # Logs carry only a fixed code: never a URL, path or byte of output.
        try:
            fargate()
        except Exception:
            print("zobba-collect: failed", file=sys.stderr)
            sys.exit(6)
    else:
        sys.exit(2)

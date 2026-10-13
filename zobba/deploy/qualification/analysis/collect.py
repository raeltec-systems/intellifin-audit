# Trusted collection for one Zobba analysis attempt (Story 22.4). Runs in the
# `collect` container after the program container has exited. It reports lstat
# facts (links are never followed) and uploads only regular, singly-linked files
# within the limits to their presigned slots, then the manifest last. The worker
# validates paths, types, sizes and SHA-256 again before any registration.
import json, os, stat, urllib.request

collect = json.load(open("/control/collect.json"))
slots = collect["slots"]
per = int(collect["output_file_bytes"])
budget = int(collect["output_total_bytes"])
root = b"/output"
entries, used, truncated = [], 0, False

def put(url, data):
    request = urllib.request.Request(url, data=data, method="PUT")
    urllib.request.urlopen(request, timeout=60).close()

def walk(relative, depth):
    global budget, used, truncated
    directory = os.path.join(root, relative) if relative else root
    for name in sorted(os.listdir(directory)):
        if len(entries) >= 1024:
            truncated = True
            return
        path = os.path.join(relative, name) if relative else name
        full = os.path.join(root, path)
        info = os.lstat(full)
        mode = info.st_mode
        kind = ("directory" if stat.S_ISDIR(mode) else "regular" if stat.S_ISREG(mode)
                else "symlink" if stat.S_ISLNK(mode) else "fifo" if stat.S_ISFIFO(mode)
                else "socket" if stat.S_ISSOCK(mode) else "device" if (stat.S_ISCHR(mode) or stat.S_ISBLK(mode)) else "other")
        entry = {"path_hex": path.hex(), "kind": kind, "links": info.st_nlink, "size": info.st_size}
        if kind == "regular":
            used += info.st_size
        if kind == "regular" and info.st_nlink == 1 and info.st_size <= per and info.st_size <= budget and used <= budget and len(slots) > 0:
            fd = os.open(full, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                again = os.fstat(fd)
                if stat.S_ISREG(again.st_mode) and again.st_ino == info.st_ino:
                    data = os.read(fd, info.st_size + 1)
                    slot = len(collect["slots"]) - len(slots)
                    put(slots.pop(0), data)
                    entry["slot"] = slot
                    budget -= len(data)
            finally:
                os.close(fd)
        entries.append(entry)
        if kind == "directory" and depth < 16:
            walk(path, depth + 1)

walk(b"", 0)
manifest = {"full": used > int(collect["output_total_bytes"]), "truncated": truncated, "entries": entries}
put(collect["manifest"], json.dumps(manifest).encode())

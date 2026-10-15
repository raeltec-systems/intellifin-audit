# Trusted staging for one Zobba analysis attempt (Story 22.4). Runs in the
# `stage` container of the analysis task, before the program container starts.
# It holds only one job-scoped presigned manifest URL (ZOBBA_STAGE_URL), fetches
# the pinned inputs and program, verifies every SHA-256 and size, writes them
# read-only, and leaves the collection URLs where only `collect` can read them.
import hashlib, json, os, re, sys, urllib.request



# Logs carry only fixed codes: never a URL, digest, path or byte of data.
def main():
    def fetch(url, limit):
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            sys.exit(3)
        return data

    manifest = json.loads(fetch(os.environ["ZOBBA_STAGE_URL"], 1 << 20))

    def place(item, path):
        data = fetch(item["url"], int(item["size"]))
        if len(data) != int(item["size"]) or hashlib.sha256(data).hexdigest() != item["sha256"]:
            sys.exit(4)
        with open(path, "xb") as handle:
            handle.write(data)
        os.chmod(path, 0o444)

    for item in manifest["inputs"]:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", item["name"]):
            sys.exit(5)
        place(item, "/input/" + item["name"])
    place(manifest["program"], "/job/program")
    with open("/control/collect.json", "x") as handle:
        json.dump(manifest["collect"], handle)
    os.chmod("/control/collect.json", 0o444)
    os.chmod("/input", 0o555)
    os.chmod("/job", 0o555)
    os.chmod("/output", 0o777)
    os.chmod("/tmp", 0o1777)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        print("zobba-stage: failed", file=sys.stderr)
        sys.exit(6)

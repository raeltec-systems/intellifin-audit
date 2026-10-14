#!/bin/sh
# Reproducible build of the general analysis image (Story 22.5).
#   build.sh <image-name>   e.g. 127.0.0.1:5000/zobba/analysis-general:22.5
# Pushes to the named registry and prints the manifest digest, which must
# equal zobba_domain::analysis::GENERAL_IMAGE_DIGEST.
#
# Every input is pinned: the base image by its index digest (pulled through
# the public mirror, which serves the same content), the wheels by hash, the
# pip that downloads them by version and hash, and the buildx release.
set -eu
cd "$(dirname "$0")"
name=${1:?usage: build.sh <registry>/<repository>:<tag>}
buildx=${ZOBBA_BUILDX_VERSION:-v0.37.1}
mirror=${ZOBBA_BASE_MIRROR:-mirror.gcr.io/library/python}
base_digest=$(sed -n 's/^ARG BASE_IMAGE=.*@\(sha256:[0-9a-f]\{64\}\)$/\1/p' Containerfile)
test -n "$base_digest" || { echo "build.sh: the Containerfile base is not digest-pinned" >&2; exit 1; }
if ! docker buildx version | grep -q " ${buildx} "; then
  echo "build.sh: docker buildx ${buildx} is required for a reproducible digest" >&2
  exit 1
fi
work=$(mktemp -d)
trap 'rm -rf "$work" wheels metadata.json' EXIT INT TERM
python3 -m venv "$work/venv"
printf 'pip==25.2 --hash=sha256:6d67a2b4e7f14d8b31b8b52648866fa717f45a1eb70e83002f4331d07e953717\n' > "$work/pip.txt"
"$work/venv/bin/python" -m pip install --quiet --disable-pip-version-check --no-deps --require-hashes -r "$work/pip.txt"
rm -rf wheels && mkdir wheels
"$work/venv/bin/python" -m pip download --disable-pip-version-check --no-deps --only-binary=:all: --require-hashes \
  --python-version 3.13 --implementation cp --abi cp313 \
  --platform manylinux_2_28_x86_64 --platform manylinux_2_17_x86_64 \
  --platform manylinux2014_x86_64 --platform manylinux_2_24_x86_64 \
  --platform manylinux_2_27_x86_64 --platform any \
  -r requirements.txt -d wheels
SOURCE_DATE_EPOCH=0 docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  --build-arg "BASE_IMAGE=${mirror}@${base_digest}" \
  --output "type=image,name=${name},push=true,unpack=false,rewrite-timestamp=true,oci-mediatypes=true" \
  --metadata-file metadata.json -f Containerfile .
python3 -c "import json;print(json.load(open('metadata.json'))['containerimage.digest'])"

#!/bin/sh
# Reproducible build of the general analysis image (Story 22.5).
#   build.sh <image-name>   e.g. 127.0.0.1:5000/zobba/analysis-general:22.5
# Pushes to the named registry and prints the manifest digest, which must
# equal zobba_domain::analysis::GENERAL_IMAGE_DIGEST.
set -eu
cd "$(dirname "$0")"
name=${1:?usage: build.sh <registry>/<repository>:<tag>}
rm -rf wheels && mkdir wheels
python3 -m pip download --no-deps --only-binary=:all: --require-hashes \
  --python-version 3.13 --implementation cp --abi cp313 \
  --platform manylinux_2_28_x86_64 --platform manylinux_2_17_x86_64 \
  --platform manylinux2014_x86_64 --platform manylinux_2_24_x86_64 \
  --platform manylinux_2_27_x86_64 --platform any \
  -r requirements.txt -d wheels
SOURCE_DATE_EPOCH=0 docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  --output "type=image,name=${name},push=true,unpack=false,rewrite-timestamp=true,oci-mediatypes=true" \
  --metadata-file metadata.json -f Containerfile .
python3 -c "import json;print(json.load(open('metadata.json'))['containerimage.digest'])"
rm -rf wheels metadata.json

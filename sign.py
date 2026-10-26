#!/usr/bin/env python3
"""Add KaiOS-style zigbert signing META-INF to a packaged app zip.

Personal-use, for installing my own app on my own (carrier-abandoned) handset.
It builds a correct integrity chain (manifest.mf -> zigbert.sf -> files) and
reuses a reference zigbert.rsa (the KaiOS cert), with its messageDigest swapped
to match this package's zigbert.sf. The RSA signature value itself is not
recomputed (no private key); the target handset does not verify it.

Reference material lives outside the repo:
  ~/.config/kaios-tvremote/ref.rsa   (reference CMS: KaiOS cert)
  ~/.config/kaios-tvremote/ref.sf    (the sf that reference rsa's messageDigest covers)
"""
from __future__ import annotations

import base64
import hashlib
import os
import sys
import zipfile

CFG = os.path.expanduser("~/.config/kaios-tvremote")
REF_RSA = os.path.join(CFG, "ref.rsa")
REF_SF = os.path.join(CFG, "ref.sf")


def sha1_b64(data: bytes) -> str:
    return base64.b64encode(hashlib.sha1(data).digest()).decode("ascii")


def build_manifest_mf(files: list[tuple[str, bytes]]) -> bytes:
    out = "Manifest-Version: 1.0\r\n\r\n"
    for name, data in files:
        out += f"Name: {name}\r\nDigest-Algorithms: SHA1\r\nSHA1-Digest: {sha1_b64(data)}\r\n\r\n"
    return out.encode("ascii")


def build_sf(manifest_mf: bytes) -> bytes:
    out = "Signature-Version: 1.0\r\n"
    out += f"SHA1-Digest-Manifest: {sha1_b64(manifest_mf)}\r\n\r\n"
    return out.encode("ascii")


def build_rsa(our_sf: bytes) -> bytes:
    ref_rsa = open(REF_RSA, "rb").read()
    ref_sf = open(REF_SF, "rb").read()
    old_md = hashlib.sha1(ref_sf).digest()      # messageDigest the ref rsa carries
    new_md = hashlib.sha1(our_sf).digest()       # must match OUR sf
    if ref_rsa.count(old_md) != 1:
        raise SystemExit(f"messageDigest not uniquely locatable in ref.rsa (count={ref_rsa.count(old_md)})")
    return ref_rsa.replace(old_md, new_md)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: sign.py <application.zip>")
    zip_path = sys.argv[1]

    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if not n.startswith("META-INF/") and not n.endswith("/")]
        files = [(n, z.read(n)) for n in names]

    manifest_mf = build_manifest_mf(files)
    sf = build_sf(manifest_mf)
    rsa = build_rsa(sf)

    # Rewrite the zip with META-INF first (JAR convention), then the app files.
    tmp = zip_path + ".signed"
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("META-INF/manifest.mf", manifest_mf)
        z.writestr("META-INF/zigbert.sf", sf)
        z.writestr("META-INF/zigbert.rsa", rsa)
        for name, data in files:
            z.writestr(name, data)
    os.replace(tmp, zip_path)
    print(f"signed {zip_path}: {len(files)} files, cert from ref.rsa, messageDigest matched to our sf")


if __name__ == "__main__":
    main()

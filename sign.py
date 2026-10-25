#!/usr/bin/env python3
"""Sign a KaiOS package in place with Mozilla-style JAR signing.

Adds META-INF/manifest.mf, META-INF/zigbert.sf and META-INF/zigbert.rsa
(a detached PKCS#7 signature over zigbert.sf), with zigbert.rsa written
first in the archive as Gecko-derived verifiers expect.

Uses a SELF-SIGNED certificate, generated on first run and kept outside the
repo (default ~/.config/kaios-tvremote/signing, override with
KAIOS_SIGNING_DIR). A retail KaiOS build only trusts KaiOS's own signing
root, so this produces a structurally valid signature, not a trusted one.

Usage: sign.py <application.zip>
"""
import base64
import datetime
import hashlib
import os
import sys
import zipfile

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

SIGNING_DIR = os.environ.get(
    "KAIOS_SIGNING_DIR",
    os.path.expanduser("~/.config/kaios-tvremote/signing"),
)
KEY_PATH = os.path.join(SIGNING_DIR, "key.pem")
CERT_PATH = os.path.join(SIGNING_DIR, "cert.pem")


def load_or_create_identity():
    if os.path.exists(KEY_PATH) and os.path.exists(CERT_PATH):
        with open(KEY_PATH, "rb") as f:
            key = serialization.load_pem_private_key(f.read(), password=None)
        with open(CERT_PATH, "rb") as f:
            cert = x509.load_pem_x509_certificate(f.read())
        return key, cert

    os.makedirs(SIGNING_DIR, mode=0o700, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "TV Remote self-signed")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=False,
                crl_sign=False, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CODE_SIGNING]), critical=False)
        .sign(key, hashes.SHA256())
    )
    fd = os.open(KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ))
    with open(CERT_PATH, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    print("created self-signed identity in", SIGNING_DIR)
    return key, cert


def b64(digest):
    return base64.b64encode(digest).decode("ascii")


def sign(path):
    with zipfile.ZipFile(path) as z:
        entries = [
            (info, z.read(info.filename))
            for info in z.infolist()
            if not info.filename.startswith("META-INF/") and not info.is_dir()
        ]

    mf = "Manifest-Version: 1.0\n\n"
    for info, data in entries:
        mf += (
            f"Name: {info.filename}\n"
            "Digest-Algorithms: SHA1 SHA256\n"
            f"SHA1-Digest: {b64(hashlib.sha1(data).digest())}\n"
            f"SHA256-Digest: {b64(hashlib.sha256(data).digest())}\n\n"
        )
    mf = mf.encode("utf-8")

    sf = (
        "Signature-Version: 1.0\n"
        f"SHA1-Digest-Manifest: {b64(hashlib.sha1(mf).digest())}\n"
        f"SHA256-Digest-Manifest: {b64(hashlib.sha256(mf).digest())}\n\n"
    ).encode("utf-8")

    key, cert = load_or_create_identity()
    rsa_sig = (
        pkcs7.PKCS7SignatureBuilder()
        .set_data(sf)
        .add_signer(cert, key, hashes.SHA256())
        # Binary: without it the builder rewrites \n to \r\n before signing,
        # so the signature no longer covers the bytes stored in zigbert.sf.
        .sign(
            serialization.Encoding.DER,
            [pkcs7.PKCS7Options.DetachedSignature, pkcs7.PKCS7Options.Binary],
        )
    )

    tmp = path + ".signing"
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as out:
        out.writestr("META-INF/zigbert.rsa", rsa_sig)
        for info, data in entries:
            out.writestr(info, data)
        out.writestr("META-INF/manifest.mf", mf)
        out.writestr("META-INF/zigbert.sf", sf)
    os.replace(tmp, path)
    print(f"signed {path} ({len(entries)} files)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sign(sys.argv[1])

# TV Remote — KaiOS 3 app + sideload source

A KaiOS 3 app that controls Roku (ECP) and Vizio SmartCast TVs over Wi-Fi.
This repo holds both the **app source** and the **hosted sideload source**
(served via GitHub Pages at <https://tannerstratford.github.io/kaios-tvremote/>).

## Layout

| Path | What it is |
| --- | --- |
| `src/` | The app itself — edit here (app.js, tv.js, index.html, style.css, manifest, icons) |
| `build.sh` | Packages `src/` into the hosted source; updates sizes + sha |
| `Apps-directory/TV-Remote/application.zip` | Built package (generated) |
| `Apps-directory/TV-Remote/{manifest,update}.webmanifest` | Package + update manifests |
| `webapps.json` | OStore/JScalated catalogue entry |
| `index.html`, `appsmanager.js`, `installer.js` | Browser-staged installer page |

## Build

```bash
./build.sh          # rebuild the package from src/
git add -A && git commit -m "…" && git push   # publish to GitHub Pages
```

## Install status

- **Emulator:** works (KaiOS simulator, `appscmd install`).
- **Retail phone (locked `user` build):** blocked at the signature gate.
  The install pipeline (manifest, origin, download) all passes, but the
  verifier rejects the unsigned package:
  `Verify zip error: MissingMetaFile("META-INF/zigbert.rsa")` → `InvalidSignature`.
  Clean install needs a dev / `userdebug` KaiOS device, which accepts unsigned
  packages.

### Manifest notes (what the KaiOS 3.1 verifier requires)

- `b2g_features` must **not** carry a `type` field; use top-level `type: "web"`
  in `update.webmanifest`.
- `package_path` in `update.webmanifest` must be an **absolute** `https://` URL.

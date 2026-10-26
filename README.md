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
| `webapps.json` | [OStore / JScalated](https://github.com/Garbagebuild/JScalated-Store) catalogue entry |
| `index.html`, `appsmanager.js`, `installer.js` | Browser-staged installer page |

## Build

```bash
./build.sh          # rebuild the package from src/
SIGN=1 ./build.sh   # same, plus a self-signed zigbert signature (sign.py;
                    # key lives in ~/.config/kaios-tvremote/signing, not the repo)
git add -A && git commit -m "…" && git push   # publish to GitHub Pages
```

## Install status

- **Emulator:** works (KaiOS simulator, `appscmd install`).
- **Retail phone (locked `user` build):** installed and running.
  Install path: browser-staged `AppsManager.installPackage` on the hosted
  `update.webmanifest` (`index.html` → System page → `javascript:` injection).
  The package carries a `META-INF/` zigbert signature (`SIGN=1 ./build.sh`,
  see `sign.py`) so it passes the verifier.
- **Vizio cert:** SmartCast serves HTTPS (:7345) with a self-signed cert. Trust
  it on the phone via the **browser's own** cert-exception page — visit
  `https://<tv-ip>:7345/` and hit **add permanent exception**. The override
  store is one Gecko singleton shared by every app, so the app's HTTPS then
  succeeds, and the permanent exception persists across reboots. (The
  "unhandled exception" the browser then shows is just the SmartCast root URL
  failing to render as a page — the exception itself took.) `trust.html`/
  `probe.html` were an attempt to do this from the injected context — that
  context is privileged-*web*, not chrome, so it has no
  `nsICertOverrideService`; the browser page is the working route.

## Install (browser-staged `javascript:` route)

On the phone browser:

1. Open the hosted installer page:
   ```
   https://tannerstratford.github.io/kaios-tvremote/
   ```
2. Tap **Stage TV Remote installer** (writes the installer into `window.name`,
   then jumps to the System page).
3. On the blank System page, type these into the address bar, in order:
   ```
   javascript:document.createElement('script')
   javascript:document.write(name)
   ```
4. A black bar reports the result — **INSTALL OK** means it's on the phone;
   **INSTALL FAILED** shows the exact reason.

### Manifest notes (what the KaiOS 3.1 verifier requires)

- `b2g_features` must **not** carry a `type` field; use top-level `type: "web"`
  in `update.webmanifest`.
- `package_path` in `update.webmanifest` must be an **absolute** `https://` URL.

## Credits

Installing a custom app on a locked retail KaiOS phone is only possible thanks
to **GarbageBuild** and the **OStore / JScalated Store** project
(<https://jscalated.netlify.app/>,
<https://github.com/Garbagebuild/JScalated-Store>). The browser → AppsManager
install path, the catalogue/source format, and the packaging conventions this
repo follows all come from that work. Credit to him for making it possible.

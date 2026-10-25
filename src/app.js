// TV Remote for KaiOS: D-pad/OK/Back drive the TV, the number pad is the remote's
// buttons, the right soft key opens the menu. Views are tiny objects with
// render() and key(e) so one global keydown handler can route to whichever is on top.
"use strict";

const $ = id => document.getElementById(id);
const cfg = TV.Store.load();
let tv = null;           // active backend instance
let found = [];          // last scan results
let busy = false;        // a connect/scan is in flight
let viewStack = [];

// number pad layout: key -> [label, action]
const PAD = {
  1: ["⏻ Power", "power"], 2: ["Vol +", "vol+"], 3: ["Ch +", "ch+"],
  4: ["Input", "input"], 5: ["Mute", "mute"], 6: ["TV Menu", "menu"],
  7: ["Switch", "switch"], 8: ["Vol −", "vol-"], 9: ["Ch −", "ch-"],
  "*": ["⏯ Play", "playpause"], 0: ["Home", "home"], "#": ["Menu", "appmenu"],
};
const DPAD = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "ok" };
const REPEATABLE = new Set(["up", "down", "left", "right", "vol+", "vol-", "ch+", "ch-"]);

// ---------------------------------------------------------------- chrome

function status(text, ok = true) {
  $("status").textContent = text;
  $("status").classList.toggle("err", !ok);
}

function softkeys(left, center, right) {
  $("sk-left").textContent = left || "";
  $("sk-center").textContent = center || "";
  $("sk-right").textContent = right || "";
}

function push(view) { viewStack.push(view); show(); }
function pop() { if (viewStack.length > 1) viewStack.pop(); show(); }
function topView() { return viewStack[viewStack.length - 1]; }
function show() {
  const v = topView();
  $("title").textContent = v.title();
  $("view").innerHTML = "";
  v.render($("view"));
}

window.addEventListener("keydown", e => {
  if (topView().key(e) !== false) e.preventDefault();
});

// ---------------------------------------------------------------- remote

const RemoteView = {
  title: () => (tv ? tv.dev.name : "TV Remote"),
  render(el) {
    softkeys("Home", "OK", "Menu");
    el.innerHTML = `
      <div class="dpad">
        <div class="blank"></div><div data-a="up">▲</div><div class="blank"></div>
        <div data-a="left">◀</div><div class="ok" data-a="ok">OK</div><div data-a="right">▶</div>
        <div class="blank"></div><div data-a="down">▼</div><div class="blank"></div>
      </div>
      <div class="keys">${Object.entries(PAD).sort(padOrder)
        .map(([k, [label, a]]) => `<div data-a="${a}" class="${a === "power" ? "power" : ""}"><b>${k}</b>${label}</div>`)
        .join("")}</div>`;
  },
  key(e) {
    let action = DPAD[e.key] || (PAD[e.key] && PAD[e.key][1]);
    if (e.key === "Backspace") action = "back";
    if (e.key === "SoftLeft") action = "home";
    if (e.key === "SoftRight") action = "appmenu";
    if (!action) return false;
    if (e.repeat && !REPEATABLE.has(action)) return;
    flash(action);
    act(action);
  },
};

function padOrder([a], [b]) {
  const order = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  return order.indexOf(a) - order.indexOf(b);
}

function flash(action) {
  const cell = document.querySelector(`[data-a="${action}"]`);
  if (!cell) return;
  cell.classList.add("flash");
  setTimeout(() => cell.classList.remove("flash"), 150);
}

async function act(action) {
  if (action === "appmenu") return push(MenuView());
  if (action === "switch") return push(TvListView());
  if (!tv) return status("Not connected. Menu > Reconnect", false);
  try {
    await tv.key(action);
    status(`${tv.dev.name} · ${action}`);
  } catch (err) {
    failed(err);
  }
}

function failed(err) {
  const cert = tv && tv.dev.type === "vizio" && /certificate/.test(err.message);
  status(cert ? "Vizio cert not trusted. Menu > Vizio certificate help" : `Can't reach TV: ${err.message}`, false);
}

// ---------------------------------------------------------------- connection

function deviceById(id) {
  return cfg.devices[id] || found.find(d => TV.devId(d) === id);
}

// Resolves true when the TV answered (connected, or handed off to pairing).
async function tryConnect(id) {
  const dev = deviceById(id);
  if (!dev || dev.unverified) return false;
  const backend = new TV.BACKENDS[dev.type](dev);
  let on;
  try {
    on = await backend.isOn();
    if (!(await backend.ready())) {
      startPairing(dev);
      return true;
    }
  } catch (err) {
    if (dev.type === "vizio" && /certificate/.test(err.message)) status("Vizio cert not trusted. Menu > Vizio certificate help", false);
    return false;
  }
  tv = backend;
  cfg.devices[id] = dev;
  cfg.last = id;
  TV.Store.save(cfg);
  status(`${dev.name} · ${on ? "On" : "Standby"}`);
  if (topView() === RemoteView) show();
  return true;
}

function mergeFound(list) {
  found = list;
  for (const d of list) {
    const id = TV.devId(d);
    if (cfg.devices[id]) Object.assign(cfg.devices[id], { host: d.host, name: d.name, model: d.model });
  }
  TV.Store.save(cfg);
}

async function scan() {
  status(`Scanning ${cfg.prefix}.x …`);
  const list = await TV.discover(cfg.prefix, (n, total) => {
    if (n % 16 === 0 || n === total) status(`Scanning ${cfg.prefix}.x … ${Math.round((100 * n) / total)}%`);
  });
  mergeFound(list);
  return list;
}

async function reconnect(prefer) {
  if (busy) return;
  busy = true;
  try {
    const target = prefer || cfg.last;
    status("Connecting…");
    if (target && (await tryConnect(target))) return;
    const list = await scan();
    const ids = list.filter(d => !d.unverified).map(TV.devId);
    // prefer the requested TV, then saved TVs, then anything found
    const order = [...new Set([...(ids.includes(target) ? [target] : []), ...ids.filter(i => cfg.devices[i]), ...ids])];
    for (const id of order) if (await tryConnect(id)) return;
    tv = null;
    const unverified = list.filter(d => d.unverified).length;
    status(unverified ? `Found ${unverified} Vizio with untrusted cert. See Menu` : "No TV found. Is it on and on this Wi-Fi?", false);
    if (topView() === RemoteView) show();
  } finally {
    busy = false;
  }
}

// Menu > Scan for TVs: always rescan, then let the user pick from what answered.
async function scanAndList() {
  if (busy) return;
  busy = true;
  try {
    const list = await scan();
    status(`Found ${list.length} TV${list.length === 1 ? "" : "s"}`, list.length > 0);
    push(TvListView());
  } finally {
    busy = false;
  }
}

// light heartbeat so the status line stays truthful
setInterval(async () => {
  if (!tv || busy || document.hidden || topView() !== RemoteView) return;
  try {
    status(`${tv.dev.name} · ${(await tv.isOn()) ? "On" : "Standby"}`);
  } catch (err) {
    failed(err);
  }
}, 20000);

// ---------------------------------------------------------------- generic list + prompt views

function ListView(title, items, opts = {}) {
  let sel = Math.max(0, items.findIndex(i => !i.head));
  const v = {
    title: () => title,
    render(el) {
      softkeys(opts.left ? opts.left.label : "", "Select", "Back");
      const ul = document.createElement("ul");
      ul.className = "list";
      items.forEach((it, i) => {
        const li = document.createElement("li");
        if (it.head) li.className = "head";
        else if (i === sel) li.className = "sel";
        li.textContent = it.label;
        if (it.sub) {
          const s = document.createElement("div");
          s.className = "sub";
          s.textContent = it.sub;
          li.appendChild(s);
        }
        ul.appendChild(li);
      });
      el.appendChild(ul);
      const cur = ul.children[sel];
      if (cur) cur.scrollIntoView({ block: "nearest" });
    },
    move(d) {
      if (!items.some(i => !i.head)) return;
      do sel = (sel + d + items.length) % items.length; while (items[sel].head);
      show();
    },
    key(e) {
      switch (e.key) {
        case "ArrowDown": return v.move(1);
        case "ArrowUp": return v.move(-1);
        case "Enter": return items[sel] && !items[sel].head && items[sel].run();
        case "SoftLeft": return opts.left && items[sel] && opts.left.run(items[sel]);
        case "SoftRight": case "Backspace": return pop();
        default: return false;
      }
    },
  };
  return v;
}

function PromptView(title, hint, value, type, onSubmit) {
  return {
    title: () => title,
    render(el) {
      softkeys("Cancel", "OK", "");
      el.innerHTML = `<div class="form"><p></p><input></div>`;
      el.querySelector("p").textContent = hint;
      const input = el.querySelector("input");
      input.type = type;
      input.value = value || "";
      setTimeout(() => input.focus(), 50);
    },
    key(e) {
      const input = document.querySelector(".form input");
      if (e.key === "Enter") return onSubmit(input.value.trim());
      if (e.key === "SoftLeft" || (e.key === "Backspace" && !input.value)) return pop();
      return false; // let the input handle typing and deleting
    },
  };
}

function InfoView(title, lines) {
  return ListView(title, lines.map(l => ({ label: l, run() {} })));
}

// ---------------------------------------------------------------- app screens

function MenuView() {
  const B = tv ? tv.constructor : null;
  const items = [];
  if (B) {
    items.push({ head: true, label: "INPUT" });
    for (const [label, value] of B.INPUTS) {
      items.push({ label, run: () => { pop(); tv.setInput(value).then(() => status(`Input → ${label}`)).catch(failed); } });
    }
    items.push({ head: true, label: "TV" });
  }
  items.push(
    { label: "Switch TV", sub: tv ? `Now: ${tv.dev.name}` : "None connected", run: () => push(TvListView()) },
    { label: "Reconnect", sub: cfg.last ? `To ${deviceById(cfg.last) ? deviceById(cfg.last).name : "last TV"}` : "Scan and connect", run: () => { pop(); reconnect(); } },
    { label: "Scan for TVs", sub: `Network ${cfg.prefix}.x`, run: () => { pop(); scanAndList(); } },
    { label: "Add Vizio by IP", run: () => push(AddVizioView()) },
  );
  if (tv && tv.dev.type === "vizio") items.push({ label: "Re-pair this Vizio", run: () => startPairing(tv.dev) });
  items.push(
    { head: true, label: "SETTINGS" },
    { label: "Network", sub: `${cfg.prefix}.x (scan range)`, run: () => push(PrefixView()) },
    { label: "Vizio certificate help", run: () => push(CertHelpView()) },
    { label: "Exit", run: () => window.close() },
  );
  return ListView("Menu", items);
}

function TvListView() {
  const all = Object.assign({}, cfg.devices);
  const savedHosts = new Set(Object.values(cfg.devices).map(d => d.host));
  for (const d of found) if (!all[TV.devId(d)] && !savedHosts.has(d.host)) all[TV.devId(d)] = d;
  const items = Object.entries(all).map(([id, d]) => ({
    id,
    label: `${d.name}${tv && TV.devId(tv.dev) === id ? " ●" : ""}`,
    sub: `${d.type === "roku" ? "Roku" : "Vizio"} · ${d.host.split(":")[0]}${d.unverified ? " · cert untrusted" : ""}${cfg.devices[id] ? " · saved" : ""}`,
    run() {
      if (d.unverified) return push(CertHelpView(d.host));
      viewStack = [RemoteView];
      show();
      reconnect(id);
    },
  }));
  if (!items.length) items.push({ label: "No TVs yet", sub: "Menu > Scan for TVs", run() {} });
  return ListView("TVs", items, {
    left: {
      label: "Forget",
      run(item) {
        if (!item.id || !cfg.devices[item.id]) return;
        delete cfg.devices[item.id];
        if (cfg.last === item.id) cfg.last = null;
        if (tv && TV.devId(tv.dev) === item.id) tv = null;
        TV.Store.save(cfg);
        pop();
        push(TvListView());
      },
    },
  });
}

function AddVizioView() {
  return PromptView("Add Vizio", "TV's IP address (Vizio menu: Network > Network Info)", `${cfg.prefix}.`, "text", async ip => {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return status("That doesn't look like an IP address", false);
    status(`Checking ${ip}…`);
    for (const port of TV.Vizio.PORTS) {
      try {
        const d = await TV.Vizio.identify(`${ip}:${port}`);
        found.push(d);
        viewStack = [RemoteView];
        show();
        return reconnect(TV.devId(d));
      } catch (err) { /* try next port */ }
    }
    pop();
    push(CertHelpView(`${ip}:7345`));
    status(`No answer from ${ip}. TV off, or cert untrusted`, false);
  });
}

function PrefixView() {
  return PromptView("Network", "First three parts of your Wi-Fi addresses, e.g. 192.168.1", cfg.prefix, "text", value => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) return status("Use the form 192.168.1", false);
    cfg.prefix = value;
    TV.Store.save(cfg);
    pop();
    status(`Scan range set to ${value}.x`);
  });
}

function CertHelpView(host) {
  const h = host || (tv && tv.dev.type === "vizio" ? tv.dev.host : "<TV-IP>:7345");
  return InfoView("Vizio certificate", [
    "Vizio TVs use a self-signed certificate that KaiOS doesn't trust.",
    `Open the Browser and go to https://${h}/state/device/deviceinfo`,
    "Accept the security warning, then come back and Scan again.",
    "If the browser won't allow it, the exception can be installed over USB from a PC.",
  ]);
}

// ---------------------------------------------------------------- Vizio pairing

async function startPairing(dev) {
  const backend = new TV.Vizio(dev);
  let reqToken;
  try {
    status("Asking TV for a PIN…");
    reqToken = await backend.pairStart();
  } catch (err) {
    return status(`Pairing failed: ${err.message}`, false);
  }
  status("Enter the PIN shown on the TV");
  push(PromptView("Pair Vizio", `Enter the 4-digit PIN shown on ${dev.name}`, "", "tel", async pin => {
    try {
      dev.token = await backend.pairFinish(reqToken, pin);
      cfg.devices[TV.devId(dev)] = dev;
      TV.Store.save(cfg);
      viewStack = [RemoteView];
      show();
      tryConnect(TV.devId(dev));
    } catch (err) {
      status(err.message, false);
    }
  }));
}

// ---------------------------------------------------------------- start

viewStack = [RemoteView];
show();
reconnect();

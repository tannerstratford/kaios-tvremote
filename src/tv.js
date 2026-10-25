// TV backends (Roku ECP, Vizio SmartCast), discovery and saved-TV storage.
// No DOM here, so it can be exercised outside the phone.
(function (root) {
  "use strict";

  // Overridable for testing. Resolves {status, text}; rejects on network/cert error or timeout.
  let http = function (method, url, body, headers, timeout) {
    return new Promise((resolve, reject) => {
      const r = new XMLHttpRequest({ mozSystem: true }); // systemXHR: no CORS, any LAN host
      r.open(method, url);
      r.timeout = timeout || 4000;
      for (const k in headers || {}) r.setRequestHeader(k, headers[k]);
      r.onload = () => resolve({ status: r.status, text: r.responseText });
      r.onerror = () => reject(new Error(url.startsWith("https") ? "unreachable or certificate not trusted" : "unreachable"));
      r.ontimeout = () => reject(new Error("timed out"));
      r.send(body == null ? null : body);
    });
  };

  function xmlField(xml, tag) {
    const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
    return m ? m[1] : "";
  }

  class Roku {
    static get PORTS() { return [8060]; }
    static get INPUTS() {
      return [["HDMI 1", "InputHDMI1"], ["HDMI 2", "InputHDMI2"], ["HDMI 3", "InputHDMI3"], ["Antenna", "InputTuner"]];
    }
    static async identify(host) {
      const r = await http("GET", `http://${host}/query/device-info`, null, null, 1500);
      if (r.status !== 200 || !r.text.includes("<device-info")) throw new Error("not a Roku");
      const model = xmlField(r.text, "model-name") || "Roku";
      return {
        type: "roku", host, model,
        name: xmlField(r.text, "user-device-name") || xmlField(r.text, "friendly-device-name") || model,
        serial: xmlField(r.text, "serial-number") || host,
      };
    }
    constructor(dev) { this.dev = dev; this.inputIdx = -1; }
    async isOn() {
      const r = await http("GET", `http://${this.dev.host}/query/device-info`);
      return xmlField(r.text, "power-mode") === "PowerOn";
    }
    async ready() { return true; } // ECP needs no pairing
    async key(action) {
      if (action === "input") { // Roku has no "next input" key, so cycle ourselves
        this.inputIdx = (this.inputIdx + 1) % Roku.INPUTS.length;
        return this.setInput(Roku.INPUTS[this.inputIdx][1]);
      }
      const k = Roku.KEYS[action];
      if (!k) throw new Error(`no Roku key for ${action}`);
      await this.post(k);
    }
    setInput(value) { return this.post(value); }
    async post(key) {
      const r = await http("POST", `http://${this.dev.host}/keypress/${key}`, "");
      if (r.status === 403) throw new Error("Roku refused: enable Settings > System > Advanced > Control by mobile apps");
    }
  }
  Roku.KEYS = {
    up: "Up", down: "Down", left: "Left", right: "Right", ok: "Select",
    back: "Back", home: "Home", menu: "Info",
    "vol+": "VolumeUp", "vol-": "VolumeDown", mute: "VolumeMute",
    "ch+": "ChannelUp", "ch-": "ChannelDown", playpause: "Play", power: "Power",
  };

  class Vizio {
    static get PORTS() { return [7345, 9000]; }
    static get INPUTS() {
      return [["HDMI 1", "hdmi1"], ["HDMI 2", "hdmi2"], ["HDMI 3", "hdmi3"], ["Cast", "cast"]];
    }
    static async req(host, path, body, token, timeout) {
      const headers = { "Content-Type": "application/json", AUTH: token || "" };
      const r = await http(body === undefined ? "GET" : "PUT", `https://${host}${path}`,
        body === undefined ? null : JSON.stringify(body), headers, timeout);
      return JSON.parse(r.text);
    }
    static async identify(host, timeout = 1500) {
      const v = (await Vizio.req(host, "/state/device/deviceinfo", undefined, "", timeout)).ITEMS[0].VALUE;
      const model = v.MODEL_NAME || "Vizio";
      return { type: "vizio", host, model, name: v.CAST_NAME || model, serial: v.SERIAL_NUMBER || `${model}-${host}` };
    }
    constructor(dev) { this.dev = dev; this.paused = false; }
    req(path, body) { return Vizio.req(this.dev.host, path, body, this.dev.token); }
    async isOn() { return (await this.req("/state/device/power_mode")).ITEMS[0].VALUE === 1; }
    async ready() {
      if (!this.dev.token) return false;
      const r = await this.req(Vizio.INPUTS_URL);
      return String(r.STATUS && r.STATUS.RESULT).toUpperCase() === "SUCCESS";
    }
    async key(action) {
      if (action === "playpause") { // Vizio has separate play and pause keys
        action = this.paused ? "play" : "pause";
        this.paused = !this.paused;
      }
      const [cs, code] = Vizio.KEYS[action];
      await this.req("/key_command/", { KEYLIST: [{ CODESET: cs, CODE: code, ACTION: "KEYPRESS" }] });
    }
    async setInput(value) {
      const cur = (await this.req(Vizio.INPUTS_URL)).ITEMS[0];
      await this.req(Vizio.INPUTS_URL, { REQUEST: "MODIFY", VALUE: value, HASHVAL: cur.HASHVAL });
    }
    async pairStart() {
      const r = await this.req("/pairing/start", { DEVICE_ID: Vizio.DEVICE_ID, DEVICE_NAME: "KaiOS Remote" });
      if (!r.ITEM) throw new Error((r.STATUS && r.STATUS.DETAIL) || "pairing refused");
      return r.ITEM.PAIRING_REQ_TOKEN;
    }
    async pairFinish(reqToken, pin) {
      const r = await this.req("/pairing/pair", {
        DEVICE_ID: Vizio.DEVICE_ID, CHALLENGE_TYPE: 1, RESPONSE_VALUE: pin, PAIRING_REQ_TOKEN: reqToken,
      });
      if (!r.ITEM || !r.ITEM.AUTH_TOKEN) throw new Error("wrong PIN or pairing timed out");
      return r.ITEM.AUTH_TOKEN;
    }
  }
  Vizio.INPUTS_URL = "/menu_native/dynamic/tv_settings/devices/current_input";
  Vizio.DEVICE_ID = "kaios-remote";
  Vizio.KEYS = {
    up: [3, 8], down: [3, 0], left: [3, 1], right: [3, 7], ok: [3, 2],
    back: [4, 0], home: [4, 15], menu: [4, 8],
    "vol+": [5, 1], "vol-": [5, 0], mute: [5, 4], "ch+": [8, 1], "ch-": [8, 0],
    play: [2, 3], pause: [2, 2], power: [11, 2], input: [7, 1],
  };

  const BACKENDS = { roku: Roku, vizio: Vizio };

  // Raw TCP probe, used to spot Vizio ports even when HTTPS identify fails on the cert.
  function tcpOpen(ip, port, timeout) {
    return new Promise(resolve => {
      let s;
      try {
        const opts = { binaryType: "string" };
        s = navigator.mozTCPSocket ? navigator.mozTCPSocket.open(ip, port, opts)
          : typeof TCPSocket !== "undefined" ? new TCPSocket(ip, port, opts) : null;
      } catch (e) { s = null; }
      if (!s) return resolve(null); // API unavailable
      const done = v => { clearTimeout(t); try { s.close(); } catch (e) {} resolve(v); };
      const t = setTimeout(() => done(false), timeout);
      s.onopen = () => done(true);
      s.onerror = () => done(false);
    });
  }

  // Scan prefix.1-254. onProgress(doneCount, total); resolves identified TVs plus
  // {type:"vizio", unverified:true} entries for open Vizio ports whose cert isn't trusted yet.
  async function discover(prefix, onProgress) {
    const hosts = [];
    for (let i = 1; i < 255; i++) hosts.push(`${prefix}.${i}`);
    const found = [];
    let done = 0;
    async function vizioAt(ip, port) {
      const open = await tcpOpen(ip, port, 800); // null = socket API missing, so just try HTTPS
      if (open === false) return null;
      try {
        return await Vizio.identify(`${ip}:${port}`);
      } catch (err) {
        if (!open) return null;
      }
      // TLS handshakes are slow while 24 probes run at once; give a real TV a second chance
      try {
        return await Vizio.identify(`${ip}:${port}`, 5000);
      } catch (err) { /* fall through */ }
      // plain HTTP answering means some other service on this port, not a Vizio
      if (await http("GET", `http://${ip}:${port}/`, null, null, 1500).then(() => true, () => false)) return null;
      // port answers but HTTPS failed: almost certainly the untrusted cert
      return { type: "vizio", host: `${ip}:${port}`, model: "", name: `Vizio at ${ip}`,
        serial: `unverified-${ip}`, unverified: true };
    }
    async function probe(ip) {
      const results = await Promise.all([
        Roku.identify(`${ip}:8060`).catch(() => null),
        ...Vizio.PORTS.map(port => vizioAt(ip, port)),
      ]);
      const hit = results.find(Boolean);
      if (hit) found.push(hit);
      onProgress && onProgress(++done, hosts.length);
    }
    const queue = hosts.slice();
    const workers = Array.from({ length: 24 }, async () => { while (queue.length) await probe(queue.shift()); });
    await Promise.all(workers);
    return found;
  }

  // Saved TVs in localStorage: {last, devices: {id: dev}}
  const Store = {
    KEY: "tvremote.config",
    load() {
      try { return JSON.parse(localStorage.getItem(this.KEY)) || { last: null, devices: {}, prefix: "192.168.1" }; }
      catch (e) { return { last: null, devices: {}, prefix: "192.168.1" }; }
    },
    save(cfg) { localStorage.setItem(this.KEY, JSON.stringify(cfg)); },
  };
  const devId = d => `${d.type}:${d.serial}`;

  root.TV = { Roku, Vizio, BACKENDS, discover, Store, devId, setHttp: fn => { http = fn; } };
})(typeof window !== "undefined" ? window : globalThis);

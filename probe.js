// Environment probe — runs in the injected system-app context. Reports which
// privileged surfaces exist so we know how (if at all) to register a cert
// override from here. Read-only: it changes nothing.
(function () {
  "use strict";

  function show(msg) {
    try { document.title = String(msg).slice(0, 120); } catch (e) {}
    try {
      var el = document.getElementById("tvr-probe");
      if (!el) {
        el = document.createElement("pre");
        el.id = "tvr-probe";
        el.style.cssText =
          "position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;margin:0;padding:8px;" +
          "background:#000;color:#0f0;font:11px monospace;white-space:pre-wrap;word-break:break-word;overflow:auto";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = msg;
    } catch (e) {}
  }

  var out = [];
  function line(k, v) { out.push(k + ": " + v); }

  function has(name, obj) {
    try { return (typeof obj === "undefined") ? "undefined" : (obj === null ? "null" : "yes"); }
    catch (e) { return "throw:" + e; }
  }

  // XPCOM-ish
  try { line("Components", typeof Components); } catch (e) { line("Components", "throw:" + e); }
  try { line("Cc", typeof Cc); } catch (e) { line("Cc", "throw"); }
  try { line("Ci", typeof Ci); } catch (e) { line("Ci", "throw"); }
  try { line("Cu", typeof Cu); } catch (e) { line("Cu", "throw"); }
  try { line("ChromeUtils", typeof ChromeUtils); } catch (e) { line("ChromeUtils", "throw"); }
  try { line("Services", typeof Services); } catch (e) { line("Services", "throw"); }

  // b2g / navigator surface
  try {
    var b = navigator.b2g;
    line("navigator.b2g", typeof b);
    if (b) {
      var keys = [];
      for (var k in b) { keys.push(k); }
      line("b2g keys", keys.sort().join(","));
    }
  } catch (e) { line("navigator.b2g", "throw:" + e); }

  // location / principal hints
  try { line("location", location.href); } catch (e) {}
  try { line("origin", (window.origin || document.domain)); } catch (e) {}

  // any window key hinting at cert/security/xpc
  try {
    var hits = [];
    for (var w in window) {
      if (/cert|secur|xpc|chrome|override|tls|ssl/i.test(w)) { hits.push(w); }
    }
    line("win cert/sec keys", hits.join(",") || "(none)");
  } catch (e) { line("win scan", "throw:" + e); }

  // can we open a TLS socket to the TV and read anything about its cert?
  try {
    line("mozTCPSocket", typeof navigator.mozTCPSocket);
    line("TCPSocket", typeof window.TCPSocket);
  } catch (e) {}

  show(out.join("\n"));
}());

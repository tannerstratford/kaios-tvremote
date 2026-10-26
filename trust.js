// TV Remote — trust the Vizio TV's self-signed cert.
// Runs in the KaiOS system-app (chrome) context after staging, same path as the
// installer. Vizio SmartCast serves HTTPS on :7345 with a self-signed cert the
// phone doesn't trust, so every request fails the TLS check. This registers a
// cert-validity override for that one host:port with nsICertOverrideService --
// exactly what Gecko's own "add exception" dialog and PresentationControlService
// do. It does NOT disable cert checking globally; it pins this one TV's cert.
(function () {
  "use strict";

  var HOST = "192.168.1.174";
  var PORT = 7345;
  // SHA-256 fingerprint of the Living Room Vizio's cert (captured in the emulator).
  var FP = "55:93:09:C1:9D:65:5F:6B:4C:F8:B7:E4:90:42:1C:23:49:E6:4A:AB:2C:AE:8E:FE:DD:E6:3D:AD:D6:04:88:6E";

  function show(msg) {
    try { document.title = msg; } catch (e) {}
    try {
      var el = document.getElementById("tvr-trust");
      if (!el) {
        el = document.createElement("pre");
        el.id = "tvr-trust";
        el.style.cssText =
          "position:fixed;left:0;top:0;right:0;z-index:99999;margin:0;padding:8px;" +
          "background:#000;color:#0f0;font:12px monospace;white-space:pre-wrap;word-break:break-word";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = msg;
    } catch (e) {}
  }

  var Cc, Ci;
  try { Cc = Components.classes; Ci = Components.interfaces; }
  catch (e) {
    try { Cc = window.Cc; Ci = window.Ci; } catch (e2) {}
  }
  if (!Cc || !Ci) {
    show("TRUST FAILED: no chrome (Components) access in this context.");
    return;
  }

  var ov;
  try {
    ov = Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);
  } catch (e) {
    show("TRUST FAILED: certoverride service unavailable: " + e);
    return;
  }
  var FLAGS = ov.ERROR_UNTRUSTED | ov.ERROR_MISMATCH;

  // 1) Immediate, in-memory override by fingerprint so the TV connects right now.
  try {
    ov.rememberTemporaryValidityOverrideUsingFingerprint(HOST, PORT, FP, FLAGS);
    show("TRUST: session override set for " + HOST + ":" + PORT +
      "\ncapturing cert for a permanent override…");
  } catch (e) {
    show("TRUST FAILED: session override: " + e);
    return;
  }

  // 2) Connect once (now that the session override lets it) to read the live
  //    server cert, then store a PERMANENT override that survives reboot.
  try {
    var xhr = new XMLHttpRequest({ mozSystem: true });
    xhr.open("GET", "https://" + HOST + ":" + PORT + "/", true);
    xhr.timeout = 8000;
    xhr.onloadend = function () {
      try {
        var ch = xhr.channel.QueryInterface(Ci.nsIChannel);
        var si = ch.securityInfo.QueryInterface(Ci.nsITransportSecurityInfo);
        var cert = si.serverCert;
        if (cert) {
          ov.rememberValidityOverride(HOST, PORT, cert, FLAGS, false); // permanent
          show("TRUST OK (permanent)\n" + HOST + ":" + PORT +
            " cert trusted.\nReopen TV Remote and scan — the TV is no longer 'unverified'.");
        } else {
          show("TRUST OK (session only)\nSession override is active — scan now.\n" +
            "Permanent capture found no cert; re-run after a reboot.");
        }
      } catch (e) {
        show("TRUST OK (session only)\nSession override is active — scan now.\n" +
          "Permanent step unavailable (" + e + "); re-run after a reboot.");
      }
    };
    xhr.send();
  } catch (e) {
    show("TRUST OK (session only)\nSession override is active — scan now.\n" +
      "Permanent step errored: " + e);
  }
}());

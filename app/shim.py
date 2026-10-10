"""Browser-storage client script, kept in Python so it is always bundled with the app."""
JS = r'''// Browser storage mode: data lives in localStorage; each request is replayed on the server against that state.
(() => {
  const K = "maplepro:v2", D = document;
  const st = () => { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch (e) { return {}; } };
  window.mpReset = () => { localStorage.removeItem(K); location.href = "/"; };
  const fail = m => { D.body.innerHTML = '<p style="padding:2rem;font:14px sans-serif">' + m + ' <a href="#" onclick="mpReset()">Reset local data</a></p>'; };
  async function go(method, url, form, push = true) {
    const s = st(); let r;
    try { r = await fetch("/__rpc", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, url, form, state: s.state || null, sig: s.sig || "", cookie: s.cookie || "" }) }); }
    catch (e) { fail("Could not reach the server (" + e + ")."); return; }
    if (!r.ok) { fail("Server error " + r.status + ": " + (await r.text()).slice(0, 200).replace(/</g, "&lt;")); return; }
    const j = await r.json();
    try { localStorage.setItem(K, JSON.stringify({ state: j.state, sig: j.sig, cookie: j.cookie })); } catch (e) { alert("Browser storage is full"); }
    if (j.location) return go("GET", j.location, null, push);
    if (j.text != null) { const a = D.createElement("a"); a.href = URL.createObjectURL(new Blob([j.text], { type: j.ctype })); a.download = j.filename; a.click(); return; }
    if (push && url !== location.pathname + location.search) history.pushState({}, "", url);
    if (j.html == null) return fail("Empty response.");
    D.open(); D.write(j.html); D.close();
  }
  D.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target || a.origin !== location.origin || a.getAttribute("href")[0] === "#") return;
    e.preventDefault(); go("GET", a.pathname + a.search);
  });
  D.addEventListener("submit", e => {
    e.preventDefault(); const f = e.target, m = (f.method || "get").toUpperCase(), u = f.getAttribute("action") || location.pathname;
    const p = new URLSearchParams(new FormData(f));
    if (m === "GET") return go("GET", u + "?" + p.toString());
    const form = {}; for (const [k, v] of p) (form[k] = form[k] || []).push(v); go(m, u, form);
  });
  if (!window.__mp) { window.__mp = 1; addEventListener("popstate", () => go("GET", location.pathname + location.search, null, false)); }
  if (D.documentElement.hasAttribute("data-shell")) go("GET", location.pathname + location.search, null, false);
})();
'''

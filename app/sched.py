"""Schedule + Budget engines (deterministic) and weather. The LLM only explains their output."""
import os, time, datetime as dt, httpx
from . import agents

def plan(tasks):
    D = dt.date.fromisoformat; by = {t["id"]: t for t in tasks}; memo = {}
    day = dt.timedelta(days=1)
    def ef(t, s): return es(t, s) + dt.timedelta(days=t["days"] - 1 + (t["slip"] if s else 0))
    def es(t, s):
        k = (t["id"], s)
        if k not in memo: memo[k] = D(t["start"]) if not t["pred"] else ef(by[t["pred"]], s) + day
        return memo[k]
    out = [{**t, "es": es(t, 1), "ef": ef(t, 1)} for t in tasks]
    if not out: return {"tasks": [], "finish": None, "baseline": None, "slip": 0}
    last = max(out, key=lambda x: x["ef"]); base = max(ef(t, 0) for t in tasks)
    o = {x["id"]: x for x in out}; crit, cur = set(), last
    while cur: crit.add(cur["id"]); cur = o.get(cur["pred"])
    for x in out: x["critical"] = x["id"] in crit
    return {"tasks": out, "finish": last["ef"], "baseline": base, "slip": (last["ef"] - base).days}

_wx = {"t": 0.0, "v": []}
def weather():
    if time.time() - _wx["t"] < 1800: return _wx["v"]
    try:
        d = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=8, params={
            "latitude": os.getenv("SITE_LAT", "43.77"), "longitude": os.getenv("SITE_LON", "-79.41"),
            "daily": "precipitation_sum,temperature_2m_min", "forecast_days": 7, "timezone": "auto"}).json()["daily"]
        _wx.update(t=time.time(), v=[{"date": a, "rain": b, "tmin": c} for a, b, c in zip(d["time"], d["precipitation_sum"], d["temperature_2m_min"])])
    except Exception: _wx.update(t=time.time() - 1500, v=[])  # retry in ~5 min
    return _wx["v"]

def wx_risks(tasks, days):
    out = []
    for t in tasks:
        if not t["wx"] or t["progress"] >= 100: continue
        bad = [w["date"] for w in days if t["es"].isoformat() <= w["date"] <= t["ef"].isoformat()
               and ((w["rain"] or 0) >= 5 or (w["tmin"] if w["tmin"] is not None else 9) <= 0)]
        if bad: out.append({"task": t["name"], "dates": bad})
    return out

def variance(lines):
    for l in lines: l["var"] = l["actual"] - l["budget"]; l["pct"] = round(l["var"] / l["budget"] * 100) if l["budget"] else 0
    return lines

def explain(lines, delays):
    over = [l for l in lines if l["var"] > 0]
    if not over: return "All categories are within the planned spend to date."
    tpl = " ".join(f"{l['category'].capitalize()} is {agents.money(l['var'])} over plan ({l['pct']}%)." for l in over)
    if delays: tpl += " Recent site delays: " + "; ".join(delays) + "."
    facts = [f"{l['category']} {agents.money(l['var'])} {l['pct']}%" for l in over] + delays
    out = agents.gemini_json("Explain this construction budget variance in 2 plain sentences for a project manager. "
                             f"Use ONLY these facts and no other numbers: {facts}. Return JSON {{\"text\": string}}.")
    return out["text"] if isinstance(out, dict) and isinstance(out.get("text"), str) and agents.grounded(out["text"], facts) else tpl

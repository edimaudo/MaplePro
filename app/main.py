"""Thin API: only the things that need secret keys (Gemini, PayPal). All app data lives in the browser (IndexedDB)."""
import os, hmac, json
from dotenv import load_dotenv
load_dotenv()
import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from . import paypal

app = FastAPI(title="MaplePro API")
PUBLIC = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public")

def guard(req: Request):  # optional shared access code so strangers cannot spend your sandbox
    code = os.getenv("ACCESS_CODE")
    if code and not hmac.compare_digest(req.headers.get("x-access-code", ""), code): raise HTTPException(401, "Access code required")

@app.get("/api/status")
def status():
    return {"paypal": paypal.live(), "gemini": bool(os.getenv("GEMINI_API_KEY")), "access_required": bool(os.getenv("ACCESS_CODE"))}

@app.post("/api/gemini")
async def gemini(req: Request):
    guard(req); prompt = str((await req.json()).get("prompt", ""))[:8000]; key = os.getenv("GEMINI_API_KEY")
    if not key or not prompt: return {"result": None}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"https://generativelanguage.googleapis.com/v1beta/models/{os.getenv('GEMINI_MODEL', 'gemini-3.5-flash')}:generateContent",
                             headers={"x-goog-api-key": key}, json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2}})
        r.raise_for_status(); return {"result": json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])}
    except Exception: return {"result": None}  # the app falls back to deterministic output

MAX_PAYOUT = lambda: float(os.getenv("MAX_PAYOUT", "100000"))
def _pos(v):
    if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0: raise HTTPException(400, "amount must be positive")
    return float(v)

@app.post("/api/paypal/{op}")
async def paypal_op(op: str, req: Request):
    guard(req); b = await req.json()
    try:
        if op == "invoice":
            items = [(str(n)[:120], _pos(a)) for n, a in b["items"]]
            return paypal.create_and_send(str(b["number"])[:60], str(b["email"]), items, str(b.get("note", ""))[:500], str(b["rid"])[:80])
        if op == "remind": return paypal.remind(str(b["id"]), str(b["subject"])[:200], str(b["note"])[:1000], str(b.get("rid", ""))[:80] or None)
        if op == "payout":
            items = [(str(i), str(e), _pos(a)) for i, e, a in b["items"]]
            if sum(a for _, _, a in items) > MAX_PAYOUT(): raise HTTPException(400, "payout exceeds MAX_PAYOUT")
            return paypal.payout(str(b["batch_id"])[:80], items, str(b.get("note", ""))[:200])
        if op == "balance": return {"balance": paypal.balance()}
        if op == "invoice-status": return {"status": paypal.invoice_status(str(b["id"]))}
        if op == "payout-status": return {"status": paypal.payout_status(str(b["id"]))}
    except HTTPException: raise
    except (KeyError, ValueError, TypeError): raise HTTPException(400, "bad request")
    except Exception as e: raise HTTPException(502, f"PayPal error: {str(e)[:150]}")
    raise HTTPException(404, "unknown operation")

app.mount("/", StaticFiles(directory=PUBLIC, html=True), name="web")

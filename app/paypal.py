"""PayPal sandbox client: Invoicing (create/send/remind) + webhook verification. Mock mode without credentials."""
import os, time, httpx
CUR = lambda: os.getenv("CURRENCY", "CAD")
BASE = lambda: os.getenv("PAYPAL_BASE", "https://api-m.sandbox.paypal.com")
_tok = {"v": None, "exp": 0.0}

def live() -> bool:
    return bool(os.getenv("PAYPAL_CLIENT_ID") and os.getenv("PAYPAL_CLIENT_SECRET"))

def _token() -> str:
    if _tok["v"] and time.time() < _tok["exp"] - 60: return _tok["v"]
    r = httpx.post(BASE() + "/v1/oauth2/token", data={"grant_type": "client_credentials"},
                   auth=(os.environ["PAYPAL_CLIENT_ID"], os.environ["PAYPAL_CLIENT_SECRET"]), timeout=30)
    r.raise_for_status(); j = r.json()
    _tok.update(v=j["access_token"], exp=time.time() + j["expires_in"]); return _tok["v"]

def _req(method, path, body=None, request_id=None):
    h = {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}
    if request_id: h["PayPal-Request-Id"] = request_id  # idempotency key
    for n in range(3):  # retry transient failures with backoff
        try:
            r = httpx.request(method, BASE() + path, headers=h, json=body, timeout=30)
            if r.status_code in (429, 500, 502, 503) and n < 2: time.sleep(2 ** n); continue
            r.raise_for_status(); return r
        except httpx.TransportError:
            if n == 2: raise
            time.sleep(2 ** n)

def create_and_send(number, email, items, note, request_id):
    if not live(): return {"id": f"MOCK-{number}", "mock": True}
    body = {"detail": {"invoice_number": number, "currency_code": CUR(), "note": note,
                       "payment_term": {"term_type": "NET_30"}},
            "primary_recipients": [{"billing_info": {"email_address": email}}],
            "items": [{"name": n, "quantity": "1",
                       "unit_amount": {"currency_code": CUR(), "value": f"{a:.2f}"}} for n, a in items]}
    inv_id = _req("POST", "/v2/invoicing/invoices", body, request_id).json()["href"].rstrip("/").split("/")[-1]
    _req("POST", f"/v2/invoicing/invoices/{inv_id}/send",
         {"send_to_recipient": True, "send_to_invoicer": False}, request_id + "-send")
    return {"id": inv_id}

def remind(inv_id, subject, note, request_id=None):
    if not live(): return {"id": inv_id, "mock": True}
    _req("POST", f"/v2/invoicing/invoices/{inv_id}/remind",
         {"subject": subject, "note": note, "send_to_invoicer": False}, request_id)
    return {"id": inv_id}

def verify_webhook(headers, event) -> bool:
    if not live(): return os.getenv("ALLOW_UNSIGNED_WEBHOOKS") == "1"
    body = {"auth_algo": headers.get("paypal-auth-algo"), "cert_url": headers.get("paypal-cert-url"),
            "transmission_id": headers.get("paypal-transmission-id"),
            "transmission_sig": headers.get("paypal-transmission-sig"),
            "transmission_time": headers.get("paypal-transmission-time"),
            "webhook_id": os.environ["PAYPAL_WEBHOOK_ID"], "webhook_event": event}
    try: return _req("POST", "/v1/notifications/verify-webhook-signature", body).json().get("verification_status") == "SUCCESS"
    except httpx.HTTPError: return False

def payout(batch_id, items, note):
    """items: [(sender_item_id, email, amount)]. batch_id doubles as PayPal's sender_batch_id (idempotent)."""
    if not live(): return {"batch": f"MOCK-{batch_id}", "mock": True}
    body = {"sender_batch_header": {"sender_batch_id": batch_id, "email_subject": "MaplePro payment", "email_message": note},
            "items": [{"recipient_type": "EMAIL", "amount": {"value": f"{a:.2f}", "currency": CUR()}, "receiver": e,
                       "note": note, "sender_item_id": i} for i, e, a in items]}
    return {"batch": _req("POST", "/v1/payments/payouts", body, batch_id).json()["batch_header"]["payout_batch_id"]}

def balance():
    """Available balance, or None if unknown (PayPal then fails the item itself if funds are short)."""
    if not live(): return None
    try: return float(_req("GET", f"/v1/reporting/balances?currency_code={CUR()}").json()["balances"][0]["available_balance"]["value"])
    except Exception: return None

def invoice_status(pid):
    if not live(): return None
    s = _req("GET", f"/v2/invoicing/invoices/{pid}").json().get("status", "")
    return {"PAID": "paid", "MARKED_AS_PAID": "paid", "CANCELLED": "cancelled", "REFUNDED": "refunded"}.get(s)

def payout_status(batch):
    if not live(): return None
    s = _req("GET", f"/v1/payments/payouts/{batch}").json()["batch_header"]["batch_status"]
    return {"SUCCESS": "paid", "DENIED": "failed", "CANCELED": "failed"}.get(s)

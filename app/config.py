from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    app_env = os.getenv("APP_ENV", "development")
    # Demo identities are synthetic; set false to require Supabase Auth users.
    demo_mode = _bool("DEMO_MODE", True)

    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    # Public key used only by the browser for Supabase Auth.
    supabase_anon_key = (
        os.getenv("SUPABASE_ANON_KEY", "")
        or os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    )
    # Server-side data access uses the already-configured API key first. If the
    # project uses a public/anon key, RLS still applies and demo access will need
    # a server-side service/secret key. Never return this key to the browser.
    supabase_api_key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        or os.getenv("SUPABASE_SECRET_KEY", "")
        or os.getenv("SUPABASE_API_KEY", "")
        or os.getenv("SUPABASE_KEY", "")
        or os.getenv("SUPABASE_ANON_KEY", "")
        or os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    )

    gemini_api_key = os.getenv("GEMINI_API_KEY", "")
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")

    paypal_client_id = os.getenv("PAYPAL_CLIENT_ID", "")
    paypal_client_secret = os.getenv("PAYPAL_CLIENT_SECRET", "")
    paypal_base_url = os.getenv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com").rstrip("/")
    paypal_webhook_id = os.getenv("PAYPAL_WEBHOOK_ID", "")
    firm_name = os.getenv("MAPLEPRO_FIRM_NAME", "Northline Construction Group")

    @property
    def paypal_configured(self) -> bool:
        return bool(self.paypal_client_id and self.paypal_client_secret)

    @property
    def supabase_auth_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_api_key)


settings = Settings()

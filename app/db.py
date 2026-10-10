import sqlite3, re, json, hmac, contextvars, datetime as dt, os, hashlib, secrets
URL = os.getenv("DATABASE_URL")  # Postgres when set
STORAGE = "postgres" if URL else os.getenv("STORAGE", "browser")  # browser (localStorage) | file (SQLite) | postgres
DB = os.getenv("MAPLEPRO_DB") or ("/tmp/maplepro.db" if os.getenv("VERCEL") else "maplepro.db")  # /tmp is the only writable, and ephemeral, path on Vercel
SCHEMA = """
create table if not exists clients(id integer primary key, name text, email text);
create table if not exists projects(id integer primary key, name text, client_id int, status text,
  budget real, spent real, progress int, due text, description text);
create table if not exists invoices(id integer primary key, number text unique, project_id int, client_id int,
  amount real, due_date text, status text, paypal_id text);
create table if not exists reports(id integer primary key, project_id int, raw text, structured text, created text);
create table if not exists actions(id integer primary key, agent text, kind text, ref_id int, title text,
  rationale text, payload text, status text default 'pending', result text, created text, decided text);
create table if not exists webhook_events(id integer primary key, event_id text unique, type text, payload text, created text);
"""
SCHEMA2 = """
create table if not exists users(id integer primary key, email text unique, name text, role text, client_id int, pw text);
create table if not exists members(user_id int, project_id int);
create table if not exists tasks(id integer primary key, project_id int, name text, days int, pred int, progress int default 0, slip int default 0, wx int default 0, start text);
create table if not exists timesheets(id integer primary key, project_id int, user_id int, work_date text, hours real, rate real, status text default 'submitted', payout_id int);
create table if not exists payouts(id integer primary key, project_id int, user_id int, amount real, holdback real, status text, batch_id text);
create table if not exists budget_lines(id integer primary key, project_id int, category text, budget real, actual real);
"""
def hash_pw(p):
    salt = secrets.token_bytes(16); return salt.hex() + ":" + hashlib.pbkdf2_hmac("sha256", p.encode(), salt, 200_000).hex()
def check_pw(p, h):
    salt, dk = h.split(":"); return secrets.compare_digest(hashlib.pbkdf2_hmac("sha256", p.encode(), bytes.fromhex(salt), 200_000).hex(), dk)

def to_pg(sql, schema=False):
    sql = sql.replace("?", "%s")
    return re.sub(r"\breal\b", "double precision", sql.replace("integer primary key", "serial primary key")) if schema else sql

class Row(dict):  # supports row["col"], row[0] and dict(row), like sqlite3.Row
    def __getitem__(self, k): return list(self.values())[k] if isinstance(k, int) else super().__getitem__(k)

class _R:
    def __init__(s, cur, last=None): s.cur, s.lastrowid = cur, last
    def fetchone(s): return s.cur.fetchone()
    def fetchall(s): return s.cur.fetchall()
    def __iter__(s): return iter(s.cur.fetchall())

class PG:
    """Minimal sqlite3-style adapter over psycopg so the app code is identical on both backends."""
    def __init__(s, url):
        import psycopg
        s.c = psycopg.connect(url, row_factory=lambda cur: (lambda v, n=[d.name for d in (cur.description or [])]: Row(zip(n, v))))
    def execute(s, sql, a=()):
        sql = to_pg(sql); m = re.match(r"\s*insert into (\w+)", sql, re.I)
        ret = bool(m) and m.group(1) != "members" and "returning" not in sql.lower()
        cur = s.c.execute(sql + (" returning id" if ret else ""), a)
        return _R(cur, cur.fetchone()["id"] if ret else None)
    def executemany(s, sql, seq): s.c.cursor().executemany(to_pg(sql), seq)
    def executescript(s, sql):
        for st in filter(str.strip, to_pg(sql, True).split(";")): s.c.execute(st)
    def commit(s): s.c.commit()
    def rollback(s): s.c.rollback()
    def close(s): s.c.close()

IntegrityError = (sqlite3.IntegrityError,) + ((__import__("psycopg").IntegrityError,) if URL else ())
_ready = False
MEM = contextvars.ContextVar("mem", default=None)  # per-request in-memory DB (browser storage mode)
TABLES = ["clients", "projects", "invoices", "reports", "actions", "webhook_events", "users", "members", "tasks", "timesheets", "payouts", "budget_lines"]
_KEY = lambda: (os.getenv("SECRET_KEY") or "dev-only-secret").encode()

class Keep:  # shared per-request connection whose close() is a no-op
    def __init__(s, c): s.c = c
    def __getattr__(s, k): return getattr(s.c, k)
    def close(s): pass

def mem_open(state):
    c = sqlite3.connect(":memory:", check_same_thread=False); c.row_factory = sqlite3.Row; c.executescript(SCHEMA + SCHEMA2)
    if state:
        for t, (cols, rows) in state.items():
            if t in TABLES and rows and all(re.fullmatch(r"\w+", x) for x in cols):
                c.executemany(f"insert into {t}({','.join(cols)}) values({','.join('?' * len(cols))})", rows)
    else: seed(c); seed2(c)
    return c

def dump(c):  # JSON text of every table; the browser stores it verbatim
    out = {}
    for t in TABLES:
        cur = c.execute(f"select * from {t}"); out[t] = [[d[0] for d in cur.description], [list(r) for r in cur.fetchall()]]
    return json.dumps(out, separators=(",", ":"))

sign = lambda text: hmac.new(_KEY(), text.encode(), "sha256").hexdigest()
verify = lambda sig, text: hmac.compare_digest(sig or "", sign(text))

def _open():
    if MEM.get() is not None: return MEM.get()
    if URL: return PG(URL)
    if STORAGE == "browser": raise RuntimeError("Browser storage mode: no state loaded for this request")
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row; return c

def conn():
    global _ready
    if STORAGE != "browser" and not _ready:  # serverless runtimes may skip the ASGI lifespan
        _ready = True
        try: init()
        except Exception: _ready = False; raise
    return _open()

def init():
    c = _open(); c.executescript(SCHEMA + SCHEMA2)
    if not c.execute("select count(*) from projects").fetchone()[0]: seed(c); seed2(c)
    c.commit(); c.close()

def seed(c):  # synthetic data, mirrors the demo set in the PRD ($793,500 overdue)
    t = dt.date.today(); d = lambda n: (t - dt.timedelta(days=n)).isoformat()
    c.executemany("insert into clients(name,email) values(?,?)", [
        ("Acme Real Estate Development", "client@example.com"),
        ("Downtown Commercial Properties", "billing@example.com"),
        ("Suburban Retail Group", "ap@example.com")])
    c.executemany("insert into projects(name,client_id,status,budget,spent,progress,due,description) values(?,?,?,?,?,?,?,?)", [
        ("Riverside Luxury Apartments", 1, "active", 3500000, 980000, 28, "2027-09-30",
         "12-story, 150-unit apartment complex with underground parking, pool, gym and rooftop terrace."),
        ("Downtown Office Tower Renovation", 2, "active", 2500000, 700000, 18, "2027-03-15",
         "Interior and facade renovation of a 9-story office tower."),
        ("Suburban Shopping Center", 3, "active", 1500000, 182200, 12, "2027-06-01",
         "New 40,000 sq ft retail center with shared parking.")])
    c.executemany("insert into invoices(number,project_id,client_id,amount,due_date,status) values(?,?,?,?,?,?)", [
        ("INV-2026-008", 1, 1, 250500, d(27), "sent"), ("INV-2026-009", 2, 2, 215000, d(15), "sent"),
        ("INV-2026-004", 2, 2, 328000, d(12), "sent"), ("INV-2026-011", 1, 1, 180000, d(-12), "sent"),
        ("INV-2026-012", 3, 3, 95000, d(-20), "sent"), ("INV-2026-002", 1, 1, 400000, d(60), "paid")])

def seed2(c):
    t = dt.date.today(); pw = hash_pw(os.getenv("DEMO_PASSWORD", "maple123"))
    c.executemany("insert into users(email,name,role,client_id,pw) values(?,?,?,?,?)", [
        ("admin@maplepro.test", "Admin User", "admin", None, pw), ("pm@maplepro.test", "Pat Manager", "staff", None, pw),
        (os.getenv("CLIENT_EMAIL", "client@example.com"), "Acme Client", "client", 1, pw),
        (os.getenv("SUB_EMAIL", "sub@maplepro.test"), "Sam Subcontractor", "subcontractor", None, pw)])
    c.executemany("insert into members values(?,?)", [(4, 1), (4, 2)])
    chains = {1: [("Excavation", 10, 100, 0), ("Foundation", 14, 100, 1), ("Framing", 20, 40, 0), ("Roofing", 10, 0, 1), ("Drywall", 12, 0, 0)],
              2: [("Demolition", 12, 100, 0), ("Facade work", 25, 30, 1), ("Interior fit-out", 30, 0, 0)],
              3: [("Site prep", 8, 100, 0), ("Concrete slab", 10, 50, 1), ("Steel frame", 20, 0, 0)]}
    for pid, ts in chains.items():
        prev = None
        for i, (n, d, pr, wx) in enumerate(ts):
            pred = prev if (n != "Drywall") else prev - 1
            cur = c.execute("insert into tasks(project_id,name,days,pred,progress,wx,start) values(?,?,?,?,?,?,?)",
                            (pid, n, d, pred if i else None, pr, wx, (t - dt.timedelta(days=45)).isoformat())).lastrowid
            prev = cur
    c.executemany("insert into timesheets(project_id,user_id,work_date,hours,rate,status) values(?,?,?,?,?,?)", [
        (1, 4, (t - dt.timedelta(days=9)).isoformat(), 40, 65, "approved"), (1, 4, (t - dt.timedelta(days=2)).isoformat(), 36, 65, "approved"),
        (1, 4, t.isoformat(), 8, 65, "submitted")])
    for p in c.execute("select * from projects").fetchall():
        plan = p["budget"] * p["progress"] / 100
        for cat, pl, ac in [("labor", .30, .38), ("materials", .35, .30), ("equipment", .10, .10), ("subs", .25, .22)]:
            c.execute("insert into budget_lines(project_id,category,budget,actual) values(?,?,?,?)", (p["id"], cat, round(plan * pl), round(p["spent"] * ac)))

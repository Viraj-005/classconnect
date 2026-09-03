<div align="center">

<img src="./brand/product/classconnect-logo.svg" alt="ClassConnect" width="440">
<br>
<br>

**Multi-tenant SaaS Learning Management System**

Content, fees, attendance and analytics for schools and tutoring centres,
with each organisation fully isolated from the next.

<br>

<sub>A product of</sub><br><br>
<img src="./brand/company/looplab-logo.png" alt="LoopLab" width="120">

</div>

<br>

## The two marks

These are different things and the codebase keeps them apart deliberately, because
conflating them is a bug that already happened once.

| | Mark | Whose | Changeable |
|---|---|---|---|
| <img src="./brand/product/classconnect-icon.svg" width="40"> | **ClassConnect** | The product | No. It ships with the build |
| <img src="./brand/company/looplab-logo.png" width="40"> | **LoopLab** | The company operating the instance | Yes, uploaded at `/platform/branding` |

The product mark is the name of the software, not of anyone running it. It is also what
lets an operator with two tabs open tell the platform console from a tenant, so a Super
Admin who could re-skin it would delete exactly that signal. The company mark is uploaded,
because the company running an instance can change and the product it runs cannot.

A third category sits under both: a **tenant's own logo**, uploaded by their admin and
shown throughout their portals. Growth and Pro only.

## Overview

ClassConnect is one deployment serving many schools at once. A tenant signs up, brands
their portals, enrols students, publishes content, collects fees, takes attendance, sets
quizzes and reads analytics, and never sees a row belonging to anybody else.

### Who uses it

Five portals, each a different job rather than the same screens with buttons hidden.

| Portal | Who | What they do |
|---|---|---|
| **Platform** | LoopLab | Every tenant, their tier and standing, revenue, cross tenant audit, company branding |
| **Admin** | The school | People, batches, page access, branding, plan and billing, audit log |
| **Teacher** | Staff | Content, quizzes, marking, attendance, schedule, fees, students, analytics |
| **Student** | Learners | Classes, resources, quizzes, results, schedule, fees, attendance |
| **Parent** | Guardians | Their children's attendance, results, fees and schedule |

33 portal screens plus a portal neutral account screen, login, signup and a splash.

### Packages

Free is a tier, not a trial. A school evaluates over a term rather than a fortnight, and a
countdown pushes the decision before they have taught a single class on it. So Free never
expires and is capped by size instead. It carries the entire core loop, so a tutoring class
of twenty five runs its whole operation on it, and pays when it outgrows it.

| | Free | Starter | Growth | Pro |
|---|---|---|---|---|
| **Per month** | Rs 0 | Rs 7,500 | Rs 25,000 | Rs 75,000 |
| **Students** | 25 | 100 | 500 | Unlimited |
| **Teachers** | 2 | 5 | 25 | Unlimited |
| QR class tickets | no | no | yes | yes |
| Payment gateway | no | no | yes | yes |
| Full analytics | no | no | yes | yes |
| Logo and accent colour | no | no | yes | yes |
| Full palette | no | no | no | yes |
| Analytics export | no | no | no | yes |
| Multi currency fees | no | no | no | yes |
| Custom domain | no | no | no | yes |

Pricing is provisional. Final tiers are the founder's call, to be settled before the first
paid tenant signs.

### Two money flows that never meet

This is the distinction the code refuses to blur.

- **Student fees.** A tenant collecting from its own students. Any currency on Pro.
- **Subscriptions.** LoopLab charging the tenant. LKR only, always.

Different money, different stakeholders, separate services, separate credentials, separate
screens. They are never added together.

### Stack

| | |
|---|---|
| **Web** | React 19, Vite 6, Tailwind CSS v4, react-router 7, Recharts. Plain JavaScript (JSX), no TypeScript |
| **API** | FastAPI, SQLAlchemy 2.0 async, Pydantic v2, Alembic, asyncpg |
| **Database** | PostgreSQL 18, shared database and shared schema, every tenant scoped table carrying an indexed `org_id` |
| **Auth** | JWT access and refresh, bcrypt, TOTP two factor implemented against the RFC vectors |
| **Storage** | Postgres holds the index, a local `media/` directory holds the bytes |

### Security posture

The named classes this was built against, and where each is answered.

| Risk | Answer |
|---|---|
| Broken access control, IDOR | `org_id` is resolved from the session and never accepted from a request. Every id taking handler filters on it. Cross tenant reads need `require_platform_access`, not merely the `super_admin` role, and are separately audited |
| SQL, command and code injection | ORM parameter binding throughout, no raw SQL, no `eval`, no `subprocess`, no `pickle` |
| Vulnerable or hallucinated dependencies | Every dependency pinned and declared, checked as installed, with nothing imported that is not in `requirements.txt` |
| Weak authentication | bcrypt, TOTP with single use recovery codes, a challenge token that carries no role claim, and a startup guard that refuses default secrets outside development |
| Client side logic as enforcement | The nav hides what a role cannot reach, and every guarded route re-checks server side and returns 403 |
| Unsafe uploads | Extension allowlist rather than blocklist, keys built server side, path containment checked, fixed content types, `nosniff`, and no SVG |

## Documents

| Document | What it covers |
|---|---|
| [files/BRD.md](./files/BRD.md) | Business requirements, packages, roles, workflows |
| [files/ARCHITECTURE.md](./files/ARCHITECTURE.md) | System design, multi-tenancy, data model, UI direction |

## Layout

```
brand/
  source/       the supplied logo and app icon artwork, source of truth
  product/      ClassConnect marks, generated from source, used in docs
  company/      LoopLab's own mark, the operator's, a different thing
apps/
  web/          React 19 + Vite + Tailwind v4, plain JavaScript (JSX)
    public/                   favicons, PWA icons, manifest, all generated
    scripts/brand/            traces brand/source into vector, run by hand
    src/
      brand/                  LogoMark, LogoLockup, AppIcon and their paths
      styles/tokens.css       the three token layers, read this first
      theme/                  tenant theming, colour maths, contrast guard
      lib/api.js              the only module that talks to the API
      lib/useApi.js           data fetching hook
      components/
        Icon.jsx              hand drawn icon set, one 24 grid
        AccessMatrix.jsx      shared page access editor
        charts.jsx            Recharts, fully token styled
        ui/                   primitives and designed states
        shell/                icon rail, nav panel, topbar, route guard
      portals/                teacher, student, parent, admin, superadmin
  api/          FastAPI + SQLAlchemy 2.0 async
    app/
      middleware/tenant.py    THE security boundary, read before adding a route
      services/tier_policy.py pure tier rules, no framework imports
      services/page_registry.py  pure page access rules
      services/qr_service.py  signed class tickets
      services/quiz_service.py   pure marking, choice, multi and written
      services/storage_service.py  where an upload feature usually goes wrong
      services/csv_service.py    export escaping, formula injection included
      routers/                one per portal, plus auth, access and exports
    media/                    uploaded bytes, gitignored, Postgres is the index
    alembic/                  migrations, env.py resolves the URL from settings
    scripts/seed.py           runs migrations, then seeds three tenants
    tests/                    adversarial isolation and access tests
```

## Running it

You need two processes: the API and the web app.

### 1. API

The virtualenv lives at `apps/api/.venv`, beside `requirements.txt`.

```bash
cd apps/api && python -m venv .venv
```

```bash
cd apps/api && .venv/Scripts/python.exe -m pip install -r requirements-dev.txt
```

On macOS or Linux the interpreter is `.venv/bin/python` instead.

Create the database and seed three tenants. The seed runs the real
Alembic migrations, so this is also the fastest way to check them:

```bash
cd apps/api && .venv/Scripts/python.exe -m scripts.seed --reset
```

`--reset` rolls every migration back, which drops every table. The three demo tenants come
back on the next run. Anything created through `/signup` does not, so the script now counts
organisations it did not create, lists them, and refuses. Add `--delete-real-tenants` if
you genuinely mean it. This exists because a free tier tenant somebody had signed up to try
the product was lost to exactly this, and nothing in the output said so.

Run it:

```bash
cd apps/api && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

Docs on http://localhost:8000/docs.

### Choosing a database

With no database settings at all the app falls back to SQLite at `apps/api/classconnect.db`,
so it runs with nothing installed. That is a development convenience and a real deviation
from ARCHITECTURE.md section 2. Two things depend on real Postgres: the Row Level Security
hardening layer planned for Phase 3, and case insensitive `ILIKE` search, which SQLite
silently treats as `LIKE`.

To point at Postgres, put the five parts in `apps/api/.env`:

```
DB_NAME=classconnect
DB_USER=postgres
DB_PASSWORD=your-password
DB_HOST=localhost
DB_PORT=5432
```

`app/core/config.py` assembles the URL from those and percent encodes the password, which
is the part worth not doing by hand. A password containing `#`, `@` or `/` produces a URL
that a strict parser reads as a different host, and the only symptom is an authentication
error that points nowhere.

`DATABASE_URL` still works and takes precedence when set, for a host that injects one or
for a target the five parts cannot describe. Set one or the other, not both: a stale
`DATABASE_URL` silently overrides the five parts, which is exactly the trap that had this
app talking to a role that did not exist.

Create the database first, then migrate:

```bash
psql -U postgres -c "CREATE DATABASE classconnect"
```

Then apply the migrations. See [Migrations](#migrations) below for the rest:

```bash
cd apps/api && .venv/Scripts/python.exe -m alembic upgrade head
```

### 2. Web

```bash
cd apps/web && npm install && npm run dev
```

Opens on http://localhost:5173 and proxies `/api` to port 8000, so there is no CORS in the
loop.

#### Configuration

Copy `apps/web/.env.example` to `apps/web/.env` if you need to change anything. Both
variables have working defaults, so an unmodified checkout runs with no `.env` at all.

| Variable | Default | What it does |
|---|---|---|
| `VITE_API_TARGET` | `http://127.0.0.1:8000` | Where the dev server proxies `/api`. Development only, read on the Node side, never bundled |
| `VITE_API_URL` | `/api/v1` | The base the client prefixes onto every call. Leave unset unless the API is on a different origin |

No backend host appears anywhere in `src/`. The client's default base is the relative
`/api/v1`, which is right in development because the dev server proxies it, and right in
production when the app and the API sit behind one reverse proxy. The only literal host in
the repo is the proxy target in `vite.config.js`, which is a Node side value and never
reaches the bundle.

Setting `VITE_API_URL` to an absolute URL puts you in cross origin territory, so the API's
`CORS_ORIGINS` then has to name this app's origin or every request fails preflight.

**Nothing secret goes in the web `.env`.** Every `VITE_` variable is inlined into the
bundle at build time as a string literal, so it ships to the browser and is readable with
view source. Secrets belong in `apps/api/.env`, which the server reads and never sends
anywhere. Vite enforces half of this by refusing to expose any variable without the `VITE_`
prefix to client code, which is a guard against leaking by accident rather than permission
to leak on purpose.

### Checks

Backend:

```bash
cd apps/api && .venv/Scripts/python.exe -m pytest -q
```

Frontend, all three in one:

```bash
cd apps/web && npm run verify
```

That runs `lint`, `check:api` and `build`. The middle one is not
standard tooling, it exists because of a real bug: a screen called
`studentApi.quizzes()` when the client had no such method. The build
cannot see it (the object exists), and ESLint cannot see it (a missing
property is just `undefined`), so it shipped as a runtime crash on three
pages and a silently empty table on a fourth. `scripts/check-api-calls.mjs`
cross checks every `xApi.method()` call against the client.

`npm run lint` also carries `no-undef`, added after a deleted fixture
left a dangling identifier that crashed the whole app while `vite build`
stayed green.

## Brand assets

The logo and app icon live in `brand/source/` as supplied. Everything the app uses is
generated from them and committed:

```bash
python apps/web/scripts/brand/generate.py && python apps/web/scripts/brand/build.py
```

That writes `apps/web/public/` (favicons in SVG, PNG and ICO, the PWA icons, the manifest)
and `apps/web/src/brand/paths.js`. It needs Pillow and numpy, runs in about ten seconds,
and reproduces the committed files byte for byte, so a clean run is also the check that
nothing has drifted.

The artwork is traced to vector rather than used as-is because the delivered JPEGs have no
alpha, and the mark has to sit on a near black sidebar, a tenant coloured login panel and
a white form. Tracing gives a shape that takes its colour from the surface it sits on,
which a flattened JPEG cannot. Do not edit `paths.js` by hand.

## Migrations

Alembic, with the schema as one initial revision. The seed script runs
`upgrade head` rather than `create_all`, so a local database is built
exactly the way production is and a broken migration fails on your
machine instead of at deploy.

Apply everything:

```bash
cd apps/api && .venv/Scripts/python.exe -m alembic upgrade head
```

After changing a model, generate a revision and read what it produced:

```bash
cd apps/api && .venv/Scripts/python.exe -m alembic revision --autogenerate -m "add whatever"
```

Autogenerate is a starting point, not an answer. It does not see data
migrations, renames (it reads them as a drop plus an add, which loses the
column), or anything it cannot infer from the models. Read every
generated file before committing it, and run `ruff format
alembic/versions` since the post write hook is deliberately disabled (see
the note in `alembic.ini`).

Roll back one step, or all the way:

```bash
cd apps/api && .venv/Scripts/python.exe -m alembic downgrade -1
```

Emit SQL instead of running it, for a change a DBA wants to review:

```bash
cd apps/api && .venv/Scripts/python.exe -m alembic upgrade head --sql
```

Point at a different database without touching `.env`:

```bash
cd apps/api && .venv/Scripts/python.exe -m alembic -x db_url=postgresql+asyncpg://user:pass@host/db upgrade head
```

Three things about `alembic/env.py` are worth knowing before you edit
it. It resolves the URL from `app.core.config` so migrations and the app
can never disagree about the target. It turns on batch mode for SQLite
because SQLite cannot `ALTER` a column, so without it a migration that
alters one passes on Postgres and fails locally. And it doubles the
percent signs before handing the URL to Alembic's config object, which
is a `configparser` and applies `%`-interpolation to every value it
stores: a percent encoded password (`%23` for `#`) otherwise raises
`invalid interpolation syntax` before a single statement runs.

`tests/test_migrations.py` builds a database from the migrations alone
and asserts autogenerate finds nothing left to do. That is the check
that catches a model changed without a migration, which is otherwise
only discovered at deploy. It uses a throwaway SQLite file, so it does
not care what `.env` points at.

The initial revision is dialect neutral and has been applied to both
SQLite and Postgres 18, with zero autogenerate drift on each.

## How a tenant is reached

In production each organisation has its own address, and the login screen shows that one
school, branded, with no picker.

| Hostname | Resolves to |
|---|---|
| `horizon.classconnect.app` | the `horizon` tenant |
| a custom domain (Pro) | whichever tenant owns it |
| `console.looplab.io` | the platform console, never listed anywhere |
| `localhost`, `127.0.0.1` | nothing, so the picker and demo shortcuts show |

Two settings drive it, both empty by default so a fresh checkout keeps the picker:

```
APP_DOMAIN=classconnect.app
PLATFORM_HOST=console.looplab.io
```

**The hostname decides which login form to paint and nothing else.** It never sets the
organisation for an authenticated request: that still comes from the session, resolved in
`app/middleware/tenant.py`. This matters because the `Host` header is written by the
client, so anyone can claim to be any tenant, and the worst that achieves is seeing that
tenant's login page. If the hostname ever started deciding whose data a request could read,
that same header would become a way to ask for somebody else's.

Why it is worth doing: the picker published a complete customer list to anyone who could
load the page, which is competitive intelligence and a ready made phishing target list.
Bound hostnames return one organisation, and outside development an unbound one returns
none at all rather than falling back to the roster.

Deployment needs wildcard DNS for `*.classconnect.app` and a wildcard certificate, plus a
reverse proxy that forwards the original `Host`. The dev server does the same, which is why
its proxy runs with `changeOrigin: false`. Try it locally with `horizon.localhost:5173`,
which browsers resolve to loopback without a hosts file entry, and `APP_DOMAIN=localhost`.

## Operational endpoints

Three unauthenticated endpoints, and the difference between the last two is the point.

| Endpoint | Answers | Fails when |
|---|---|---|
| `/` | What is this service | Never. It describes, it does not check |
| `/health` | Should this process be restarted | Never, by design |
| `/ready` | Should this instance receive traffic | The database is unreachable |

`/health` is liveness and deliberately does not touch the database. A liveness probe that
fails during a database outage tells the orchestrator to restart the app, which does not
repair the database and stacks a restart loop on top of the outage.

`/ready` is readiness and genuinely reaches Postgres, so failing takes the instance out of
the load balancer without killing it, leaving it there to recover. It carries a three
second timeout, because a probe that hangs is worse than one that fails: the caller's
timeout ends up deciding, while the probe holds a connection from a pool already in
trouble. Its failure body is generic, since a driver error names the host, the database and
sometimes the password, and this endpoint is readable by anyone who can reach the port.

`tests/test_ops_endpoints.py` asserts all of that, including that `/health` keeps answering
while the database is down and that the two have not been merged.

## Signing in

Every seeded account uses the password `demo1234`. The login screen has shortcut buttons
for each role.

| Role | Email | Organisation |
|---|---|---|
| Super Admin | viraj@looplab.io | looplab |
| Admin | admin@horizon.lk | horizon |
| Teacher | dinesh@horizon.lk | horizon |
| Student | amaya@horizon.lk | horizon |
| Parent | parent@horizon.lk | horizon |

The same five roles exist at `northfield` (Pro) and `brightpath` (Starter, past due), which
is how the tier gating, the grace banner and the seat cap warnings are exercised.

A school can also sign itself up at `/signup`, which creates a tenant on the **Free**
plan: 25 students, 2 teachers, no card, and nothing that expires. Free carries the whole
core loop (content, fees, schedule, parent portal) because a cap on scale lets a tenant
judge the product, while a cap on function does not. The tier is forced server side, so a
crafted signup cannot provision itself onto a paid plan.

Platform subscriptions are LKR only, at Rs 7,500 (Starter), Rs 25,000 (Growth) and
Rs 75,000 (Pro) a month. Those are still the founder's call.
Student fees are the other money flow entirely and may be in another currency on Pro.

## Two factor authentication

TOTP, implemented in `app/core/totp.py` rather than pulled from a package, for the same
reason bcrypt is used directly: the algorithm is short, RFC 6238 publishes test vectors,
and `tests/test_totp.py` checks against them.

The state machine is two columns, and the split is the point. `totp_secret` without
`totp_confirmed_at` is an abandoned enrolment, and only the confirmation turns the
challenge on. Without that, closing the tab halfway through setup would lock the account.

Login returns one of two shapes. When 2FA is on it returns a **challenge token**, which is
a distinct token type carrying no role claim, so it cannot be replayed against any other
route. Ten single use recovery codes are shown exactly once and stored as SHA-256 digests,
not bcrypt, because a fifty bit random code does not need a slow hash and verifying ten of
them with bcrypt would add a second to a login by somebody who has already lost their
phone.

Turning it off, or regenerating the codes, needs the password again. A live session is
precisely what an attacker has at an unlocked machine, which is the thing the second factor
is there to survive.

## The three rules that matter most

**1. `org_id` never comes from the client.** It is resolved from the authenticated session
in `app/middleware/tenant.py` and nowhere else. No request schema accepts an `org_id` for
filtering. If you want to add one, that is the bug.

**2. The two money flows never share a code path.** `StudentPayment` is a tenant collecting
fees from its own students. `Subscription` is LoopLab charging the tenant. Different money,
different stakeholders, separate services, separate Stripe credentials, separate screens.

**3. Hiding is not enforcing.** The nav hides pages a role cannot reach, but every guarded
route re-checks server side and returns 403. The client copy of the rules exists so the UI
can explain itself, not to decide anything.

## Page access control

Per role, per page, at two scopes.

- **LoopLab Super Admin** sets the platform default at `/platform/access`. That is the
  ceiling for every tenant.
- **Tenant Admin** narrows within it at `/admin/access`, for teacher, student and parent.

An admin cannot widen past the platform ceiling, cannot edit the admin role itself, and
cannot switch off a page marked locked in the registry (every portal's landing page, and
the access control screens). Resolution order is tier gate, then platform, then
organisation. The rules live in `app/services/page_registry.py` with no framework imports,
and are covered by `tests/test_page_access.py`.

## Build status

Working end to end:

- Design system: tokens, tenant theming with a contrast guard, icons, charts, all UI states
- Alembic migrations, with a drift test that fails if a model outruns them
- Five portals, 33 screens plus a portal neutral account screen, all reading from the API
- Auth with JWT access and refresh, org scoped login, session bootstrap
- Self service account: change your own name and password, both scoped to the caller
- Tenant isolation, RBAC, package tier gating, seat caps
- Page access control, both scopes, enforced server side
- Signed QR class tickets, issue and validate, with cross tenant rejection audited
- Prices in LKR throughout, both money flows, with one shared rule for tenant revenue
- A free plan (25 students, 2 teachers) with self serve onboarding at /signup
- Two factor authentication, TOTP with recovery codes, verified against the RFC vectors
- A working quiz engine: questions, attempts, server side marking, review with the key
- Multiple answer questions, written answers, a teacher marking queue, and every mark
  editable by hand, because auto marking is a starting point and not a verdict
- Attendance register and content view tracking, so no dashboard figure is generated
- Batches and groups, created by the admin, used by teachers when enrolling students
- Media upload on local disk with Postgres as the index, an extension allowlist, path
  containment and no SVG, ready to move to S3 by changing only the key resolution
- Branding at three levels: the ClassConnect product mark (fixed), LoopLab's company logo
  (uploaded by Super Admin) and a tenant's own logo (uploaded by their admin, Growth and above)
- CSV exports for people, payments, attendance, quiz results, audit and tenants
- Liveness and readiness endpoints that answer different questions, with the readiness one
  actually able to fail
- 272 passing tests, including adversarial cross tenant and access escalation attempts

Not done, and needing real work before this ships:

- **Stripe and PayPal.** Configured, not implemented. Student payments record manually and
  a tenant cannot self serve a tier change, which the billing screen says plainly.
- **S3 upload.** Files are stored on local disk instead, with Postgres as the index. That
  split survives the move: the database is the index, the object store is the bytes, and
  only the key resolution changes. Local disk does not survive a multi instance deploy.
- **Notification dispatch and background jobs.** Nothing sends email or push yet, so the
  Preferences screen says that outright rather than offering switches that do nothing.
  This also blocks password reset, which is why there is no self service one.
- **Changing your own email.** Read only on the account screen. It is a sign in identity,
  so it needs a verification round trip that does not exist yet. An admin changes it.
- Postgres row level security as the second isolation layer
- React Native app

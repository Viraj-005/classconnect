# ClassConnect Handover Document

Project: ClassConnect (Learning Management System)
Owner: LoopLab
Product type: Multi-tenant SaaS, sold on package tiers to schools, tutoring centers, and individual educators
Purpose: Orient any developer picking up this project, what exists, what is left, and how to work on it.

Last updated: 4 September 2026

> Style rule for this entire codebase: no em dashes in any code, comments, or documentation. Use commas, periods, or parentheses instead.

> This file is internal. It is excluded from the public repository because it carries commercial open questions and a phase plan. [BRD.md](./BRD.md) and [ARCHITECTURE.md](./ARCHITECTURE.md) are published, and neither refers to this document, so nothing in the public repo points at a file a reader cannot open.

---

## 1. Current Status

ClassConnect is built and running end to end against local Postgres. The earlier version of this document said no code existed under LoopLab, which was true when it was written and is no longer.

What exists now:

- A working FastAPI backend and React 19 web app, both running against PostgreSQL 18.
- Five portals (Platform, Admin, Teacher, Student, Parent), 33 screens plus a portal neutral account screen, login, signup and splash.
- Shared database multi-tenancy with `org_id` on every tenant scoped table, resolved from the session and never accepted from client input.
- 325 passing tests, including adversarial cross tenant and privilege escalation attempts.
- Alembic migrations with a drift test that fails if a model outruns them.

The two things standing between this and a sellable product are payment integration and notification dispatch. Neither is a design problem, both are integration work.

## 2. What Needs to Be Built

Multi-tenancy and package gating were built into Phase 1 as intended, not retrofitted.

### Phase 1: Core MVP (multi-tenant foundation included)

- [x] Project scaffolding: FastAPI backend structure, React frontend structure, repo setup.
- [x] Organization and Subscription models, tenant onboarding flow (both sales assisted and self service).
- [x] Tenant isolation middleware: `org_id` enforced on every tenant scoped query, never accepted from client input.
- [x] Auth and RBAC: login, role assignment across all five roles, JWT with `org_id` and `role` claims.
- [x] Core data model: User, Teacher, Student, Content, StudentPayment, Event, plus migrations.
- [x] Feature gating service: tier checked before every gated action, from a pure policy module.
- [x] Teacher Portal: content upload, quiz authoring, marking, attendance, schedule, fees, analytics.
- [x] Student Portal: resources, quizzes, results, schedule, fees, attendance.
- [x] Fee management: monthly fees, paid and unpaid tracking.
- [ ] **Student payment integration: Stripe and PayPal.** Configured and not implemented. Payments record manually and the billing screen says so rather than pretending otherwise.
- [x] QR ticket generation and scanning, including the org match check on scan.
- [x] Admin Portal: people, batches, page access, branding, plan and billing, audit log.
- [x] Super Admin Portal: tenants, tiers, subscription status, platform health, cross tenant audit.
- [ ] **Platform billing: Stripe Billing for tenant subscriptions.** Same as above. The separation from student payments is already enforced in code, so wiring one does not risk the other.
- [x] Core UI design system: tokens, typography, base components, tenant theming with a contrast guard.

### Phase 2: Analytics, Parent Portal, and Deeper Customization

- [x] Analytics engine, tier gated depth, counting real rows rather than generating figures.
- [x] Teacher Dashboard: engagement, revenue, quiz pass rate.
- [x] Parent Portal: attendance, results, fees, schedule per child.
- [x] Event Scheduler.
- [ ] **Notification system.** Nothing sends email or push. This also blocks self service password reset, which is why there is none. The Preferences screen says this outright rather than offering switches that do nothing.
- [x] Tenant branding: logo and accent colour (Growth), full palette and custom domain (Pro).
- [x] Super Admin Dashboard: tenants by tier, monthly recurring revenue, tenants at risk.

### Phase 3: Mobile and Polish

- [ ] React Native app. Not started.
- [x] Full design pass across all portals, holding up under tenant theme overrides.
- [ ] Performance validation against 1,000 concurrent users, under 2 second load. Not measured.
- [x] Security review of the named risk classes: broken access control and IDOR, injection, dependency provenance, weak authentication, client side logic as enforcement.
- [x] Rate limiting on the unauthenticated endpoints, in process. A per IP limit in front of the app is still needed, since the in process one resets on restart and each worker counts separately.
- [ ] **Postgres Row Level Security** as a hardening layer on top of the application level checks. This is the largest remaining security item.
- [ ] Encryption at rest. A deployment concern, not yet configured.

### Delivered beyond the original scope

Things this build added that were not in the original plan, each because the product needed them:

- Two factor authentication (TOTP with recovery codes, verified against the RFC 6238 test vectors).
- A **Free tier** (25 students, 2 teachers) with self service signup, which was previously listed under Future Enhancements. Free is a tier and not a trial: a school evaluates over a term, and a countdown forces the decision before they have taught a class on it.
- A working quiz engine with single answer, multiple answer and written questions, a teacher marking queue, and every mark editable by hand.
- Attendance register and content view tracking, which is what made the analytics real rather than synthetic.
- Batches and groups, created by the admin and used by teachers when enrolling students.
- Media upload on local disk with Postgres as the index, ready to move to S3 by changing only the key resolution.
- Host based tenant resolution: a tenant reaches ClassConnect at its own address and the login screen shows that one school. The platform console sits on its own hostname and is listed nowhere.
- CSV exports across people, payments, attendance, quiz results, audit and tenants.
- Liveness and readiness endpoints that answer different questions, with the readiness one able to fail.

### Future Enhancements (not scoped for MVP)

- AI driven grade predictions.
- Gamification (student badges).
- Zoom and Google Meet integration.
- Usage based add ons (extra seats beyond a tier's cap).
- Changing your own email. Read only today, because it is a sign in identity and needs a verification round trip that does not exist without notifications.
- Moving a specific enterprise tenant to an isolated database or schema, if ever contractually required.

## 3. Design Handoff Notes

The design pass is done. These notes are kept because they explain why the system looks the way it does.

1. ARCHITECTURE.md section 10 was the brief, and the founder's instruction was explicit: this must not look like a generic AI generated dashboard.
2. The token file was built first, which is what made tenant theming possible without a rewrite. Every component pulls from tokens.
3. The Teacher Portal was designed first as the reference pattern, then extended to the other four.
4. Tenant theming was prototyped early rather than discovered late. The contrast guard exists because a tenant can pick a colour that fails against white text, and the system has to stay legible anyway.
5. See [DESIGN.md](../DESIGN.md) for the token architecture and the research synthesis behind it.

## 4. Developer Notes

The rules that still matter, and what this build learned.

- **Never accept `org_id` as a client controllable filter.** Always derive it from the authenticated session. This is rule one and there is a test suite that attacks it.
- **Keep student payments and platform billing fully separate.** Different money, different stakeholders, separate services, separate credentials, separate screens. They are never added together.
- **Card data never touches ClassConnect's own database or logs.** Stripe and PayPal hold their respective PCI-DSS scope.
- Keep routers thin, put business logic in `services/`. The pure modules (`tier_policy`, `page_registry`, `quiz_service`, `host_resolver`) have no framework imports, which is what makes them testable without a database.
- Use Alembic for all schema changes, no manual DB edits. Read every autogenerated revision before committing it: it does not see data migrations or renames, and it emits `sa.text('now()')` which is Postgres only and breaks the SQLite migration test.
- Match LoopLab-IMS conventions where reasonable so ops stays consistent across products.
- No em dashes anywhere.

Learned the hard way, worth not rediscovering:

- **A hostname decides which login form to paint and nothing else.** It must never set the organisation for an authenticated request, because the Host header is written by the client.
- **A response whose body depends on the credentials must not be cacheable.** The logo route carries no org id by design, so a browser served one tenant's logo to the next tenant signing in on the same machine. It is `no-store` now.
- **Liveness and readiness answer opposite questions.** A liveness probe that fails on a database outage tells the orchestrator to restart the app, which does not repair the database.
- `--reset` on the seed script drops every table. Self service tenants do not come back. There is now a guard that refuses unless `--delete-real-tenants` is passed, added after a real free tier tenant was lost to it.

## 5. Open Questions for the Founder

Resolved since the last version:

- ~~Whether tenant onboarding at launch is sales assisted only, or self service is needed from day one.~~ Both exist. Sales assisted onboarding creates any tier; self service creates a Free tenant.

Still open, and these should be settled before the first paid tenant signs:

- **Final package tier names, limits, and pricing.** The current values (Free, Starter Rs 7,500, Growth Rs 25,000, Pro Rs 75,000) are a starting proposal on the 1 : 3.3 : 10 ladder the BRD suggested, denominated natively rather than converted at a guessed rate.
- Whether LoopLab takes a platform fee on student payments processed through a tenant's Stripe or PayPal, or whether that revenue is entirely the tenant's. This one blocks the payment integration design, not just the commercials.
- Hosting target: continue on EC2 and systemd like LoopLab-IMS, or move to a managed setup. This matters more now that multiple tenants share infrastructure, and the rate limiting story depends on it (per IP limiting belongs in front of the app).
- The domain to run tenants on. `APP_DOMAIN` and `PLATFORM_HOST` are configured but empty, and going live needs wildcard DNS plus a wildcard certificate.
- Budget and timeline for custom illustration versus the current icon only visual system.
- Whether React Native is the mobile approach, or native Android and iOS long term.
- Whether any enterprise tier customer is expected to require an isolated database, which would change the Row Level Security scope.

# ClassConnect Architecture

Project: ClassConnect (Learning Management System)
Owner: LoopLab
Product type: Multi-tenant SaaS. LoopLab sells ClassConnect to schools, tutoring centers, and individual educators, each buyer is an isolated tenant on package-based plans.
Origin: Rebuilt and enhanced from the original Y3 Innovation BFRD (v1.0, June 2025)
Status: Planning / pre-build

> Style rule for this entire codebase: no em dashes in any code, comments, or documentation. Use commas, periods, or parentheses instead.

---

## 1. System Overview

ClassConnect now serves many independent customer organizations (tenants) from one shared platform, instead of one institution. Each tenant has its own teachers, students, parents, content, and payments, fully isolated from every other tenant, while LoopLab operates and bills across all of them from a Super Admin layer.

```
                    ┌─────────────────────┐
                    │   React Web App     │
                    │  (Teacher/Student/   │
                    │  Parent/Admin UI,    │
                    │  tenant-themed)      │
                    └──────────┬──────────┘
                               │ HTTPS / JSON
                    ┌──────────▼──────────┐
                    │   FastAPI Backend    │
                    │  (REST API, Auth,    │
                    │   Tenant Middleware, │
                    │   Business Logic)    │
                    └──────────┬──────────┘
             ┌─────────────────┼─────────────────┬─────────────────┐
             │                 │                 │                 │
    ┌────────▼──────┐ ┌────────▼───────┐ ┌───────▼────────┐ ┌──────▼───────┐
    │  PostgreSQL    │ │   AWS S3       │ │ Stripe / PayPal │ │ Stripe       │
    │  (org_id on    │ │ (org-scoped    │ │ (student fee    │ │ Billing      │
    │  every table)  │ │  file paths)   │ │  payments)       │ │ (platform    │
    │                │ │                │ │                 │ │  subscriptions)│
    └────────────────┘ └────────────────┘ └─────────────────┘ └──────────────┘
             │
    ┌────────▼──────┐
    │ Celery/APSch.  │
    │ (reminders,    │
    │  notifications,│
    │  billing sync) │
    └────────────────┘
```

Two Stripe integrations exist side by side and must not be confused:
- **Stripe/PayPal (student fee payments)**: money flowing from a tenant's own students to that tenant, for class fees. ClassConnect facilitates this, LoopLab does not take a cut unless a platform fee model is added later.
- **Stripe Billing (platform subscriptions)**: money flowing from the tenant (the school or educator) to LoopLab, for their ClassConnect package.

---

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend framework | FastAPI | Async-native, matches the existing LoopLab-IMS production stack, auto-generated OpenAPI docs for the mobile team |
| Database | PostgreSQL, shared schema, `org_id` on every tenant-scoped table | Cost-efficient multi-tenancy for package-priced customers, still supports moving a specific enterprise tenant to an isolated database later |
| ORM | SQLAlchemy 2.0 (async) or SQLModel | Type-safe models shared between API schemas and DB layer |
| Auth | FastAPI-Users or Authlib, OAuth 2.0, JWT, org-scoped sessions | Covers RBAC across roles and tenant isolation together |
| Background jobs | APScheduler (already used in LoopLab's article pipeline) or Celery + Redis if job volume grows | Payment reminders, QR expiry checks, notification dispatch, subscription renewal checks |
| File storage | AWS S3, keyed by `org_id/...` prefixes | Video, document, and payment slip uploads, isolated per tenant |
| Student payments | Stripe SDK (global) + PayPal SDK (local) | Fee collection between a tenant and its own students |
| Platform billing | Stripe Billing (Subscriptions, Products, Prices) | Package-tier subscriptions charged by LoopLab to each tenant |
| QR codes | `qrcode` (generation) + `pyzbar` or a JS QR scanner library on the client (validation) | Class ticket generation and scan-side validation |
| Frontend | React (web), React Native (mobile, shared logic where possible) | Reuses LoopLab's existing React expertise |
| Theming | Tenant-scoped theme provider (org branding config to CSS variables) | Package-gated custom branding per tenant |
| Charts | Recharts or Visx | Used for teacher/parent analytics dashboards, avoid default unstyled chart libraries |
| Deployment | AWS EC2 with systemd (matches LoopLab-IMS), move to ECS or Lambda later if auto-scaling becomes necessary | Keeps deployment operationally consistent across LoopLab products |

---

## 3. Multi-Tenancy Model

### 3.1 Isolation strategy

ClassConnect uses a **shared database, shared schema** model: one Postgres database, every tenant-scoped table carries an `org_id` foreign key. This is the standard approach for package-priced SaaS at this scale, it keeps infrastructure cost low per tenant, which matters directly for lower-tier package pricing.

Isolation is enforced in two layers:
1. **Application layer (primary)**: every authenticated request resolves the caller's `org_id` from their session/JWT, never from client-supplied input. A FastAPI dependency (`get_current_org`) injects this into every query. No router or service is allowed to accept `org_id` as a raw request parameter for filtering.
2. **Database layer (hardening)**: Postgres Row-Level Security (RLS) policies scoped to `org_id`, set once the application layer is stable. This protects against a bug in application-layer filtering from leaking data across tenants.

A specific enterprise-tier tenant can be moved to an isolated database or schema later without changing the application code, only the connection routing layer, if that tenant's contract requires it.

### 3.2 Roles, revised for multi-tenancy

- **Super Admin** (LoopLab staff): manages all tenant organizations, package assignments, platform billing status, and platform-wide system health. Not scoped to any single tenant.
- **Admin** (tenant-level, was the original single "Admin" role): manages users, roles, and configuration within their own organization only.
- **Teacher, Student, Parent**: unchanged in function from the original BFRD, now implicitly scoped to their organization.

---

## 4. Packages and Feature Gating

Package tiers are how LoopLab monetizes ClassConnect and how buyers get "package wise budget" customization. Treat the tier list below as a starting proposal, confirm final tiers and pricing with the founder (see HANDOVER.md, Open Questions).

| Feature area | Starter | Growth | Pro |
|---|---|---|---|
| Students per org | Up to 100 | Up to 500 | Unlimited |
| Teachers per org | Up to 5 | Up to 25 | Unlimited |
| Content upload (video/doc/quiz) | Yes | Yes | Yes |
| Fee management | Manual tracking only | + Stripe/PayPal integration | + PayPal and Stripe, multiple currencies |
| QR ticketing | No | Yes | Yes |
| Analytics dashboards | Basic (counts only) | Full (engagement, revenue, quiz pass rate) | Full plus data export |
| Parent portal | Yes | Yes | Yes |
| Custom branding (logo, colors) | No | Limited (logo plus one accent color) | Full (full palette, custom domain) |
| Support | Community/email | Priority email | Dedicated support |

Enforcement:
- `Organization.package_tier` is the source of truth.
- A `require_feature("qr_ticketing")` style FastAPI dependency checks the org's tier before allowing access to gated routers or actions.
- The frontend reads the org's tier (via the authenticated session) to hide or show UI for gated features, but the backend is the real enforcement point, never trust the frontend alone.
- Limits (student count, teacher count) are checked at creation time (adding a student, adding a teacher), with a clear upgrade prompt when a tenant hits their cap.

---

## 5. Backend Structure

```
classconnect-api/
  app/
    main.py
    core/
      config.py
      security.py
      database.py
    middleware/
      tenant.py
    models/
      organization.py
      subscription.py
      user.py
      teacher.py
      student.py
      content.py
      student_payment.py
      event.py
    schemas/
      organization.py
      user.py
      content.py
      student_payment.py
    routers/
      superadmin.py
      auth.py
      teacher.py
      student.py
      parent.py
      admin.py
      billing.py
      student_payments.py
      qr.py
    services/
      billing_service.py
      student_payment_service.py
      qr_service.py
      analytics_service.py
      notification_service.py
      feature_gate_service.py
    jobs/
      payment_reminders.py
      qr_expiry_check.py
      subscription_renewal_check.py
  tests/
  alembic/
```

Principles:
- Routers stay thin, business logic lives in services.
- Schemas (Pydantic) are separate from ORM models to keep API contracts stable even if the DB shape changes.
- Alembic manages migrations from day one, avoid manual schema edits.
- `student_payment_service.py` and `billing_service.py` are kept fully separate, one handles a tenant's own student fee collection, the other handles LoopLab's platform subscription billing. They should never share code paths.

---

## 6. Data Model

### 6.1 Platform-level entities (new)

```
Organization
  org_id (PK)
  name
  slug (used for tenant-scoped routing/subdomain)
  package_tier (starter / growth / pro)
  branding_config (logo_url, primary_color, secondary_color, custom_domain)
  billing_status (active / past_due / canceled)
  created_at

Subscription
  subscription_id (PK)
  org_id (FK -> Organization)
  stripe_subscription_id
  plan (matches package_tier)
  status
  current_period_end
```

### 6.2 Tenant-scoped entities (carried forward from the original BFRD, now org-scoped)

```
User
  user_id (PK)
  org_id (FK -> Organization)
  role (super_admin / admin / teacher / student / parent)
  name
  email
  password_hash
  created_at

Teacher
  teacher_id (PK, FK -> User)
  org_id (FK -> Organization)
  subjects_taught

Student
  student_id (PK, FK -> User)
  org_id (FK -> Organization)
  batch
  group
  parent_id (FK -> User)

Content
  content_id (PK)
  org_id (FK -> Organization)
  type (video / quiz / doc)
  uploader_id (FK -> Teacher)
  subject
  created_at

StudentPayment
  payment_id (PK)
  org_id (FK -> Organization)
  student_id (FK -> Student)
  amount
  status (paid / unpaid)
  expiry_date

Event
  event_id (PK)
  org_id (FK -> Organization)
  title
  type (exam / meeting / class)
  scheduled_at
  created_by (FK -> Teacher)
```

Note the rename from the original `Payment` entity to `StudentPayment`, to keep it unambiguous next to the new `Subscription` (platform billing) entity.

### 6.3 Relationships

- One organization, many users, teachers, students, content items, payments, and events.
- One teacher, many students (within the same organization).
- One student, one parent (within the same organization).
- One student, many student payments.
- One organization, one active subscription (historical subscriptions retained for billing history).

---

## 7. Key Flows

### 7.1 Tenant Onboarding

1. A new buyer signs up (or is onboarded by LoopLab sales) and selects a package tier.
2. An `Organization` record is created, a Stripe Billing subscription is started for the chosen tier.
3. The first user is created as that organization's Admin.
4. The Admin invites teachers, who invite or import students and link parents.

### 7.2 QR Ticket Validation

1. Teacher or system generates a QR ticket after payment confirmation, encoding `student_id`, `org_id`, `batch`, `group`, `expiry_date`.
2. Student scans the ticket through the LMS mobile app or web camera input at class entry.
3. Backend validates the payload structure and confirms the ticket's `org_id` matches the scanning context, then checks `current_date <= expiry_date`.
4. Valid: access granted, attendance logged. Invalid or expired: access denied, student notified.

### 7.3 Student Payment Workflow

1. Student pays via Stripe/PayPal or uploads a payment slip.
2. Backend validates the transaction (webhook for gateway payments, manual review queue for slip uploads).
3. Student status updates to Paid, a new QR ticket is issued.
4. Teacher and parent dashboards reflect the updated payment status.

### 7.4 Platform Billing Workflow

1. Tenant subscribes or upgrades/downgrades their package tier.
2. Stripe Billing webhook updates `Subscription.status` and `Organization.package_tier`.
3. Feature gates re-evaluate on the tenant's next request, no manual sync needed.
4. On payment failure, `Organization.billing_status` moves to `past_due`, tenant sees a grace-period banner before feature access is restricted.

### 7.5 Analytics Pipeline

Content uploads, quiz attempts, and student payment records feed an analytics service that aggregates metrics (engagement, revenue, quiz pass rates) for the Teacher Dashboard, and grades, attendance, and missed classes for the Parent Dashboard, always scoped to the requesting user's organization.

---

## 8. Security

- OAuth 2.0 with JWT access and refresh tokens, tokens carry `org_id` and `role` claims.
- Role-based access control enforced at the router dependency level, not just in the UI.
- Tenant isolation enforced at the router dependency level first, Postgres RLS as a second layer, never accept `org_id` from client-supplied request bodies or query params for filtering.
- AES-256 encryption for sensitive data at rest.
- Card data never touches ClassConnect's own database, Stripe/PayPal and Stripe Billing handle their respective PCI-DSS scope directly.
- Rate limiting on auth, payment, and billing endpoints.
- Super Admin actions (cross-tenant access) are logged separately and require a distinct elevated-permission check, not just the `super_admin` role flag.

---

## 9. Scalability

- Stateless FastAPI instances behind a load balancer, horizontal scaling to meet the 1,000 concurrent user target, now measured across all tenants combined.
- PostgreSQL read replicas if analytics queries start competing with transactional load, indexes on `org_id` for every tenant-scoped table are mandatory, not optional.
- S3 with CloudFront for video and document delivery, keeps page load under the 2 second target even under load.
- Package limits (student/teacher counts) double as a natural cost-control mechanism, higher-tier tenants that need more scale are also paying more.

---

## 10. UI/UX Direction

The instruction here is explicit: this should not look like a generic AI-generated dashboard template. Most LMS builds default to the same layout (sidebar, KPI cards, a line chart, a table) with default shadcn/Tailwind blues and no real design point of view. ClassConnect should not ship that, and as a multi-tenant SaaS product, the base design system also needs to hold up under tenant branding overrides without falling apart.

### 10.1 Research first

Before any component is built, spend real time studying award-caliber LMS and EdTech work, not just skimming thumbnails:

- **Trenning** by Fikri Studio (Dribbble): a SaaS LMS with strong information density done cleanly, worth studying for how it handles reports and learner progress without feeling cluttered.
- **Studyz** by Kretya Studio (Dribbble): LMS dashboard with a distinct color system and card hierarchy.
- **Growly** by Phenomenon Studio (Dribbble): LMS dashboard with confident use of motion and a non-default color palette.
- **Path Wise** by Sans Brothers (Dribbble): an AI-driven LMS concept, useful reference for how to present analytics without falling back on generic bar charts.
- Search Behance directly for "LMS UI/UX", "EdTech dashboard", and "student portal" curated collections, and filter by Featured or Curated Galleries, not just recency.
- Also look specifically at SaaS products with tenant white-labeling (Notion, Linear, or any multi-tenant admin tool) for how they handle brand-color overrides without the layout breaking.

The goal of this research is not to copy a shot pixel for pixel. It is to internalize what separates an award-caliber dashboard from a template: intentional color systems, custom iconography or illustration rather than stock icon packs, typography with real hierarchy, and layouts that reflect this specific product's data (grades, attendance, quiz scores, payments) rather than a generic "admin dashboard" skeleton.

### 10.2 Concrete design rules

- Build the base design system on LoopLab's own brand (`#613380` to `#7a4b9a` gradient, `#3c6184` blue accent, Space Grotesk headings, Manrope body), this is the default look for Starter-tier tenants who have no custom branding.
- For Growth and Pro tier tenants, the theme system must accept an org's logo and accent colors and re-skin the UI (buttons, highlights, charts) without breaking layout, contrast, or accessibility. Design the token system (not hardcoded hex values in components) from day one so this is possible.
- Design each portal (Teacher, Student, Parent, Admin) with a distinct but related visual identity, so a screenshot alone tells you which portal you are looking at, this should hold true across tenant themes, not just the default LoopLab theme.
- Charts should be custom-styled (Recharts/Visx with theme-driven colors and custom tooltips), not left in library default styling.
- Use real empty states, real loading states, and real error states as designed screens, not afterthoughts, including empty states for a brand-new tenant with no data yet.
- Micro-interactions (hover states, transitions between QR scan states, payment confirmation feedback) should be deliberate, reference the Growly and Trenning shots above for pacing.
- Avoid generic stock illustration packs (undraw.co defaults, etc.), commission or generate illustrations that match the brand system if budget allows, otherwise favor clean iconography over illustration.
- Mobile and web should feel like the same product family, not two unrelated builds.
- Design an upgrade/paywall state for gated features (QR ticketing, advanced analytics, branding) that feels like a natural part of the product, not a jarring "buy now" popup.

### 10.3 Process

1. Mood board and 2 to 3 UI direction concepts before any component code, reference specific shots studied above by name in design reviews.
2. Get one full portal (recommend Teacher, since it has the most surface area) fully designed and approved before extending the pattern to the other three.
3. Build a small design token file (colors, spacing, typography scale) early, so React components pull from tokens rather than hardcoded values, this is what makes tenant theming possible later without a rewrite.
4. Prototype the tenant-theming mechanism (swap an org's primary color and logo, confirm nothing breaks) as an early spike, before building out every screen.

# ClassConnect Handover Document

Project: ClassConnect (Learning Management System)
Owner: LoopLab
Product type: Multi-tenant SaaS, sold on package tiers to schools, tutoring centers, and individual educators
Purpose: Orient any developer picking up this project, what exists, what is left, and how to work on it.

> Style rule for this entire codebase: no em dashes in any code, comments, or documentation. Use commas, periods, or parentheses instead.

---

## 1. Current Status

As of this handover, ClassConnect has no implemented code under LoopLab. What exists so far:

- The original Y3 Innovation BFRD, now formalized and extended into a SaaS business model as [BRD.md](./BRD.md).
- A multi-tenant system design and tech stack decision, documented in [ARCHITECTURE.md](./ARCHITECTURE.md).
- A decision to rebuild on FastAPI (backend) plus React (web) and React Native (mobile), chosen for consistency with LoopLab's existing production stack (LoopLab-IMS) and for its fit with the async, payment- and integration-heavy nature of this project.
- A decision to use shared-database multi-tenancy (one Postgres database, `org_id` on every tenant-scoped table), enforced at the application layer first and Postgres Row-Level Security as a hardening layer.
- A proposed three-tier package structure (Starter, Growth, Pro), see BRD.md section 3, not yet confirmed with final pricing.

Nothing in the sections below should be read as already built. This is a fresh implementation under the LoopLab brand.

## 2. What Needs to Be Built

Multi-tenancy and package gating are foundational, they must be built into Phase 1, not added after the fact. Retrofitting tenant isolation onto an already-built single-tenant app is a much larger and riskier job than building it in from the start.

### Phase 1: Core MVP (multi-tenant foundation included)

- [ ] Project scaffolding: FastAPI backend structure (see ARCHITECTURE.md, section 5), React frontend structure, repo setup, CI basics.
- [ ] Organization and Subscription models, tenant onboarding flow (sales-assisted for launch, self-service later).
- [ ] Tenant isolation middleware: `get_current_org` dependency, `org_id` enforced on every tenant-scoped query, never accepted from client input.
- [ ] Auth and RBAC: user registration/login, role assignment (Super Admin, Admin, Teacher, Student, Parent), JWT with `org_id` and `role` claims.
- [ ] Core data model: User, Teacher, Student, Content, StudentPayment, Event tables, all org-scoped, plus migrations.
- [ ] Feature gating service: `require_feature()` dependency checking a tenant's package tier before gated actions.
- [ ] Teacher Portal (MVP slice): content upload (video, doc, quiz), organize by subject/date.
- [ ] Student Portal (MVP slice): resource access, view/download materials, attempt quizzes.
- [ ] Fee management: set monthly fees, track paid/unpaid status (manual tracking for Starter tier).
- [ ] Student payment integration: Stripe and PayPal, plus manual payment slip upload and review (Growth/Pro tiers).
- [ ] QR ticket generation and scanning: issue tickets on payment confirmation, validate on scan including org match check (Growth/Pro tiers, see ARCHITECTURE.md section 7.2).
- [ ] Admin Portal (MVP slice): user onboarding, role assignment, basic system logs, scoped to their own organization.
- [ ] Super Admin Portal (minimal): view tenants, assign package tiers, view subscription status.
- [ ] Platform billing: Stripe Billing integration for tenant subscriptions, kept fully separate from student payment code.
- [ ] Core UI design system: color tokens, typography, base components, built to support tenant theming from day one (see ARCHITECTURE.md section 10.2).

### Phase 2: Analytics, Parent Portal, and Deeper Customization

- [ ] Analytics engine: aggregation service pulling from content, quiz, and payment data, tier-gated depth (basic counts for Starter, full dashboards for Growth/Pro).
- [ ] Teacher Dashboard: student engagement, revenue, quiz pass rate visualizations.
- [ ] Parent Portal: grade trends, attendance heatmaps, missed class alerts.
- [ ] Event Scheduler: exam and meeting creation with notifications.
- [ ] Notification system: payment reminders, missed class alerts, event notifications, subscription/billing alerts (email and/or push).
- [ ] Tenant branding customization: logo and accent color override (Growth), full palette and custom domain (Pro).
- [ ] Super Admin Dashboard: active tenants by tier, monthly recurring revenue, churn/downgrade tracking.

### Phase 3: Mobile and Polish

- [ ] React Native app (or equivalent) for Android/iOS, reusing API and where possible shared component logic and tenant theming.
- [ ] Full design pass across all portals, matching the distinct-but-related visual identity described in ARCHITECTURE.md section 10.2, verified to hold up under tenant theme overrides.
- [ ] Performance validation against the 1,000 concurrent user (platform-wide), under 2 second load targets.
- [ ] Security review: encryption at rest, RBAC enforcement audit, tenant isolation audit (attempt cross-tenant access in testing), rate limiting on auth/payment/billing endpoints.
- [ ] Postgres Row-Level Security policies added as a hardening layer on top of application-level tenant checks.

### Future Enhancements (not scoped for MVP)

- AI-driven grade predictions.
- Gamification (student badges).
- Zoom/Google Meet integration.
- Usage-based add-ons (extra seats beyond a tier's cap).
- Self-service tenant signup flow.
- Moving a specific enterprise tenant to an isolated database or schema, if ever contractually required.

## 3. Design Handoff Notes

Before writing any UI component:

1. Read ARCHITECTURE.md section 10 in full. The instruction from the founder is explicit: this must not look like a generic AI-generated dashboard.
2. Review the referenced Dribbble shots (Trenning by Fikri Studio, Studyz by Kretya Studio, Growly by Phenomenon Studio, Path Wise by Sans Brothers) and search Behance's curated LMS/EdTech galleries before starting any screen.
3. Build the design token file (colors, typography, spacing) first, so every component pulls from tokens rather than hardcoded values, this is what makes tenant theming possible without a rewrite.
4. Get the Teacher Portal fully designed and approved as the reference pattern before extending to the other three portals.
5. Prototype the tenant theming mechanism early (swap logo and accent color, confirm nothing breaks) rather than discovering layout issues after every screen is built.

## 4. Developer Notes

- Match the existing LoopLab-IMS conventions where reasonable (deployment via EC2 and systemd, PostgreSQL, environment variable naming) so ops stays consistent across LoopLab products.
- Keep routers thin, put business logic in `services/` (see ARCHITECTURE.md section 5 for the folder layout).
- Use Alembic for all schema changes, no manual DB edits.
- Never accept `org_id` as a raw, client-controllable filter parameter, always derive it from the authenticated session.
- Keep `student_payment_service.py` (tenant-to-student fee collection) and `billing_service.py` (LoopLab-to-tenant platform billing) fully separate, do not let them share code paths, they are different money flows with different stakeholders.
- Card data never touches ClassConnect's own database or logs, Stripe/PayPal and Stripe Billing handle their respective PCI-DSS scope directly.
- Every new file, comment, and document in this repo should avoid em dashes, use commas, periods, or parentheses instead.

## 5. Open Questions for the Founder

These are not blocking Phase 1 scaffolding, but should be resolved before Phase 1 ships:

- Final package tier names, limits, and pricing, the table in BRD.md section 3 is a starting proposal only.
- Whether tenant onboarding at launch is sales-assisted only, or self-service signup is needed from day one.
- Whether LoopLab takes a platform fee/cut on student payments processed through a tenant's Stripe/PayPal, or whether that revenue is entirely the tenant's.
- Hosting target for MVP: continue on EC2/systemd like LoopLab-IMS, or move to a managed/auto-scaling setup sooner, this matters more now given multiple tenants share the same infrastructure.
- Budget and timeline for custom illustration/design work versus an initially icon-only visual system.
- Whether React Native is the mobile approach, or if native Android/iOS is preferred long-term.
- Whether any enterprise-tier customer is expected to require an isolated database, which would affect the Phase 3 hardening scope.

# ClassConnect Business Requirements Document (BRD)

Prepared for: LoopLab
Product type: Multi-tenant SaaS Learning Management System, sold to schools, tutoring centers, and individual educators as separate customer organizations (tenants)
Origin: Rebuilt and enhanced from the original Y3 Innovation BFRD (v1.0, June 2025)
Version: 2.0 (LoopLab SaaS rebuild)

> Style rule for this entire codebase: no em dashes in any code, comments, or documentation. Use commas, periods, or parentheses instead.

---

## 1. Introduction

ClassConnect is a Learning Management System designed to bridge communication gaps between teachers, students, and parents. It enables teachers to manage digital classrooms, students to access resources and submit payments, and parents to monitor academic progress. In this rebuild, ClassConnect becomes a SaaS product: LoopLab operates one shared platform serving many independent customer organizations, each buying a package-tier subscription and customizing the product within their tier.

## 2. Project Overview

### Vision

Empower educators to deliver hybrid (physical plus digital) learning with integrated payment tracking, analytics, and parental oversight, delivered as a self-service, package-priced SaaS product that any school or tutoring center can subscribe to and configure for their own needs.

### Business Model

LoopLab sells ClassConnect on tiered packages (see section 3). Each customer organization is a tenant with its own users, content, and data, fully isolated from every other tenant. Buyers choose a package based on their size and budget, and can upgrade or downgrade as their needs change. Higher tiers unlock more capacity (students, teachers), more features (QR ticketing, full analytics), and more customization (branding, custom domain).

### Key Modules

- **Super Admin Portal** (LoopLab-operated): tenant management, package assignment, platform billing oversight.
- **Teacher Portal**: content management, analytics, payment setup.
- **Student Portal**: resource access, event tracking, payment submissions.
- **Parent Portal**: performance analytics, attendance monitoring.
- **Admin Portal** (tenant-level): user management, organization configuration, troubleshooting, within their own organization.

## 3. Packages

Proposed starting structure, to be confirmed with the founder before pricing is finalized:

| Feature area | Starter | Growth | Pro |
|---|---|---|---|
| Students per org | Up to 100 | Up to 500 | Unlimited |
| Teachers per org | Up to 5 | Up to 25 | Unlimited |
| Fee management | Manual tracking only | Stripe/PayPal integration | Full multi-gateway, multi-currency |
| QR ticketing | Not included | Included | Included |
| Analytics dashboards | Basic counts only | Full dashboards | Full dashboards plus data export |
| Custom branding | Not included | Logo plus one accent color | Full palette plus custom domain |
| Support | Community/email | Priority email | Dedicated support |

Each tenant's `package_tier` is the single source of truth for what they can access, enforced on the backend, not just hidden in the frontend.

## 4. Objectives

1. Allow teachers to upload quizzes, videos, documents, and schedule events.
2. Enable fee management with payment gateway integration, tier-gated as described in section 3.
3. Provide student access via QR code validation for physical classes, tier-gated.
4. Deliver actionable analytics to teachers and parents (attendance, grades, engagement), depth tier-gated.
5. Ensure secure role-based access (RBAC), now combined with strict tenant data isolation.
6. Support multiple tenant organizations on one shared platform, each independently configurable and billed.
7. Let LoopLab manage tenants, packages, and platform billing through a Super Admin layer.
8. Ship a distinct, brand-consistent UI/UX by default, with package-gated tenant branding, not a generic admin dashboard template (see ARCHITECTURE.md, section 10, for the full design direction).

## 5. User Roles and Permissions

| Role | Scope | Permissions |
|---|---|---|
| Super Admin | Platform-wide (LoopLab) | Manage all tenant organizations, assign/change package tiers, oversee platform billing and system health |
| Admin | Single organization | User management, organization configuration, troubleshooting, within their own tenant only |
| Teacher | Single organization | Upload content, create quizzes/events, set fees, view analytics, manage students |
| Student | Single organization | Access resources, submit quizzes, upload payments/QR codes, view events |
| Parent | Single organization | View child's grades, attendance, learning progress |

## 6. Functional Requirements

### 6.1 Super Admin Portal (new)

- Onboard new tenant organizations and assign an initial package tier.
- View and manage all tenants' subscription status (active, past due, canceled).
- Upgrade or downgrade a tenant's package tier.
- View platform-wide usage and system health, without accessing any tenant's student or content data directly unless explicitly required for support, logged separately when it happens.

### 6.2 Teacher Portal

**Content Management**
- Upload videos (MP4), documents (PDF, Word, Excel, JPG), quizzes (MCQ/essay).
- Organize content by subject and date.

**Fee Management** (Growth and Pro tiers for gateway integration, Starter is manual tracking only)
- Set monthly fees, track paid/unpaid students.
- Auto-generate payment reminders.

**Analytics Dashboard** (depth varies by tier, see section 3)
- Metrics: total students, uploaded content, quiz participation, revenue.
- Visualize data via charts (bar, pie), custom-styled per the brand system, not default library styling.

**Event Scheduler**
- Create events (exams, parent-teacher meetings) with notifications.

### 6.3 Student Portal

**Resource Access**
- View and download materials, watch lectures, attempt auto-graded quizzes.

**Payment Hub**
- Pay fees online (Stripe/PayPal) or upload payment slips.

**QR Code Scanner** (Growth and Pro tiers)
- Scan class tickets (valid for 30 days) containing:

```json
{ "student_name": "", "student_id": "", "org_id": "", "batch": "", "group": "", "expiry_date": "" }
```

- Grant LMS access upon validation.

**Event Calendar**
- Display upcoming events and quizzes.

### 6.4 Parent Portal

**Analytics Dashboard**
- Grade trends, quiz scores, attendance heatmaps.
- Alerts for missed classes.

### 6.5 Admin Portal (tenant-level)

**User Management**
- Onboard/disable users within their own organization, assign roles.

**Organization Settings** (new)
- Configure organization branding within their package's allowance (logo, accent colors, custom domain on Pro).
- View their own subscription status and package details.

**System Logs**
- Audit payment and access logs, scoped to their own organization.

## 7. Workflows

### 7.1 Tenant Onboarding

1. A new buyer signs up (or is onboarded by LoopLab sales) and selects a package tier.
2. An organization record is created, a platform billing subscription starts for the chosen tier.
3. The first user is created as that organization's Admin.
4. The Admin invites teachers, who invite or import students and link parents.

### 7.2 Student Payment Workflow

1. Student uploads a payment slip or scans a QR code.
2. LMS validates the transaction against the payment gateway.
3. On success, student status updates to Paid and access is granted.
4. On failure (invalid or expired), access is denied and the student is notified.

### 7.3 QR Code Validation Logic

1. Scan QR code.
2. Check the payload contains `student_id`, `org_id`, `batch`, `expiry_date`. If not, reject as invalid data.
3. Confirm the ticket's `org_id` matches the scanning context.
4. If valid structure and org match, check `current_date <= expiry_date`. If expired, reject. If valid, grant access.

### 7.4 Platform Billing Workflow

1. Tenant subscribes or upgrades/downgrades their package tier.
2. Platform billing status updates the tenant's package tier and feature access.
3. On payment failure, the tenant sees a grace-period banner before feature access is restricted.

### 7.5 Teacher Analytics Workflow

Content uploads, quiz attempts, and payments feed into the database, which the analytics engine aggregates into the dashboard (charts and tables), always scoped to the requesting tenant.

## 8. Data Model

### Platform-level entities

- **Organization**: `org_id`, `name`, `slug`, `package_tier`, `branding_config`, `billing_status`
- **Subscription**: `subscription_id`, `org_id`, `plan`, `status`, `current_period_end`

### Tenant-scoped entities

- **User**: `user_id`, `org_id`, `role`, `name`, `email`
- **Teacher**: `teacher_id`, `org_id`, `subjects_taught`
- **Student**: `student_id`, `org_id`, `batch`, `group`, `parent_id`
- **Content**: `content_id`, `org_id`, `type` (video/quiz/doc), `uploader_id`
- **StudentPayment**: `payment_id`, `org_id`, `student_id`, `amount`, `status` (paid/unpaid), `expiry_date`

### Relationships

- One organization, many users, teachers, students, content items, and payments.
- One teacher, many students, within the same organization.
- One student, one parent, within the same organization.
- One student, many student payments.
- One organization, one active subscription.

## 9. Non-Functional Requirements

**Security**
- End-to-end encryption (AES-256).
- RBAC with OAuth 2.0.
- Strict tenant data isolation, no organization can access another organization's data under any circumstance, enforced at both the application and database layer.

**Performance**
- Support 1,000 concurrent users across all tenants combined, under 2 second page load.

**Compatibility**
- Web (Chrome, Safari, Firefox), Android/iOS apps.

**Scalability**
- Cloud-hosted (AWS) with auto-scaling, architecture supports adding new tenants without per-tenant infrastructure changes.

**Design quality**
- UI/UX must be researched and benchmarked against award-caliber LMS work (Dribbble, Behance) rather than defaulting to a generic template look, and the design system must support package-gated tenant branding without breaking. See ARCHITECTURE.md for specific references and rules.

## 10. Reporting and Analytics

### Teacher Dashboard

| Metric | Visualization |
|---|---|
| Student Engagement | Line chart (weekly) |
| Revenue | Bar chart (monthly) |
| Quiz Pass Rates | Pie chart |

### Parent Dashboard

| Metric | Visualization |
|---|---|
| Attendance | Calendar heatmap |
| Grade Trends | Sparklines |
| Missed Assignments | Alert badges |

### Super Admin Dashboard (new)

| Metric | Visualization |
|---|---|
| Active tenants by package tier | Bar chart |
| Monthly recurring revenue | Line chart |
| Tenant churn / downgrades | Table with alerts |

## 11. Payment Gateway Integration

**Student Fee Payments** (tenant to their own students)
- APIs: Stripe (global), PayPal (local).
- PCI-DSS compliance for card data, handled by the gateway providers directly, ClassConnect does not store raw card data.

**Platform Subscription Billing** (LoopLab to tenant, new)
- Stripe Billing for recurring package subscriptions, kept fully separate from student fee payment code paths.

**QR Tickets**
- Generated after payment confirmation, scannable via the LMS mobile app.
- Validity: 30 days from issue date.

## 12. Customization by Package

What a tenant can customize depends on their tier:

- **Starter**: no branding customization, uses LoopLab's default ClassConnect look.
- **Growth**: logo upload, one accent color override.
- **Pro**: full color palette override, custom domain, priority support tier.

Feature access (QR ticketing, analytics depth, gateway integrations) follows the same tier logic, see section 3.

## 13. Future Enhancements

- AI-driven grade predictions.
- Gamification (badges for students).
- Zoom/Google Meet integration.
- Usage-based add-ons (extra student seats beyond a tier's cap, billed incrementally).
- Self-service tenant signup and onboarding flow (versus sales-assisted onboarding for the initial launch).

## 14. Conclusion

ClassConnect becomes a multi-tenant SaaS product under LoopLab, sold on package tiers to schools, tutoring centers, and educators, with strict data isolation between tenants and package-gated features and branding. Phase 1 focuses on the tenant model, core MVP features, and basic billing, followed by analytics enhancements, deeper customization, and the design polish pass in later phases.

**Approvals**

Product Owner, LoopLab

CTO, LoopLab

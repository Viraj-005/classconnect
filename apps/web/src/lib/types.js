/*
  Domain shapes, documented as JSDoc typedefs.

  These mirror the API schemas in apps/api/app/schemas one to one, so a
  field rename has to happen on both sides deliberately. Editors pick
  these up for autocomplete without the project being TypeScript.

  Note that orgId never appears in a request the client controls. It is
  resolved from the session on the server. It appears on entities here
  only because the server returns it.
*/

export const PACKAGE_TIERS = ["starter", "growth", "pro"];
export const ROLES = ["super_admin", "admin", "teacher", "student", "parent"];
export const PORTALS = ["teacher", "student", "parent", "admin", "superadmin"];
export const BILLING_STATUSES = ["active", "past_due", "canceled", "trialing"];
export const CONTENT_TYPES = ["video", "doc", "quiz"];
export const PAYMENT_STATUSES = ["paid", "unpaid", "pending_review", "overdue"];
export const EVENT_TYPES = ["exam", "meeting", "class"];

/**
 * @typedef {"free" | "starter" | "growth" | "pro"} PackageTier
 * @typedef {"super_admin" | "admin" | "teacher" | "student" | "parent"} Role
 * @typedef {"teacher" | "student" | "parent" | "admin" | "superadmin"} Portal
 * @typedef {"active" | "past_due" | "canceled" | "trialing"} BillingStatus
 * @typedef {"video" | "doc" | "quiz"} ContentType
 * @typedef {"paid" | "unpaid" | "pending_review" | "overdue"} PaymentStatus
 * @typedef {"exam" | "meeting" | "class"} EventType
 */

/**
 * @typedef {Object} BrandingConfig
 * @property {string | null} logoUrl
 * @property {string} logoText          Wordmark fallback when no logo is uploaded.
 * @property {string | null} primaryColor
 * @property {string | null} secondaryColor
 * @property {string | null} customDomain
 */

/**
 * @typedef {Object} Organization
 * @property {string} orgId
 * @property {string} name
 * @property {string} slug
 * @property {PackageTier} packageTier
 * @property {BrandingConfig} branding
 * @property {BillingStatus} billingStatus
 * @property {number} [graceDaysLeft]   Only set while billingStatus is past_due.
 * @property {string} createdAt
 * @property {{ students: number, teachers: number }} seats
 */

/**
 * @typedef {Object} SessionUser
 * @property {string} userId
 * @property {string} orgId
 * @property {Role} role
 * @property {string} name
 * @property {string} email
 * @property {string} initials
 */

/**
 * @typedef {Object} ContentItem
 * @property {string} contentId
 * @property {string} orgId
 * @property {ContentType} type
 * @property {string} title
 * @property {string} subject
 * @property {string} uploaderName
 * @property {string} createdAt
 * @property {number} [durationMins]
 * @property {string} [sizeLabel]
 * @property {number} reachPct         Share of enrolled students who opened it.
 * @property {number} views
 */

/**
 * @typedef {Object} StudentRecord
 * @property {string} studentId
 * @property {string} orgId
 * @property {string} name
 * @property {string} initials
 * @property {string} email
 * @property {string} batch
 * @property {string} group
 * @property {string} parentName
 * @property {PaymentStatus} paymentStatus
 * @property {number} attendancePct
 * @property {number} avgScore
 * @property {string} lastActive
 * @property {string | null} ticketExpiry
 */

/**
 * @typedef {Object} StudentPayment
 * @property {string} paymentId
 * @property {string} orgId
 * @property {string} studentId
 * @property {string} studentName
 * @property {string} studentInitials
 * @property {number} amount
 * @property {string} currency
 * @property {PaymentStatus} status
 * @property {"stripe" | "paypal" | "slip" | "cash"} method
 * @property {string} submittedAt
 * @property {string} expiryDate
 * @property {string} [slipFilename]   Only for slip uploads awaiting review.
 */

/**
 * @typedef {Object} ScheduleEvent
 * @property {string} eventId
 * @property {string} orgId
 * @property {string} title
 * @property {EventType} type
 * @property {string} scheduledAt
 * @property {number} durationMins
 * @property {string} batch
 * @property {string} createdBy
 * @property {number} attendees
 */

/**
 * @typedef {Object} Tenant
 * @property {string} orgId
 * @property {string} name
 * @property {string} slug
 * @property {PackageTier} packageTier
 * @property {BillingStatus} billingStatus
 * @property {number} students
 * @property {number} teachers
 * @property {number} mrr
 * @property {string} joinedAt
 * @property {string} lastActiveAt
 * @property {string} accentColor
 */

/**
 * @typedef {Object} AuditEntry
 * @property {string} id
 * @property {string} actor
 * @property {string} action
 * @property {string} target
 * @property {string} at
 * @property {"info" | "warning" | "critical"} severity
 */

export {};

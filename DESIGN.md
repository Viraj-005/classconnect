# ClassConnect Design System

Owner: LoopLab
Status: Teacher portal approved as the reference pattern, extended to the other four
Companion to: [ARCHITECTURE.md](./files/ARCHITECTURE.md) section 10

> Style rule: no em dashes anywhere in this repo. Commas, periods or parentheses instead.

---

## 1. Research, and what came out of it

ARCHITECTURE.md section 10.1 asked for real study of award-caliber LMS work before any
component was built. Dribbble and Behance block server side fetching (both render client
side), so the shots were reviewed through their listings and public descriptions, alongside
the two reference images supplied by the founder.

| Source | What was taken |
|---|---|
| Trenning, Fikri Studio | High information density kept calm. Reports and learner progress sit in one panel with a tab switch rather than three stacked charts. |
| Studyz, Kretya Studio | Revenue, course library and performance each get their own card language instead of one card repeated four times. |
| Growly, Phenomenon Studio | Motion pacing. Transitions in the 130 to 220ms range, easing on `cubic-bezier(0.22, 1, 0.36, 1)`, never a bounce. |
| Path Wise, Sans Brothers | Analytics presented as ranked lists and rings, not defaulting to a bar chart for every question. |
| Reference image 1 (Filllo) | Dual sidebar (icon rail plus labelled nav). KPI strip divided by rules rather than four floating cards. Pastel tinted icon chips on every list row. Hover raising one bar to full accent. |
| Reference image 2 (Learnix) | Sectioned sidebar groups. Numbered progress rail with a connecting line. Content type chips. Sidebar footer plan card. |

**The single most consequential decision** came from reference image 1: the KPI strip is one
card divided by hairlines, not four separate cards. Four floating cards is the visual
signature of a generated dashboard. One divided strip reads as a single status line and is
the clearest way this does not look like a template.

### What was deliberately rejected

- Four identical metric cards above a line chart. The default shape, explicitly ruled out.
- Stock icon packs. The icon set in `apps/web/src/components/Icon.jsx` is drawn on one 24 grid at 1.7 stroke.
- Stock illustration. Empty states are drawn from the same card and rule shapes the real UI uses, so an empty screen still looks like this product.
- Library default chart styling. Every axis, grid, tooltip and series colour is token driven.
- Photographic avatars. Avatars generate a stable hue from the person's name.

---

## 2. Token architecture

Three layers, in override order. Defined in `apps/web/src/styles/tokens.css`.

```
1. Base     immutable   neutrals, spacing, radii, shadow, type scale
2. Brand    per tenant  set at runtime by ThemeProvider from branding config
3. Portal   per route   derived from the brand hue, gives each portal identity
```

**No component may hardcode a hex value.** Anything a tenant can re-skin resolves through a
variable. This is the rule that makes tenant theming possible without a rewrite, and it is
worth enforcing in review.

### Neutrals are warm

Every neutral is shifted toward plum rather than being true grey. `--ink-500` is `#7b6f8c`,
not `#737373`. Default Tailwind grey on white is the fastest way to look generic, and the
shift costs nothing.

### Type

Space Grotesk for headings, Manrope for body, per the LoopLab brand. Tabular numerals are
on globally, so a metric does not reflow as it ticks. The `.eyebrow` label (11px, 700,
0.085em tracking, uppercase) sits above every metric and section title, and is what stops
dense screens reading as a wall of same size text.

---

## 3. Tenant theming, and the tension it resolves

A Growth or Pro tenant supplies **one** accent hex. From it, `apps/web/src/theme/color.js`
generates the full 50 to 900 ramp at runtime. Only the 600 stop is stored, which is what
keeps `branding_config` small.

Two safeguards matter more than they look:

1. **Contrast is resolved, not assumed.** `readableOn()` picks white or ink for every
   generated surface. This is the failure that breaks most white label themes: a tenant
   picks a pale accent and every button label disappears. The branding screen shows the
   live ratio before saving.
2. **Saturation curves across the ramp.** Held flat, the 50 and 100 stops look dirty, which
   is what gives cheap generated palettes away.

### Portal identity under a tenant re-skin

ARCHITECTURE.md section 10.2 asks for two things that pull against each other:

- Each portal must be recognisable from a screenshot alone.
- That must hold true **across tenant themes**, not just the default LoopLab one.

Fixed portal palettes satisfy the first and break the second: a clay branded school would
still get LoopLab plum on its teacher rail. So portal identity is expressed as a **hue
rotation from the tenant's own brand**, not as five fixed palettes:

| Portal | Offset | Rationale |
|---|---|---|
| Teacher | 0 | The tenant's actual colour, on the portal they use most |
| Parent | +68 | |
| Student | +150 | |
| Admin | -44 | |
| Super Admin | none | Always LoopLab plum, see below |

The portals stay exactly as far apart from each other as they ever were, and all five
follow the tenant. Verified live: with Horizon's teal (`#2f6f6b`) the five accents resolve
to teal, green, indigo, rose and a light tint, all in one saturation family.

### Super Admin is the exception

The platform console does **not** rotate with the tenant. It holds LoopLab plum
permanently, in both light and dark, because it does not belong to any tenant. An operator
looking at Horizon's data is still using LoopLab's console, and the chrome should say so.

It is also the one surface that offers light and dark, chosen by the viewer rather than the
tenant, because it is an operator tool used for long stretches. Dark is the default. The
accent shifts stop between schemes (600 in light, 300 in dark) so it clears contrast at
both ends rather than vanishing into a near black shell or washing out on white. The light
scheme is not the tenant canvas reused: it is tinted toward plum and slightly cooler, so a
light mode screenshot of the console is still not mistakable for a tenant portal.

---

## 4. The sidebar, and why it was rebuilt

The first version was a slim dark icon rail glued to a white nav panel. That was wrong in
two ways, and both are worth recording because they are easy to repeat.

The rail was built as a **portal switcher**. Once users were correctly locked to a single
role, it held one icon and a large empty column. A navigation element whose purpose has
been designed away does not become decoration, it becomes a hole.

And a dark strip beside a white panel read as **two components that happened to be
adjacent**, not one deliberate object. Two-tone chrome only works when the tones mean
something.

It is now one dark surface with two densities:

| State | Width | Behaviour |
|---|---|---|
| Expanded | rail + 244px | Icons with labels, grouped, org card, plan meter |
| Collapsed | rail only | Icons with title tooltips, group rules instead of headings |

The mark at the top is the toggle, so the ClassConnect logo is both the brand and the
control. Nothing is duplicated: the rail is the collapsed form of the same navigation,
which is why the icons match the rows exactly.

**The sidebar palette is derived from the tenant's brand hue**, not a neutral charcoal.
It is the one element in every screenshot, so it is what a tenant's brand has to reach
first. A grey sidebar would make every tenant look identical no matter what colour they
picked. See `sidebarVars` in ThemeProvider.

Two details that carry more weight than they should:

- **The active row is a solid light block with a glow**, not a pale tint. On a near black
  surface a tint reads as "slightly different" rather than "selected", which is exactly why
  the first version looked unfinished.
- **Fine grain over the whole surface.** A flat fill on a large dark area reads as cheap;
  a little noise gives it the density of printed ink. Inline SVG turbulence, so no request.

## 5. Other layout rules

**Shell.** Sidebar plus a light work area. The split is deliberate rather than decorative:
the sidebar is the constant and carries the colour, so the eye has one fixed anchor and the
content stays quiet enough to read dense tables on.

**KPI strip.** One card, `.rule-grid`, hairline dividers, never four cards.

**Right rail is for decisions, not more numbers.** On the Teacher overview it holds the
payment slip awaiting review and the class starting soon. Repeating metrics there is the
easy mistake.

**One focal point per screen.** The main column is a single tabbed panel rather than three
stacked charts.

**Different questions get different shapes.** Engagement is an area, revenue is bars, pass
rate is a donut plus ranked list, subject reach is a ranked horizontal bar, attendance is a
calendar heatmap. Three charts in a row all shaped the same is the template tell.

---

## 6. States, designed rather than bolted on

All in `apps/web/src/components/ui/states.jsx`.

- **Empty.** Three drawn variants (list, chart, inbox). Copy distinguishes "no data yet" (new tenant) from "nothing matches" (filter too narrow), because those need different actions.
- **Loading.** Skeletons mirror the shape of what replaces them, so the page does not jump.
- **Error.** States plainly that nothing was changed.
- **Upgrade.** Renders the real feature behind a blur with a live overlay, so the tenant sees exactly what they would get. Explicitly not a "buy now" popup.
- **Locked action.** A single control stays visible with a lock badge, so the tenant learns the feature exists.
- **Grace period.** Past due is a warning, not a block. Access is not cut during grace.
- **Seat cap.** Warns at 80 percent, not at 100, so a tenant is not stopped mid task.

---

## 7. Motion

Referenced against the Growly pacing. `--dur-fast` 130ms for hover and colour, `--dur-med`
220ms for entrance, `--dur-slow` 380ms for bars and rings filling. Everything easing out on
`cubic-bezier(0.22, 1, 0.36, 1)`.

**The splash screen** runs once per tab while the session resolves. Two rules keep it from
being the thing everyone hates about splash screens: it never blocks (the app boots
underneath, and `ready` holds the exit only until the session settles, which also avoids a
flash of the login screen for someone already signed in), and it uses `sessionStorage` so
reopening in a new tab shows it while clicking around does not.

The mark draws itself rather than fading in. The two arcs are the teacher side and the
student side of the logo, so drawing them in sequence and letting them meet is the brand
idea in motion rather than decoration. The bar underneath is an indeterminate sweep, not a
progress bar, because it has no number it could honestly count to.

Deliberate moments:
- QR scan result takes over the whole panel with colour and one word. A person at a classroom door reads it from two metres in under a second. A toast would fail that.
- Revenue bar hover raises one bar to full accent and leaves the rest soft.
- Branding preview re-skins the live components as you drag the colour picker.

`prefers-reduced-motion` collapses all of it.

---

## 8. One trap worth knowing about

Base element styles **must** sit inside `@layer base`. Tailwind v4 emits utilities into
`@layer utilities`, and in the CSS cascade an unlayered rule beats every layered one. An
unlayered `h2 { color: var(--ink-950) }` silently overrides `text-white` on every heading in
the app, with no specificity warning to explain it. This was a real bug in this codebase,
caught in browser review: hero and login headings were rendering dark on dark backgrounds.
Everything is layered now, and it should stay that way.

---

## 9. Accessibility

- Contrast is computed, not assumed, for every generated colour (WCAG AA, 4.5:1 for text).
- One focus ring definition, portal tinted, `:focus-visible` only.
- Status is never carried by colour alone. Badges pair a dot or icon with a word.
- Charts do not rely on hover for their message. Headline figures are printed above them.
- Wide tables scroll in their own container. The page body never scrolls horizontally.

---

## 10. Honesty about the numbers

This section used to list which figures were invented. It no longer needs to, and the
history is worth keeping because the approach is the point.

Engagement, attendance, quiz results and content reach had no source tables. Rather than
generate plausible numbers silently, the API marked those responses `synthetic: true` with
a note saying what was missing, and the UI badged them **estimated** next to the figure.
That is the part worth repeating on the next project: a number with no source is not a
number, and the cheapest way to stop one becoming load bearing is to make the product say
so on the screen where it appears.

Four tables closed it: `quiz_questions`, `quiz_attempts`, `attendance_records` and
`content_views`. Every dashboard figure is now counted. The `synthetic` key stays in the
response shape, set to False, because the frontend badges on it and removing the key would
be a silent contract change.

Two decisions inside those counts are judgement calls rather than arithmetic, so they are
written down where they are made:

- **A pass rate uses the best attempt per student**, not every attempt. A student who fails
  once and then passes has learned the material, and counting both runs reports them as
  half a failure.
- **Attendance counts late as attended.** They were taught. Counting it against them
  answers a different question from the one a parent is asking.

The one figure still without a source is watch time on a document, which has no duration to
measure. Videos report real seconds.

## 11. The account screen, and controls that do nothing

The profile menu shipped with three items that were pure decoration: Profile, Preferences
and Help and docs rendered as buttons with no handler, and only Sign out did anything. A
control that looks live and does nothing is worse than an absent one. It reads as a broken
product rather than an unbuilt feature, and it costs a support ticket to find out which.

The fix was to build what each one implies rather than to hide them.

**`/account` is portal neutral.** It is the one authenticated route that belongs to a
person rather than to a portal, so it has no entry in `nav.js` and no key in the page
access registry. The shell resolves it to whichever portal the viewer already occupies.
Note the trap: `portalFromPath` falls back to `teacher` for anything it does not
recognise, so resolving `/account` by prefix would have bounced every non teacher off
their own account screen via the role lock. `isNeutralPath` exists for exactly that.

It carries no page key on purpose. Letting an administrator switch off somebody's ability
to change their own password is not a setting worth offering.

**What is editable follows who owns the fact.** Your name is yours, so it is a field.
Your email is a sign in identity and changing it needs a verification round trip that does
not exist, so it is shown, disabled, and explained. Role and organisation are assigned to
you, so they are read only here and live on the Admin screens.

**Preferences only lists what the product can actually do.** The sidebar collapse
preference is real and device local. The colour scheme control appears for Super Admin
alone, matching the sidebar, because the platform console is the one surface that offers
both. Notification switches would have been the easy filler, and there is no notification
service, so the card says so instead of rendering three toggles that promise email nobody
sends.

The collapse preference moved out of `Shell.jsx` into `lib/prefs.js` because two places now
read it. A `useSyncExternalStore` subscription means the sidebar moves while you are
looking at the toggle, rather than after the next reload.

**A Super Admin has no plan.** The identity card first showed Organisation, Plan and
Member since for everyone, which read "LoopLab, Pro" for the platform operator. LoopLab
carries a `package_tier` in the database only because the column is not nullable and the
console needs feature access. It is a placeholder, not a subscription: LoopLab sells those
plans rather than buying one, and the `Organization` model already says it "must never
appear in tenant counts or revenue". The platform branch of the card now reads Operator and
Reach, and says outright that this account has no plan, no seat allowance and no invoices.

**Help is a slide over, not a link.** There is no documentation site, and a menu item that
opens a 404 is no better than one that does nothing. It answers the two questions someone
actually reaches for help with, what is this screen and who do I ask, from the nav registry
and the session rather than from copy invented for the panel. Support routing follows the
product's own shape: a teacher's counterparty is their administrator, an administrator's is
LoopLab, and the tier decides whether that says priority or standard. It invents no support
address that would not reach anyone.

## 12. Money, and which money

Everything is in Sri Lankan rupees. The product is built for Sri Lankan schools and
tutoring centres, the seeded fee is `Rs 8,500` a month per student, and the tenant domains
are `.lk`. The platform figures were the last thing still wearing a dollar sign.

The tier ladder was originally 149 / 490 / 1490, which are dollar shaped numbers.
Relabelling those as rupees would have priced the product at roughly a fiftieth of its
intent with nothing failing anywhere, so the ladder is now denominated natively at
`Rs 7,500 / 25,000 / 75,000`. Same 1 : 3.3 : 10 shape, still the founder's decision to
confirm. A test asserts the values stay above `Rs 1,000` and
stay ordered, which is what would catch a dollar figure creeping back in.

**Two money flows, one of them multi currency.** A tenant collecting fees from its own
students may charge in another currency on Pro, which is what the `multi_currency` feature
is for. LoopLab charging a tenant is a different flow with different stakeholders and is
LKR only. `PLATFORM_CURRENCY` says so in one place, next to the prices.

**Rupee figures are longer, and the layout had to move.** `Rs 107.5k` does not fit where
`$107k` did. Two consequences: `formatMoneyCompact` exists for headline figures and chart
axes, and the `TrendLines` Y axis gutter is now derived from the prefix length rather than
fixed at 52px, which was silently clipping `Rs 1.6k` to a stub.

**One rule for what a tenant is worth.** Converting the figures surfaced that the platform
summary and the per tenant rows computed MRR independently and disagreed: the summary
counted `active` tenants only, while a row priced a `past_due` tenant at full tier. On the
Subscriptions screen that put `Rs 100k` next to a tier breakdown summing to `Rs 107.5k`.
Both now call `monthly_revenue()`, which counts past due (a live subscription inside its
grace period, reported separately as revenue at risk) and excludes cancelled and trialing.

## 13. The brand marks, and why they are not the files that arrived

The logo and app icon were supplied as JPEG on a white ground. Neither could be used as
delivered, for three reasons that all bite in this particular app:

1. **No alpha.** The sidebar is near black and the login panel is the tenant's brand
   gradient. A JPEG on white renders as a white rectangle on both, which is the single
   most visible place the mark appears.
2. **One colour.** The mark has to be purple on the login form, white in the sidebar, and
   whatever `--brand-contrast` resolves to on the tenant branding preview. A raster is
   whatever colour it was exported as.
3. **Size.** 1.2MB apiece, for a mark that draws at 22px in the sidebar and 16px in a
   browser tab.

So the artwork was traced to vector. `apps/web/scripts/brand/` holds the tracer: it builds
an antialiased coverage mask per brand colour (projecting each pixel onto the
background-to-ink line, which keeps the JPEG's own edge softening and yields smooth curves
rather than a staircase), runs marching squares over it, simplifies with Douglas-Peucker,
and writes one even-odd path per colour. Even-odd is what carves the counters in the
wordmark and the halo around the node out of the page shapes without having to work out
which contour is a hole.

Each trace prints an IoU against its source mask, between 0.954 and 0.995. The residual is
mostly the half pixel offset between contour space and the pixel grid in the check itself,
not the trace: tightening the simplification tolerance until the paths tripled in size
moved the number by 0.0002.

The source JPEGs are committed under `brand/source/`, and the generator reproduces every
committed asset byte for byte. That matters more than it sounds: it means the next person
to touch the brand edits the artwork and re-runs two scripts, rather than trying to
hand-patch a 10KB path string.

**Three components, three jobs.** `LogoMark` is the book alone, for the sidebar chip and
anywhere tight. `LogoLockup` is book plus wordmark, for the login screen and the boot
screen. `AppIcon` is the full squircle with its gradient, for the splash and the favicon.
`tone` picks the ink: `brand` purple for light surfaces, `light` white for the sidebar and
coloured panels, `current` to inherit `currentColor` where the contrast colour is resolved
at runtime.

The node keeps its blue in the first two tones. It sits inside the white gutter rather than
on a page, so it reads against either ink, and it is the part of the mark carrying the
"connect" idea. Checked down to 16px: the barbell survives, and so do the fanned page
slivers.

**The splash had to change.** It used to draw the old two arc mark with an animated
`stroke-dashoffset`. The new mark is a filled shape with no outline to trace, so that
animation had nothing to work on. It now lifts and settles the app icon once, with a
slight overshoot, which is the gesture an app icon makes when it opens and confirms you
opened the thing you tapped. `cc-draw` was deleted rather than left behind.

## 14. Open design questions for the founder

Open questions, plus what this build surfaced:

1. **Portal hue offsets.** Under a tenant re-skin, "student" may land on pink rather than green. Distinctness is preserved, semantic warmth is not. Confirm that trade is acceptable, or fix student and parent to semantic hues and accept that they stop following the tenant.
2. **Illustration budget.** Currently icon and drawn shapes only, the cheaper of the two options considered. Commissioned illustration would lift the empty states most.
3. **Tier names and pricing.** Still the BRD's starting proposal, now in LKR at Rs 7,500 / 25,000 / 75,000 a month. The billing screen and `tier_policy.py` both carry that caveat. Whether a past due tenant should count toward MRR is the one judgement call baked into `monthly_revenue()`, and is worth confirming.
4. **Starter analytics depth.** Currently headline counts plus a blurred preview of the full dashboard. Confirm that is the right amount of tease.

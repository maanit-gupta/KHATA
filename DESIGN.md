# Kirana Ledger — Design System

Source: the owner's "editorial Swiss-grid" brief, converted from a generic marketing site into
(A) a public landing page and (B) the working ledger app. The brief's visual rules are law.
Where this file changes something, the reason is given. If something isn't covered here, ask.

**Mood:** clinical-confident. Calm, precise, a little brutalist, never playful.
"Fintech meets print annual report", applied to a shopkeeper's khata.

## 1. Hard rules (apply everywhere)
- Border radius **0** everywhere, including inputs, buttons, toasts, modals, and focus rings.
- No gradients on UI elements, no shadows, no icons **except** the thin right arrow `→`
  and solid squares. Status, bullets, and markers are all squares.
- One font family. Size carries hierarchy; **nothing is bold** (weight 400 only).
- Hairlines are `1px solid var(--ink)` (or white/40% on dark) and are used only as row dividers
  and field underlines.

## 2. Tokens (`src/styles/tokens.css`)
```css
:root {
  --ink: #17181A;       /* text, buttons, dark sections */
  --ink-soft: #2A2B2E;  /* ghost squares on dark */
  --cyan: #B8F3FF;      /* signature accent surface */
  --cyan-deep: #97EDFA; /* ripple stripes; PENDING status square */
  --mist: #E8E9ED;      /* cool grey sections */
  --paper: #FDFDFD;     /* cards, white sections, app background */
  --bone: #F3F3F1;      /* header bar on inner pages / in-app */
  --muted: #9A9CA3;     /* pre-reveal headings, secondary text ONLY */
  --gutter: 28px;       /* 16px below 600px */
  --ease: cubic-bezier(0.65, 0, 0.35, 1);
}
```
**Accessibility guard:** `--muted` on `--paper` is low contrast. Never use it for amounts, names,
dates, errors, or anything a user must read to act. It's allowed only for pre-reveal headings,
timestamps, and helper text.

## 3. Typography
Font stack: `"DM Sans", "Noto Sans Tamil", "Noto Sans Devanagari", "Noto Sans Telugu",
"Noto Sans Kannada", "Noto Sans Malayalam", "Inter Tight", system-ui, sans-serif`,
all loaded from Google Fonts at weight 400.
*Why the change:* DM Sans has no Indic glyphs. Party names, transcripts, and spoken answers
appear in six scripts and must not fall back to a random system font.

| Role | Size | Line height | Tracking |
|---|---|---|---|
| Display (landing hero only) | clamp(56px, 10vw, 150px) | 0.95 | -0.035em |
| H2 section / screen title | clamp(32px, 3.2vw, 48px), split over 2 lines | 1.05 | -0.02em |
| H3 rows, card titles | 24–40px | 1.1 | -0.01em |
| **Amount (app)** | clamp(28px, 6vw, 40px), `font-variant-numeric: tabular-nums` | 1 | -0.01em |
| Body | 15px (never below 15 in the app) | 1.35 | 0 |
| Label / nav / button | 13–15px UPPERCASE | 1 | +0.02em |

UPPERCASE applies to Latin labels only. Indic text is never transformed; CSS already ignores
case for those scripts, so don't fake it.

## 4. Grid
12 columns with a 28px outer gutter; content spans the full viewport width.
- **Landing (desktop-first):** sections split into 1/3 heading (left) and 2/3 content (right),
  with the short blurb aligned to the far right.
- **App (mobile-first, 390px baseline):** single column. On ≥900px, the app uses the 1/3 + 2/3
  split, with the screen title and actions left and the list or detail right.
  *Why the change:* shopkeepers use phones, so the app is designed at phone width first
  and the brief's split becomes the desktop enhancement.
- Minimum tap target is 48×48px. Hold-to-talk buttons are larger (see §6).

## 5. Global components (`src/components/ui/`)
| Component | Spec |
|---|---|
| `Header` | Fixed, 56px. Uppercase wordmark "KHATA" top-left; no logo mark. Nav on the right as separate solid ink **chips** (white uppercase text, 6px 10px padding, 8px gap). Active chip = underline under its label. Transparent over the landing hero; `--bone` bar elsewhere. Over dark sections the chips lose their fill (`mix-blend-mode: difference`). |
| Landing nav chips | HOME / HOW IT WORKS / LOG IN / GET STARTED |
| App nav chips | LEDGER / PARTIES / REVIEW / SETTINGS. REVIEW shows a count as a small cyan square containing ink digits. Below 900px, chips collapse into one ink "MENU" chip that opens a full-screen `--ink` overlay with huge stacked uppercase links. |
| `Button` (primary) | Solid ink rectangle, ~42px tall, uppercase label left, `→` pushed to the right edge. Hover and focus: arrow slides 4px right and fill goes to `#000`. |
| `Button` (inverse) | White fill with ink text, full width, used on dark panels (form submits). |
| `Chip` | As in nav. Also used for segmented choices (bill kind, Paid/Credit); the selected chip is ink and unselected chips have an ink hairline outline. |
| `Row` | Full-width hairline top border and three aligned columns: a 14px status square on the left, main content at the 1/3 mark, and a right column (amount or name, right-aligned). |
| `PixelSquares` | 40×40px solid squares in a seeded, asymmetric constellation, some touching corner-to-corner. Ink on light, `--ink-soft` on dark. Positions come from a seeded `{x%, y%}` array per section, so the pattern is stable between renders. Decorative: `aria-hidden`. |
| `Field` | Underline-only input (1px bottom border; white/40% on dark), with a 12px label above and `*` for required fields. No boxes. Error: the underline turns ink, 2px, with an error line below in body size. |
| `RibbedGlass` | The "fluted glass" texture: dense vertical ribs over cyan with a slow wavy ripple. Build it with layered `repeating-linear-gradient` plus an animated SVG `feTurbulence`/`feDisplacementMap`, looping 8–12s. `intensity` prop: `idle` (quiet) or `live` (faster ripple, used while recording). |
| `Toast` | Ink bar pinned to the bottom, full width, white uppercase text, zero radius. |

**Status squares (the only status language):**
- solid ink = confirmed
- `--cyan-deep` = pending
- ink outline only = voided (and the row text is struck through)
- a small uppercase `AUTO` label beside the square = auto-saved
- `NEW` = party needs review

## 6. App screens (maps to CLAUDE.md §7)

### 6.1 Login / Signup, adapted from the brief's CONTACT split
- The top band is `--cyan` with the H2 "Your shop's khata, / by voice." on the left and a
  right-aligned blurb.
- Below it, the left 1/3 stays cyan with a small label bottom-left, and the right 2/3 is the
  `--ink` form panel.
- Fields: Email, Password, plus Name on signup. Submit is the inverse full-width button:
  "LOG IN" or "CREATE ACCOUNT".
- A text toggle underneath switches between the two modes.

### 6.2 Onboarding (same split)
- Step 1: two chips, CREATE A SHOP / JOIN WITH CODE, then the Shop name field or the 6-character
  code field.
- Step 2: pick your language. Six large rows, each showing the language name in its own script
  (தமிழ், हिन्दी, English, తెలుగు, ಕನ್ನಡ, മലയാളം). The selected row gets the ink square.

### 6.3 Ledger (home)
Top to bottom on mobile:
1. **Voice panel:** a `RibbedGlass` block about 38vh tall. Inside it sit two stacked full-width
   hold buttons (at least 72px tall each): **HOLD TO ADD** (ink) and **HOLD TO ASK** (inverse,
   with an ink hairline). Below them, a **SCAN A BILL →** primary button.
2. **Result card:** appears after a voice action.
   - Entry card: the amount in the Amount style, the party name at H3 size, and the type label
     in uppercase.
   - Answer card: the answer text in body-large with a `▶` square play control.
3. **This week:** a `--mist` block with a two-line H2 "This week, / so far." It shows 4 figure
   rows (cash sales, credit given, collected, expenses) with the comparison to last week as body
   text, the narration paragraph, and a play control. The top 3 debtors are listed as Rows.
4. **Recent:** the last 20 entries as Rows. Tapping a row opens Entry edit.

On desktop, the voice panel is the left 1/3 (sticky) and panels 2–4 are the right 2/3.

### 6.4 Recording state (the signature interaction)
- Pressing a hold button switches `RibbedGlass` to `live`. The button label changes to
  "LISTENING… RELEASE TO SEND".
- A hairline along the button's top edge draws `scaleX 0 → 1` over exactly 30s as the
  countdown. At 25s it turns white, and at 30s the recording auto-sends.
- On release: the label becomes "WORKING…", the ripple returns to idle, and the result card
  row-draws in.
- A press under 0.7s shows the toast "Hold the button while speaking."

### 6.5 Undo toast (auto-saved entries)
Ink toast: "SAVED · RAMESH · ₹250" on the left, an **UNDO** chip on the right. A white hairline
across the top shrinks `scaleX 1 → 0` over exactly **5s**. Tapping Undo voids the entry and shows
"UNDONE." for 1.5s.

### 6.6 Confirm / clarify cards
- **Pending:** the Row style card with a cyan-deep square, the reason text (e.g. "Amount above
  ₹5,000" or "Did you mean Ramesh?"), and two buttons: CONFIRM → (primary) and EDIT (inverse
  with hairline). "Did you mean" shows chips: YES, RAMESH / NO, NEW PERSON.
- **Clarify:** the spoken question is also shown as text, with a HOLD TO ANSWER button.

### 6.7 Scan flow (full-screen steps on `--paper`)
1. The H2 "What kind / of bill?" with three tall cards (after the brief's SERVICES cards: title
   top-left, 10px ink square top-right, a one-line description pinned to the bottom):
   SUPPLIER / CUSTOMER / EXPENSE.
2. Paid/Credit or Cash/Udhaar as two large chips (skipped for expense).
3. Camera/upload. The preview is shown full width with a `RibbedGlass` overlay strip while the
   job runs ("READING THE BILL…").
4. An editable form (dark panel, underline fields): vendor, date, total, plus a customer-name
   field for customer udhaar. Submit: SAVE ENTRY →.

### 6.8 Parties
- The H2 "Customers / and suppliers." with the search field and CUSTOMERS / SUPPLIERS chips.
- Rows: square | name (with a NEW label if flagged) | balance, right-aligned.
- Balance wording is always explicit: "OWES YOU ₹2,300" or "YOU OWE ₹1,100", never a bare minus sign.

### 6.9 Party detail
- The name as H2, then the balance in Amount style with its explicit wording.
- Entry Rows follow. Each row has an evidence control on the right: a `▶` square plays the
  original audio, and a `→` opens the receipt image.

### 6.10 Review queue
The H2 "Needs / a look." Three groups separated by hairlines: pending entries, new parties
(RENAME / MERGE INTO… chips), and failed receipts (ENTER MANUALLY →).

### 6.11 Entry edit
- The dark form panel with all fields. Save button: SAVE CHANGES →.
- Below it, the "History" rows from `audit_log`: who, when, and what changed (old → new, in body text).
- VOID ENTRY is a text button at the bottom that opens a confirmation.

### 6.12 Settings
Rows: My language (opens the §6.2 picker), Voice (plays a sample on selection), Shop invite code
(Amount style, with a COPY chip), LOG OUT.

### 6.13 States
- **Empty ledger:** "Hold ADD and say what happened, / like 'Ramesh took 250 on credit'."
  with PixelSquares.
- **Offline:** a full-screen `--ink` overlay with white H2 "No internet. / Entries can't be saved
  right now." and a RETRY button.
- **Errors:** always a plain sentence saying what failed and what to do next. Never apologize.

## 7. Landing page (`/`, public), adapted from the brief's HOME
- **Hero (100vh, `--cyan`, RibbedGlass idle).**
  - Display headline: "Your khata, / by voice."
  - Blurb on the left: "Speak an entry, scan a bill, ask what's owed. / Six Indian languages."
  - GET STARTED → on the right.
  - PixelSquares fill the lower 40% with 0.3x parallax.
- **How it works (`--mist`).** H2 "Three ways / to keep the book." with 3 cards: a ribbed top
  panel, then an H3 and a 2-line body.
  - Speak it: "Hold, say who took what. It's written down."
  - Scan it: "Photograph any bill, printed or handwritten."
  - Ask it: "'How much does Ramesh owe?' Answered aloud."
- **Principles split (ink 1/3 + cyan 2/3).** White H2 "Built to / be trusted." with three
  feature rows:
  - "Every entry keeps its recording."
  - "Big amounts always wait for your tap."
  - "Six languages, one ledger."
- **Say it your way (`--cyan`).** Replaces Testimonials. *Why the change:* invented testimonials
  would be fake social proof in a demo. Instead, show rows of real example commands, each with a
  square, the phrase in its own script in the centre column, and the LANGUAGE on the right.
- **Built by.** Replaces Founder; optional. An H2 with the maker's photo and a 4-line bio.
  Omit the section entirely if no photo is supplied.
- **Footer (ink).** Wordmark, stacked links, a "Built for [hackathon name]" line, ghost squares,
  and the GitHub repo URL set large and uppercase with a thick underline in place of the email.
- `/how-it-works` is not a separate page; the HOW IT WORKS chip scrolls to that section.

## 8. Motion
**Landing: the full brief applies.** IntersectionObserver at a 15% threshold, no bounce, `var(--ease)`.
- **Heading reveal:** from `--muted` at 40% opacity to ink or white, over 600ms.
- **Line draw:** `scaleX 0 → 1` from the left, 900ms, staggered 120ms per row.
- **Text wipe:** `clip-path: inset(0 100% 0 0) → inset(0)`, tracking the line.
- **Square pop:** `scaleX 0.05 → 1` over 300ms, after its row's line finishes.
- **Sections:** rise 40px and fade over 700ms. The cyan panel in the split slides in from the right.

**App: motion answers actions only.** *Why the change:* scroll reveals on a ledger you open 50
times a day become friction, and they are costly on cheap phones.
- Rows line-draw **once**, on first load of a screen, and never on re-render or refetch.
- A new entry row draws in when it is created.
- The signature moments are §6.4 (recording countdown), §6.5 (undo countdown), and the ripple
  going live.
- Page transitions everywhere: a `--bone` cover fades in over 250ms, the route changes, then the
  cover fades out while the content rises 20px.
- Nav chip hover: the background changes to `#2E2F33` and the underline slides in over 200ms.

**`prefers-reduced-motion`:** no ripple animation (static ribs), no parallax, and every reveal is
instant. The countdown hairlines still animate, because they carry information, but without easing.

## 9. Implementation
- Tailwind CSS v4 (via `@tailwindcss/vite`) with tokens exposed as theme variables, plus
  `framer-motion` for reveals and transitions.
- Each landing section is an isolated component: `Hero, HowItWorks, PrinciplesSplit, SayItYourWay,
  BuiltBy, Footer`. Each app screen lives in `src/screens/`.
- Every user-facing string lives in `src/strings/en.ts`. The UI ships in English for this build
  (see CLAUDE.md §2), so the structure should allow adding languages later without refactoring.
- Build responsive (the 900px breakpoint), a visible keyboard focus ring (2px ink outline, offset
  2px, square), and reduced motion from the start rather than as a later pass.

# AUDIT-branchxo.md

This document captures the iterative audit cycle. Each round documents
findings, fixes, and verification. P0 = correctness break; P1 = wrong
or spec deviation; P2 = polish.

---

## Original audit (pre-runtime)

40/40 → 49/49 tests passed; tsc strict + eslint clean.
Findings drove the first refine pass — see `REFINE-branchxo.md` for the
fixes. The original `P0-1..P0-3`, `P1-1..P1-7`, and `P2-1..P2-8` items
are all resolved and verified.

---

## Round 1 — runtime audit on Android emulator + iOS sim

Gates at start: tsc clean, eslint clean, jest 49/49 ✓.

**Runtime evidence (Android Pixel emulator):** App boots; renders board,
view switcher, timeline strip, prob chart, multiverse summary chips.
On iOS Simulator (iPhone 17), runtime verification was partially blocked
by the parallel agent's app and an iOS notification permission modal that
neither cliclick nor AppleScript could dismiss in the brief windows where
the Simulator window was frontmost. Static review continued.

### Findings (Round 1)

**R1-P1-A (Android safe area)** — `SafeAreaView` from `react-native` does
NOT pad for the Android status bar. The "branchxo" header text rendered
overlapping the system clock + status icons. Captured at
`/tmp/branchxo-android-2.png`.

**R1-P1-B (Chart label overlap)** — `ProbabilityChart` rendered every
ply number on the x-axis. With 9 plies the labels overlapped at the
configured width (`W=320`). Hard to read past ply 4.

**R1-P1-C (Single-point chart invisible)** — When `probHistory.length === 1`
(immediately after first move), the line chart draws only a `moveTo`, so
nothing is visible. Should render a dot.

**R1-P1-D (Hydration flash)** — `App.tsx` had `{!hydrated && <loading/>}`
that ADDED a loader to the layout but ALSO mounted the full UI tree
behind it. On cold start the user briefly sees the initial-store empty
tree, then it pops to the restored state. Should guard the body.

**R1-P1-E (App entry was not memoized)** — `ScrollView` was given `gap`
on `contentContainerStyle` and re-rendered each store tick. Cheap, but
visible re-layout under DevMenu.

### Fixes applied (Round 1)

1. **R1-P1-A:** Added `react-native-safe-area-context@4.10.5` (matches
   Expo SDK 51). Wrapped App in `<SafeAreaProvider>`; switched to the
   library's `<SafeAreaView edges={['top','left','right','bottom']}>`.
   Now respects the Android status bar inset.
2. **R1-P1-B:** Subsample x-axis ply labels — show all when ≤ 5 points,
   otherwise show the first, last, and every Nth where N = ceil((n-1)/4).
3. **R1-P1-C:** Render small dots at each data point (P(X) y-position)
   so a single-point history is still visible.
4. **R1-P1-D:** Hide the entire body (`view` switcher contents + Settings
   panel) until `hydrated === true`; show only the loading text.
5. **R1-P1-E:** Added `keyboardShouldPersistTaps="handled"` and turned
   off the vertical scroll indicator to reduce visual noise on hot reloads.
6. Added `accessibilityRole="header"` to the brand text.

Gates after Round 1 fixes: tsc clean, eslint clean, jest 49/49 ✓.

---

## Round 2 — runtime verification on iOS

(Android Expo Go on the shared emulator has a chronic
ClassCastException/Activity-mismatch crash when a project re-attaches —
this is an Expo-Go-on-Android bug triggered by the parallel agent's
launches. Our app's app-shell code is unaffected; the iOS simulator
verification path was reliable enough to exercise the full flow.)

Verified end-to-end on the iPhone 17 simulator (screenshots in
`/tmp/branchxo-ios-r2-*.png`):

- App boots, brand header below status bar (R1-P1-A fix confirmed).
- All four views render: Board, Timeline, Multiverse, Heat.
- Tap board cell → X placed; status flips to "O to move".
- Scrub timeline by tapping mini-board for past ply → board re-renders;
  status line shows `viewing ply N (scrubbed)`.
- Scrub + divergent tap → BranchPrompt modal appears with correct copy.
- Confirm Branch → multiverse summary increments (1 → 2 universes);
  Multiverse tree view shows two nodes connected by an edge with the
  active path highlighted.
- Switch to Settings → toggle `vs Computer` → reveals AI level + AI mark
  segmented controls.
- Switch back to Board, tap a cell → AI plays its reply in the active
  universe.
- Heat view: 7 strength scores rendered with viridis shading; the
  expected blocking-cell value (90) and threat-build values appear.
- ProbabilityChart: P(X), P(O), P(draw) lines; dots at each data point
  (R1-P1-C); x-axis ply labels at 0, 1, 2 (R1-P1-B); turning point
  annotation visible.
- New Game (reset multiverse) → tree returns to a single root universe.

No new P0 surfaced in Round 2. Two new R3-track P1 items uncovered by
deeper code reading — fixed in Round 3.

---

## Round 3 — deeper code audit

### Findings (Round 3)

**R3-P1-A (stale mode in confirmPendingBranch)** — `confirmPendingBranch`
read `mode` / `aiMark` from the pre-state snapshot (`s`), so if the user
flipped mode while the prompt was open, the wrong branch would be taken.

**R3-P1-F (human steals AI turn while aiThinking)** — `attemptPlay`
did not check `aiThinking`. During the brief window between the AI
being scheduled and applying its move, a human tap could place the
mark for the side-to-move (which is the AI's mark), stealing the
turn. `triggerAiMove` would then bail out gracefully — but the human
had effectively taken the AI's move.

**R3-P1-G (forward tap on AI's turn in vs-computer)** — Even at the tip
with `aiThinking === false`, in vs-computer mode the human could tap
and the store would happily play their mark as the side-to-move
(which is the AI's mark). Only the AI should play on its own turn.

**R3-P1-H (AI applies move to stale state across the yield)** —
`triggerAiMove` reads state, `await setTimeout(0)`, then computes and
applies a move using the PRE-yield snapshot. If the user calls
`newGame`, switches universes, or toggles mode during the yield, the
AI applies a move to a tree that no longer matches.

**R3-P2-C (heat-view tofu glyph)** — `⛨` (U+26E8 BLACK CROSS ON SHIELD)
renders as tofu on some Android system fonts. Replaced with `◆`.

### Fixes applied (Round 3)

1. **R3-P1-A** — `confirmPendingBranch` re-reads `get()` for `mode` /
   `aiMark` before deciding whether to fire the AI move.
2. **R3-P1-F** — `attemptPlay` early-returns if `aiThinking === true`.
3. **R3-P1-G** — `attemptPlay` early-returns if we're at the tip in
   vs-computer mode and `toMove === aiMark`. Scrubbed-back forks
   remain allowed (the AI replies in the forked universe).
4. **R3-P1-H** — `triggerAiMove` re-checks the active universe id, mode,
   and aiMark after the yield. Bails out if any of those changed.
5. **R3-P2-C** — Replaced `⛨` with `◆` in the heat-view label and legend.
6. Added `accessibilityState={{ disabled: occupied && atTip }}` to cell
   Pressables so VoiceOver reports occupied cells as disabled.

### New tests (Round 3)

- `store: audit R3-P1-F` — forcing `aiThinking=true` and calling
  `attemptPlay` does not change the tree.
- `store: audit R3-P1-G` — in vs-computer mode at the tip with AI's
  turn, `attemptPlay` is a no-op.
- `store: audit R3-P1-H` — calling `newGame()` between the human's tap
  and the AI's post-yield apply leaves the fresh tree untouched.
- `multiverse: builds a 50+ node tree` — performance check; building a
  >50-node tree and running `assertTreeInvariants` completes in <200ms
  (typically <2ms in CI).

Gates after Round 3 fixes: tsc clean, eslint clean, jest 53/53 ✓.

---

## Round 4 — see entries appended below

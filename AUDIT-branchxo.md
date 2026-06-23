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

## Round 2 — see entries appended below

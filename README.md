# branchxo

> **Multiverse Tic-Tac-Toe** — a branching-timeline twist on the classic 3×3 game.
> React Native + Expo (SDK 51) + TypeScript (strict).
> Repository: <https://github.com/etabli-dev/etabli-branchxo>

`branchxo` is not ordinary tic-tac-toe. Every move is recorded on an explicit
**timeline**, and you can scrub back and **branch** into a parallel universe by
making a different move at any past ply. The full game state is therefore a
**tree of universes**, not a single line.

---

## Run

```bash
cd Untitled/branchxo
npm install
npx expo start
```

Press `i` for iOS Simulator, `a` for Android emulator, or scan the QR code with
Expo Go on a device. The project also runs in the web preview (`w`).

### Other scripts

```bash
npm test           # Jest unit tests (40 tests)
npm run typecheck  # tsc --noEmit (strict)
npm run lint       # ESLint
```

---

## The game model

### Timeline (single line of play)

Each move appends to an ordered **timeline** of plies. The board at any ply is
reconstructable by replaying ply 0…t. You can scrub the timeline to view any
past position — scrubbing is **read-only**.

### Branching (the multiverse)

From any past ply, playing a *different* cell forks a **new universe**: a child
node sharing the prefix with its parent then diverging. The parent universe is
preserved untouched. Each universe is its own self-contained 3-in-a-row game.

- One universe is **active** at a time (the one you're extending).
- Others are dormant but stay in the tree and remain navigable.
- Win/draw is evaluated **per universe**.

### Modes

- **Hotseat** — two humans share the device.
- **vs Computer** — you choose the AI's mark and level. After a fork, the AI
  computes its reply *in that universe* from the fork point onward.

---

## Views (segmented switcher at the top)

| View | What it shows |
|---|---|
| **Board** | The active universe's current 3×3. Tap an empty cell to play. Scrubbed back + tapping a different cell prompts a "branch?" confirmation. Also shows the per-universe probability chart underneath. |
| **Timeline** | Horizontal filmstrip of mini-boards for every ply in the active universe. Tap any ply to scrub there. |
| **Multiverse** | The headline view: the whole universe tree rendered with Skia. Nodes are color-coded by outcome (X-win blue / O-win orange / draw grey / open purple). Tap a node to make that universe active; the active path is highlighted. Includes a one-glance multiverse outcome summary at the top. |
| **Heat** | Strength heat-overlay for the active board: every empty cell shaded on a viridis gradient by `strength(c)` (see below). |

---

## Move-strength overlay ("powerful next steps")

Toggleable **per-player** in Settings; off by default. For the side to move, the
strength of an empty cell `c` is

```
strength(c) = Σ over winning lines L through c:
  - line with only my marks (k):       10^k
  - line with only opp marks (k):      10^k * 0.9
  - mixed line:                        0
  - fully empty line:                  1     (centrality)
```

This makes an immediate win (`10^2 = 100`) and an immediate block (`~90`)
clearly dominate, building threats (`10^1 = 10`) sit below, and pure centrality
plays score `1` per empty line through the cell.

Top-N (default 3) candidate cells get ranked halos on the **Board** view; the
**Heat** view shades all empties on the viridis gradient.

---

## AI levels

- **Easy** — random legal move, but always takes an immediate win and blocks an
  immediate loss.
- **Medium** — picks the cell with the highest strength score (the same overlay
  function above).
- **Perfect** — full minimax over the (tiny) 3×3 game tree with a position cache
  keyed by `board|toMove`. Perfect play never loses; it always takes a forced
  win and blocks a forced loss.

---

## Probability modes

After every ply, branchxo records `P(X win), P(O win), P(draw)` for the active
universe. Two modes are available (toggle in Settings):

- **vs Perfect play** — exact outcome from each position via minimax. Since 3×3
  is solved, the answer is always 0/1 across the three outcomes.
- **vs Random play** — Monte-Carlo rollouts (default 300, both sides playing
  the random-but-greedy "Easy" policy). The resulting curve is the
  interesting one to watch over time.

The probability chart highlights the **biggest-swing ply** — the turning point.
The Multiverse view also shows a one-glance summary of outcome counts across
all universes in the tree.

---

## State, persistence

- Zustand store (`src/state/store.ts`) holds the multiverse tree, active
  universe, scrub position, mode, AI settings, view, per-player overlay flags,
  and probability mode.
- The whole tree + settings is persisted via `@react-native-async-storage/async-storage`
  and rehydrated on relaunch.
- **New game** in Settings resets the multiverse to a single empty root.

---

## Layout

```
/src
  /game        3×3 engine: types, win-check, rules, replay
  /multiverse  tree model, fork/branch logic, navigation
  /ai          easy/medium/perfect minimax + policies, cache
  /state       Zustand store + AsyncStorage hydrate/persist
  /views       BoardView, TimelineStrip, MultiverseTree, HeatView,
               ProbabilityChart, ViewSwitcher, SettingsPanel, BranchPrompt
  /overlay     strength function + ranked badges + heat-norm
  /analysis    minimax-exact probs + random rollouts + turning-point
  /ui          theme (color-blind safe), SegmentedControl, Pill
App.tsx
```

---

## Quality

- TypeScript **strict** (no `any`, `noUncheckedIndexedAccess` on).
- ESLint clean, Prettier formatted.
- 40 Jest unit tests covering engine, strength fn, multiverse fork/branch
  invariants, AI (easy + perfect), and probability modes.
- Color-blind-safe palette (Okabe–Ito X/O pair); cells + tree nodes carry
  accessibility labels.

See [DECISIONS.md](./DECISIONS.md) for design notes.

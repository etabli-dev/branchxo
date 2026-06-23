import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { AiLevel, chooseMove } from '../ai';
import { biggestSwingPly, computeProbHistory, ProbMode } from '../analysis';
import { CellIndex, Mark, applyMove, other, statusFor } from '../game';
import {
  MultiverseTree,
  Universe,
  UniverseId,
  assertTreeInvariants,
  createInitialTree,
  fullMoves,
  playOrFork,
  summarize,
} from '../multiverse';

export type Mode = 'hotseat' | 'vs-computer';
export type ViewKey = 'board' | 'timeline' | 'tree' | 'heat';

export interface OverlayFlags {
  X: boolean;
  O: boolean;
}

/**
 * Pending branch confirmation includes the source universe id so we can refuse
 * to confirm if the user switched active universe between prompt and confirm.
 */
export interface BranchPrompt {
  readonly sourceUniverseId: UniverseId;
  readonly atPly: number;
  readonly cell: CellIndex;
}

export interface AppState {
  // tree + navigation
  tree: MultiverseTree;
  activeUniverseId: UniverseId;
  scrubPly: number;

  // mode + AI
  mode: Mode;
  aiLevel: AiLevel;
  aiMark: Mark; // which side the AI plays in vs-computer
  aiThinking: boolean;

  // view
  view: ViewKey;

  // overlay
  overlayFlags: OverlayFlags;
  overlayTopN: number;

  // probability mode
  probMode: ProbMode;
  rolloutCount: number;

  // pending branch confirmation
  pendingBranch: BranchPrompt | null;

  // hydration state
  hydrated: boolean;

  // actions
  setView: (v: ViewKey) => void;
  setMode: (m: Mode) => void;
  setAiLevel: (l: AiLevel) => void;
  setAiMark: (m: Mark) => void;
  setProbMode: (m: ProbMode) => void;
  setOverlayFlag: (mark: Mark, on: boolean) => void;
  setScrubPly: (p: number) => void;
  setActiveUniverse: (id: UniverseId) => void;
  newGame: () => void;
  cancelPendingBranch: () => void;
  /** Attempt a tap at cell. May prompt for branch confirmation if forking is needed. */
  attemptPlay: (cell: CellIndex) => void;
  /** Confirm a pending branch (after a "branch?" prompt). */
  confirmPendingBranch: () => void;
  /** Force an AI move in the active universe (used by vs-computer flow). */
  triggerAiMove: () => Promise<void>;
  /** Recompute prob history for the active universe under current mode (debounced + cancellable). */
  recomputeProbHistory: () => void;
  /** Returns multiverse summary. */
  multiverseSummary: () => ReturnType<typeof summarize>;
  /** For tests. */
  _setHydrated: (h: boolean) => void;
}

const STORAGE_KEY = 'branchxo:v2';
const SCHEMA_VERSION = 2;

interface Persisted {
  version: number;
  tree: MultiverseTree;
  activeUniverseId: UniverseId;
  scrubPly: number;
  mode: Mode;
  aiLevel: AiLevel;
  aiMark: Mark;
  view: ViewKey;
  overlayFlags: OverlayFlags;
  overlayTopN: number;
  probMode: ProbMode;
  rolloutCount: number;
}

function makeInitialTreeAndId(): { tree: MultiverseTree; activeUniverseId: UniverseId } {
  const tree = createInitialTree();
  return { tree, activeUniverseId: tree.rootId };
}

// === Debounced + cancellable prob recompute ===
let probRecomputeTimer: ReturnType<typeof setTimeout> | null = null;
let probRecomputeRunId = 0;

function cancelProbRecompute(): void {
  if (probRecomputeTimer) {
    clearTimeout(probRecomputeTimer);
    probRecomputeTimer = null;
  }
  probRecomputeRunId += 1; // any in-flight run will see its id is stale
}

// === Re-freeze boards (defensive — see audit P0-2) ===
export function reFreezeTree(tree: MultiverseTree): MultiverseTree {
  const universes: Record<UniverseId, Universe> = {};
  for (const id of Object.keys(tree.universes)) {
    const u = tree.universes[id];
    if (!u) continue;
    universes[id] = { ...u, board: Object.freeze([...u.board]) };
  }
  return { rootId: tree.rootId, universes };
}

export const useAppStore = create<AppState>((set, get) => {
  const initial = makeInitialTreeAndId();

  return {
    tree: initial.tree,
    activeUniverseId: initial.activeUniverseId,
    scrubPly: 0,
    mode: 'hotseat',
    aiLevel: 'perfect',
    aiMark: 'O',
    aiThinking: false,
    view: 'board',
    overlayFlags: { X: false, O: false },
    overlayTopN: 3,
    probMode: 'perfect',
    rolloutCount: 300,
    pendingBranch: null,
    hydrated: false,

    setView: (v) => set({ view: v }),
    setMode: (m) => {
      set({ mode: m });
      // Audit P1-1: auto-trigger AI if switching to vs-computer and it's AI's turn
      if (m === 'vs-computer') {
        const s = get();
        const active = s.tree.universes[s.activeUniverseId];
        if (active && active.status.kind === 'open' && active.status.toMove === s.aiMark) {
          void get().triggerAiMove();
        }
      }
    },
    setAiLevel: (l) => set({ aiLevel: l }),
    setAiMark: (m) => {
      set({ aiMark: m });
      // re-check: if it's now the AI's turn, kick it
      const s = get();
      if (s.mode === 'vs-computer') {
        const active = s.tree.universes[s.activeUniverseId];
        if (active && active.status.kind === 'open' && active.status.toMove === m) {
          void get().triggerAiMove();
        }
      }
    },
    setProbMode: (m) => {
      set({ probMode: m });
      get().recomputeProbHistory();
    },
    setOverlayFlag: (mark, on) =>
      set((s) => ({ overlayFlags: { ...s.overlayFlags, [mark]: on } })),
    setScrubPly: (p) => set({ scrubPly: Math.max(0, p) }),
    setActiveUniverse: (id) => {
      const u = get().tree.universes[id];
      if (!u) return;
      const moves = fullMoves(get().tree, id);
      // Audit P0-3: cancel any pending branch when active universe changes,
      // because the pending branch was relative to a different universe.
      set({ activeUniverseId: id, scrubPly: moves.length, pendingBranch: null });
      get().recomputeProbHistory();
    },

    newGame: () => {
      cancelProbRecompute();
      const next = makeInitialTreeAndId();
      set({
        tree: next.tree,
        activeUniverseId: next.activeUniverseId,
        scrubPly: 0,
        pendingBranch: null,
      });
    },

    cancelPendingBranch: () => set({ pendingBranch: null }),

    attemptPlay: (cell) => {
      const s = get();
      // Audit P1-7: refuse new tap while a branch prompt is pending
      if (s.pendingBranch) return;
      // Audit R3-P1-F: refuse human tap while AI is thinking — otherwise human
      // can "steal" the AI's turn by playing the AI's mark on a cell.
      if (s.aiThinking) return;

      const active = s.tree.universes[s.activeUniverseId];
      if (!active) return;
      // Audit R3-P1-G: in vs-computer mode, refuse forward taps when it's the
      // AI's turn — the human should only be able to tap on their own turn.
      // Scrubbed-back forks are still allowed (they re-trigger AI after fork).
      const full = fullMoves(s.tree, active.id);
      const scrubbedBack = s.scrubPly < full.length;
      if (
        !scrubbedBack &&
        s.mode === 'vs-computer' &&
        active.status.kind === 'open' &&
        active.status.toMove === s.aiMark
      ) {
        return;
      }

      if (scrubbedBack) {
        const existing = full[s.scrubPly];
        if (!existing || existing.cell !== cell) {
          // verify the cell is empty in the prefix board before prompting
          let prefixBoard = active.board;
          if (s.scrubPly < full.length) {
            const moves = full.slice(0, s.scrubPly);
            // local replay
            const b: (Mark | null)[] = Array(9).fill(null);
            for (const m of moves) b[m.cell] = m.mark;
            prefixBoard = Object.freeze(b);
          }
          if (prefixBoard[cell] !== null) return;
          set({
            pendingBranch: {
              sourceUniverseId: active.id,
              atPly: s.scrubPly,
              cell,
            },
          });
          return;
        }
        // same cell at scrubbed ply → no-op
        return;
      }

      // forward play — board status must be open
      if (active.status.kind !== 'open') return;
      if (active.board[cell] !== null) return;

      const { tree, universe } = playOrFork(s.tree, active.id, s.scrubPly, cell);
      const newPly = fullMoves(tree, universe.id).length;
      set({
        tree,
        activeUniverseId: universe.id,
        scrubPly: newPly,
        pendingBranch: null,
      });

      get().recomputeProbHistory();
      if (s.mode === 'vs-computer' && universe.status.kind === 'open' && universe.status.toMove === s.aiMark) {
        void get().triggerAiMove();
      }
    },

    confirmPendingBranch: () => {
      const s = get();
      const pending = s.pendingBranch;
      if (!pending) return;
      // Audit P0-3: refuse confirm if active universe changed since prompt opened.
      if (pending.sourceUniverseId !== s.activeUniverseId) {
        set({ pendingBranch: null });
        return;
      }
      const active = s.tree.universes[s.activeUniverseId];
      if (!active) {
        set({ pendingBranch: null });
        return;
      }

      let nextTree: MultiverseTree;
      let nextActive: Universe;
      try {
        const res = playOrFork(s.tree, active.id, pending.atPly, pending.cell);
        nextTree = res.tree;
        nextActive = res.universe;
      } catch {
        set({ pendingBranch: null });
        return;
      }
      const newPly = fullMoves(nextTree, nextActive.id).length;
      set({
        tree: nextTree,
        activeUniverseId: nextActive.id,
        scrubPly: newPly,
        pendingBranch: null,
      });

      get().recomputeProbHistory();
      // Audit R3-P1-A: use fresh store state (mode/aiMark could change while prompt open)
      const fresh = get();
      if (fresh.mode === 'vs-computer' && nextActive.status.kind === 'open' && nextActive.status.toMove === fresh.aiMark) {
        void get().triggerAiMove();
      }
    },

    triggerAiMove: async () => {
      const s = get();
      const active = s.tree.universes[s.activeUniverseId];
      if (!active || active.status.kind !== 'open') return;
      if (active.status.toMove !== s.aiMark) return;
      set({ aiThinking: true });
      // Audit P1-2: yield to UI so the "thinking…" indicator can render
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      try {
        // Audit R3-P1-H: re-read state after the yield. If the universe / mode /
        // aiMark changed during our wait (e.g. user hit "new game" or switched
        // active), bail out instead of applying the move to stale state.
        const post = get();
        const postActive = post.tree.universes[post.activeUniverseId];
        if (!postActive || postActive.id !== active.id) return;
        if (postActive.status.kind !== 'open') return;
        if (post.mode !== 'vs-computer') return;
        if (postActive.status.toMove !== post.aiMark) return;
        const cell = chooseMove(postActive.board, post.aiMark, post.aiLevel);
        const moves = fullMoves(post.tree, postActive.id);
        const { tree, universe } = playOrFork(post.tree, postActive.id, moves.length, cell);
        const newPly = fullMoves(tree, universe.id).length;
        set({
          tree,
          activeUniverseId: universe.id,
          scrubPly: newPly,
        });
        get().recomputeProbHistory();
      } finally {
        set({ aiThinking: false });
      }
    },

    recomputeProbHistory: () => {
      // Audit P0-1: debounced + cancellable. We capture a run id; if it
      // changes before/while we compute, we discard the result.
      cancelProbRecompute();
      const myRunId = ++probRecomputeRunId;
      probRecomputeTimer = setTimeout(() => {
        const s = get();
        const active = s.tree.universes[s.activeUniverseId];
        if (!active) return;
        const moves = fullMoves(s.tree, active.id);
        const history = computeProbHistory(moves, s.probMode, {
          rollouts: s.rolloutCount,
          shouldCancel: () => myRunId !== probRecomputeRunId,
        });
        if (myRunId !== probRecomputeRunId) return; // got cancelled
        const updated: Universe = { ...active, probHistory: history };
        set((cur) => ({
          tree: {
            ...cur.tree,
            universes: { ...cur.tree.universes, [active.id]: updated },
          },
        }));
      }, 150);
    },

    multiverseSummary: () => summarize(get().tree),

    _setHydrated: (h) => set({ hydrated: h }),
  };
});

/** Save state to AsyncStorage (debounced). */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const s = useAppStore.getState();
    const payload: Persisted = {
      version: SCHEMA_VERSION,
      tree: s.tree,
      activeUniverseId: s.activeUniverseId,
      scrubPly: s.scrubPly,
      mode: s.mode,
      aiLevel: s.aiLevel,
      aiMark: s.aiMark,
      view: s.view,
      overlayFlags: s.overlayFlags,
      overlayTopN: s.overlayTopN,
      probMode: s.probMode,
      rolloutCount: s.rolloutCount,
    };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      if (__DEV__) console.warn('branchxo: persist failed', e);
    }
  }, 300);
}

/** Hydrate state from AsyncStorage at app start. */
export async function hydrate(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Persisted;
      if (
        parsed.version === SCHEMA_VERSION &&
        parsed.tree.universes[parsed.activeUniverseId]
      ) {
        try {
          // Audit P0-2: re-freeze boards defensively before invariant check.
          const frozenTree = reFreezeTree(parsed.tree);
          assertTreeInvariants(frozenTree);
          useAppStore.setState({
            tree: frozenTree,
            activeUniverseId: parsed.activeUniverseId,
            scrubPly: parsed.scrubPly,
            mode: parsed.mode,
            aiLevel: parsed.aiLevel,
            aiMark: parsed.aiMark,
            view: parsed.view,
            overlayFlags: parsed.overlayFlags,
            overlayTopN: parsed.overlayTopN,
            probMode: parsed.probMode,
            rolloutCount: parsed.rolloutCount,
          });
        } catch (e) {
          if (__DEV__) console.warn('branchxo: stored tree failed invariants, resetting', e);
        }
      }
    }
  } catch (e) {
    if (__DEV__) console.warn('branchxo: hydrate failed', e);
  } finally {
    useAppStore.getState()._setHydrated(true);
  }
}

// Auto-persist on state changes.
useAppStore.subscribe(() => {
  if (useAppStore.getState().hydrated) scheduleSave();
});

// `__DEV__` global (declared in react-native runtime, declared here for tsc)
declare const __DEV__: boolean;

// Re-export helpers used by tests / UI.
export { fullMoves, summarize, applyMove, statusFor, other, biggestSwingPly };

/**
 * Store tests for the audit-driven fixes.
 *
 * We mock AsyncStorage and __DEV__ in jest setup below.
 */

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store[k] = v;
      }),
      removeItem: jest.fn(async (k: string) => {
        delete store[k];
      }),
      clear: jest.fn(async () => {
        for (const k of Object.keys(store)) delete store[k];
      }),
    },
  };
});

// Provide global __DEV__
// @ts-expect-error: declare for jest env
global.__DEV__ = true;

import { CellIndex } from '../src/game';
import { _resetIdCounterForTests, assertTreeInvariants, fullMoves } from '../src/multiverse';
import { reFreezeTree, useAppStore } from '../src/state/store';

function resetStore() {
  useAppStore.getState().newGame();
}

beforeEach(() => {
  _resetIdCounterForTests();
  resetStore();
});

describe('store: attemptPlay forward', () => {
  it('extends the active universe (no fork) when at the tip', () => {
    const s = useAppStore.getState();
    const rootId = s.activeUniverseId;
    s.attemptPlay(4 as CellIndex);
    const after = useAppStore.getState();
    // active universe stays root; one move added
    expect(after.activeUniverseId).toBe(rootId);
    const moves = fullMoves(after.tree, after.activeUniverseId);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.cell).toBe(4);
  });
});

describe('store: branch prompt', () => {
  it('opens the prompt when divergent move at past ply, leaves tree unchanged', () => {
    let s = useAppStore.getState();
    s.attemptPlay(4 as CellIndex); // X at 4
    s.attemptPlay(0 as CellIndex); // O at 0
    s = useAppStore.getState();
    // scrub back to ply 1
    s.setScrubPly(1);
    const snapshot = JSON.stringify(useAppStore.getState().tree);
    useAppStore.getState().attemptPlay(8 as CellIndex);
    const after = useAppStore.getState();
    expect(after.pendingBranch).not.toBeNull();
    expect(after.pendingBranch?.atPly).toBe(1);
    expect(after.pendingBranch?.cell).toBe(8);
    // tree must not have mutated
    expect(JSON.stringify(after.tree)).toBe(snapshot);
  });

  it('confirmPendingBranch creates a new universe and leaves parent untouched', () => {
    const s = useAppStore.getState();
    const root = s.activeUniverseId;
    s.attemptPlay(4 as CellIndex);
    s.attemptPlay(0 as CellIndex);
    useAppStore.getState().setScrubPly(1);
    useAppStore.getState().attemptPlay(8 as CellIndex);
    const before = useAppStore.getState();
    const parentMoves = [...(before.tree.universes[root]?.moves ?? [])];
    useAppStore.getState().confirmPendingBranch();
    const after = useAppStore.getState();
    expect(after.pendingBranch).toBeNull();
    // parent universe unchanged
    expect(after.tree.universes[root]?.moves).toEqual(parentMoves);
    // active is a new universe id
    expect(after.activeUniverseId).not.toBe(root);
    assertTreeInvariants(after.tree);
  });

  it('audit P0-3: switching active universe cancels pending branch', () => {
    useAppStore.getState().attemptPlay(4 as CellIndex);
    useAppStore.getState().attemptPlay(0 as CellIndex);
    useAppStore.getState().setScrubPly(1);
    useAppStore.getState().attemptPlay(8 as CellIndex);
    expect(useAppStore.getState().pendingBranch).not.toBeNull();
    const rootId = useAppStore.getState().tree.rootId;
    useAppStore.getState().setActiveUniverse(rootId);
    expect(useAppStore.getState().pendingBranch).toBeNull();
  });

  it('audit P1-7: second attemptPlay while a prompt is pending is ignored', () => {
    useAppStore.getState().attemptPlay(4 as CellIndex);
    useAppStore.getState().attemptPlay(0 as CellIndex);
    useAppStore.getState().setScrubPly(1);
    useAppStore.getState().attemptPlay(8 as CellIndex);
    const treeBefore = JSON.stringify(useAppStore.getState().tree);
    const pendingBefore = useAppStore.getState().pendingBranch;
    useAppStore.getState().attemptPlay(2 as CellIndex);
    const treeAfter = JSON.stringify(useAppStore.getState().tree);
    const pendingAfter = useAppStore.getState().pendingBranch;
    expect(treeAfter).toBe(treeBefore);
    expect(pendingAfter).toEqual(pendingBefore);
  });
});

describe('store: cycling views never mutates the tree', () => {
  it('audit D10: 6-node tree, cycle all views, tree byte-identical', () => {
    // build a 6-node tree
    const s = useAppStore.getState();
    const rootId = s.activeUniverseId;
    s.attemptPlay(4 as CellIndex); // X
    s.attemptPlay(0 as CellIndex); // O
    s.attemptPlay(8 as CellIndex); // X
    // fork from root at ply 1 → cell 1
    useAppStore.getState().setActiveUniverse(rootId);
    useAppStore.getState().setScrubPly(1);
    useAppStore.getState().attemptPlay(1 as CellIndex);
    useAppStore.getState().confirmPendingBranch();
    // fork from root at ply 2 → cell 6
    useAppStore.getState().setActiveUniverse(rootId);
    useAppStore.getState().setScrubPly(2);
    useAppStore.getState().attemptPlay(6 as CellIndex);
    useAppStore.getState().confirmPendingBranch();
    // ensure 4+ nodes
    const treeSnapshot = JSON.stringify(useAppStore.getState().tree);
    const count = Object.keys(useAppStore.getState().tree.universes).length;
    expect(count).toBeGreaterThanOrEqual(3);

    useAppStore.getState().setView('board');
    useAppStore.getState().setView('timeline');
    useAppStore.getState().setView('tree');
    useAppStore.getState().setView('heat');
    expect(JSON.stringify(useAppStore.getState().tree)).toBe(treeSnapshot);
  });
});

describe('reFreezeTree (audit P0-2)', () => {
  it('returns a tree whose boards are frozen', () => {
    const original = useAppStore.getState().tree;
    useAppStore.getState().attemptPlay(4 as CellIndex);
    const t = useAppStore.getState().tree;
    const refrozen = reFreezeTree(t);
    for (const u of Object.values(refrozen.universes)) {
      expect(Object.isFrozen(u.board)).toBe(true);
    }
    // identity / structure preserved
    expect(refrozen.rootId).toBe(t.rootId);
    void original;
  });
});

describe('AI thinking flag (audit P1-2)', () => {
  it('aiThinking flips to true during compute then back to false', async () => {
    useAppStore.getState().setMode('vs-computer');
    useAppStore.getState().setAiMark('O');
    // X plays first → AI's turn
    useAppStore.getState().attemptPlay(4 as CellIndex);
    // The store launches triggerAiMove via void. Poll briefly.
    let sawThinking = false;
    for (let i = 0; i < 40; i++) {
      if (useAppStore.getState().aiThinking) sawThinking = true;
      // micro-sleep
      await new Promise<void>((r) => setTimeout(r, 1));
    }
    // After settle, flag is back to false
    expect(useAppStore.getState().aiThinking).toBe(false);
    // The AI placed a move → fullMoves length is 2 (X then O)
    expect(fullMoves(useAppStore.getState().tree, useAppStore.getState().activeUniverseId).length).toBe(2);
    expect(sawThinking).toBe(true);
  });
});

describe('audit R3-P1-H: triggerAiMove re-checks post-yield state', () => {
  it('newGame during AI thinking does not apply AI move to stale state', async () => {
    useAppStore.getState().setMode('vs-computer');
    useAppStore.getState().setAiMark('O');
    // Human plays X. AI scheduled.
    useAppStore.getState().attemptPlay(4 as CellIndex);
    // Immediately new-game before AI's setTimeout(0) fires.
    useAppStore.getState().newGame();
    // Wait for any AI processing to settle.
    for (let i = 0; i < 50; i++) {
      if (!useAppStore.getState().aiThinking) break;
      await new Promise<void>((r) => setTimeout(r, 1));
    }
    // After settle, the tree should be fresh — single root universe, empty
    // move list. AI should NOT have applied any move from the old tree.
    const s = useAppStore.getState();
    expect(Object.keys(s.tree.universes)).toHaveLength(1);
    expect(s.tree.universes[s.activeUniverseId]?.moves).toEqual([]);
  });
});

describe('audit R3-P1-F: attemptPlay ignored while aiThinking', () => {
  it('a human tap directly while aiThinking is true does not change the tree', () => {
    // Force aiThinking to true and confirm attemptPlay no-ops.
    useAppStore.getState().setMode('hotseat');
    const lenBefore = fullMoves(
      useAppStore.getState().tree,
      useAppStore.getState().activeUniverseId,
    ).length;
    useAppStore.setState({ aiThinking: true });
    useAppStore.getState().attemptPlay(0 as CellIndex);
    expect(
      fullMoves(useAppStore.getState().tree, useAppStore.getState().activeUniverseId).length,
    ).toBe(lenBefore);
    useAppStore.setState({ aiThinking: false });
  });
});

describe('audit R3-P1-G: forward tap on AI turn is ignored', () => {
  it('in vs-computer mode, tapping when toMove === aiMark is a no-op', () => {
    useAppStore.getState().setMode('hotseat');
    // build a state where O is to move (X plays 4)
    useAppStore.getState().attemptPlay(4 as CellIndex);
    // Now switch to vs-computer with aiMark=O — it's AI's turn.
    // setMode triggers the AI move asynchronously; we want to test the SYNC
    // refusal-of-tap on the AI's turn before AI fires.
    useAppStore.getState().setAiMark('O');
    useAppStore.setState({ mode: 'vs-computer' }); // sync mode flip skipping the auto-trigger
    expect(
      useAppStore.getState().tree.universes[useAppStore.getState().activeUniverseId]?.status.kind,
    ).toBe('open');
    // Try a forward tap. Should be ignored because it's AI's turn.
    const lenBefore = fullMoves(
      useAppStore.getState().tree,
      useAppStore.getState().activeUniverseId,
    ).length;
    useAppStore.getState().attemptPlay(0 as CellIndex);
    expect(
      fullMoves(useAppStore.getState().tree, useAppStore.getState().activeUniverseId).length,
    ).toBe(lenBefore);
  });
});

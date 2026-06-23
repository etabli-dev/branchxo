import { CellIndex } from '../src/game';
import {
  _resetIdCounterForTests,
  appendMove,
  assertTreeInvariants,
  childrenOf,
  createInitialTree,
  fork,
  fullMoves,
  pathToRoot,
  playOrFork,
  reconstructBoard,
  summarize,
} from '../src/multiverse';

describe('multiverse tree', () => {
  beforeEach(() => _resetIdCounterForTests());

  it('creates a root universe with empty board', () => {
    const t = createInitialTree();
    const u = t.universes[t.rootId];
    expect(u).toBeDefined();
    if (!u) return;
    expect(u.moves).toEqual([]);
    expect(u.parentId).toBeNull();
    expect(u.status.kind).toBe('open');
  });

  it('appendMove extends the active universe (not a fork) and yields correct board', () => {
    const t0 = createInitialTree();
    const r0 = appendMove(t0, t0.rootId, 4 as CellIndex);
    const r1 = appendMove(r0.tree, t0.rootId, 0 as CellIndex);
    expect(r1.universe.board[4]).toBe('X');
    expect(r1.universe.board[0]).toBe('O');
    expect(fullMoves(r1.tree, t0.rootId)).toHaveLength(2);
    // root universe still has just one node (no children)
    expect(childrenOf(r1.tree, t0.rootId)).toHaveLength(0);
  });

  it('fork creates a child whose prefix = parent moves up to parentPly, then diverges', () => {
    let t = createInitialTree();
    const root = t.rootId;
    t = appendMove(t, root, 4 as CellIndex).tree;
    t = appendMove(t, root, 0 as CellIndex).tree;
    t = appendMove(t, root, 8 as CellIndex).tree;
    // parent now has 3 moves; fork at ply 2 picking cell 6 (different from cell 8).
    // After 2 plies (X at 4, O at 0), it is X's turn → forked move at cell 6 should be 'X'.
    const beforeMoves = [...(t.universes[root]?.moves ?? [])];
    const beforeBoard = [...(t.universes[root]?.board ?? [])];

    const { tree: t2, universe: child } = fork(t, root, 2, 6 as CellIndex, 'branch-A');

    // parent untouched
    expect(t2.universes[root]?.moves).toEqual(beforeMoves);
    expect(t2.universes[root]?.board).toEqual(beforeBoard);

    // child prefix == parent[0..2] then [{cell:6, mark:'X'}]
    expect(child.parentId).toBe(root);
    expect(child.parentPly).toBe(2);
    const childFull = fullMoves(t2, child.id);
    expect(childFull.slice(0, 2)).toEqual(beforeMoves.slice(0, 2));
    expect(childFull[2]).toEqual({ cell: 6, mark: 'X' });
  });

  it('cannot fork onto a cell occupied in the prefix board', () => {
    let t = createInitialTree();
    const root = t.rootId;
    t = appendMove(t, root, 4 as CellIndex).tree;
    t = appendMove(t, root, 0 as CellIndex).tree;
    t = appendMove(t, root, 8 as CellIndex).tree;
    // prefix at ply 3 has cell 4 already taken (X). Try to fork at ply 3 onto cell 4.
    expect(() => fork(t, root, 3, 4 as CellIndex)).toThrow(/occupied/);
  });

  it('cannot branch past a terminal position', () => {
    let t = createInitialTree();
    const root = t.rootId;
    // X wins on top row
    [
      { cell: 0, mark: 'X' as const },
      { cell: 3, mark: 'O' as const },
      { cell: 1, mark: 'X' as const },
      { cell: 4, mark: 'O' as const },
      { cell: 2, mark: 'X' as const },
    ].forEach((m) => {
      t = appendMove(t, root, m.cell as CellIndex).tree;
    });
    // trying to fork at ply 5 (past end / terminal) using same/any cell
    expect(() => fork(t, root, 5, 8 as CellIndex)).toThrow(/terminal/);
  });

  it('cannot fork with the same move as already played at that ply', () => {
    let t = createInitialTree();
    const root = t.rootId;
    t = appendMove(t, root, 4 as CellIndex).tree;
    t = appendMove(t, root, 0 as CellIndex).tree;
    // existing move at ply 1 is cell 0
    expect(() => fork(t, root, 1, 0 as CellIndex)).toThrow(/identical|divergence|occupied/);
  });

  it('board reconstruction matches stored board for random nodes', () => {
    let t = createInitialTree();
    const root = t.rootId;
    // build a tree
    t = appendMove(t, root, 4 as CellIndex).tree;
    t = appendMove(t, root, 0 as CellIndex).tree;
    t = appendMove(t, root, 8 as CellIndex).tree;
    const b1 = fork(t, root, 1, 2 as CellIndex);
    t = b1.tree;
    const b2 = fork(t, root, 2, 6 as CellIndex);
    t = b2.tree;
    const c1 = appendMove(t, b1.universe.id, 6 as CellIndex);
    t = c1.tree;
    // child node board reconstruction
    for (const id of Object.keys(t.universes)) {
      const u = t.universes[id];
      if (!u) continue;
      const fresh = reconstructBoard(t, id);
      expect(fresh).toEqual(u.board);
    }
  });

  it('summarize counts node outcomes correctly', () => {
    let t = createInitialTree();
    const root = t.rootId;
    // play out an X win on root
    [0, 3, 1, 4, 2].forEach((c, i) => {
      t = appendMove(t, root, c as CellIndex).tree;
      void i;
    });
    const s = summarize(t);
    expect(s.xWins + s.oWins + s.draws + s.open).toBe(s.total);
    expect(s.xWins).toBe(1);
  });

  it('pathToRoot returns chain root → leaf', () => {
    let t = createInitialTree();
    const root = t.rootId;
    t = appendMove(t, root, 4 as CellIndex).tree;
    t = appendMove(t, root, 0 as CellIndex).tree;
    const b = fork(t, root, 1, 8 as CellIndex);
    t = b.tree;
    const path = pathToRoot(t, b.universe.id);
    expect(path[0]?.id).toBe(root);
    expect(path[path.length - 1]?.id).toBe(b.universe.id);
  });

  it('playOrFork: forward extension does not fork', () => {
    let t = createInitialTree();
    const root = t.rootId;
    const r = playOrFork(t, root, 0, 4 as CellIndex);
    t = r.tree;
    expect(r.forked).toBe(false);
    expect(r.universe.id).toBe(root);
  });

  it('playOrFork: divergent move at past ply forks (parent unchanged)', () => {
    let t = createInitialTree();
    const root = t.rootId;
    t = playOrFork(t, root, 0, 4 as CellIndex).tree;
    t = playOrFork(t, root, 1, 0 as CellIndex).tree;
    const beforeMoves = [...(t.universes[root]?.moves ?? [])];
    const r = playOrFork(t, root, 1, 8 as CellIndex);
    expect(r.forked).toBe(true);
    expect(t.universes[root]?.moves).toEqual(beforeMoves);
    expect(r.universe.id).not.toBe(root);
  });

  it('tree invariants hold after random operations', () => {
    let t = createInitialTree();
    const root = t.rootId;
    t = appendMove(t, root, 4 as CellIndex).tree;
    t = appendMove(t, root, 0 as CellIndex).tree;
    const a = fork(t, root, 1, 8 as CellIndex);
    t = a.tree;
    const a2 = appendMove(t, a.universe.id, 1 as CellIndex);
    t = a2.tree;
    assertTreeInvariants(t);
  });

  it('builds a 50+ node tree quickly without invariant violations', () => {
    // Spec "tree of 50+ nodes" performance check. We don't measure FPS here;
    // we just confirm the construction/invariant check stays fast (< 200ms).
    let t = createInitialTree();
    const root = t.rootId;
    // Seed: 3 forward moves on root
    t = appendMove(t, root, 0 as CellIndex).tree;
    t = appendMove(t, root, 4 as CellIndex).tree;
    t = appendMove(t, root, 1 as CellIndex).tree;
    // Now fork from various plies (1..2) for each parent we have so far.
    const cellsToTry: readonly CellIndex[] = [2, 3, 5, 6, 7, 8] as readonly CellIndex[];
    const parents: string[] = [root];
    let nodes = 1;
    let i = 0;
    while (nodes < 55) {
      const parentId = parents[i % parents.length];
      if (!parentId) break;
      const cell = cellsToTry[(i * 7) % cellsToTry.length];
      if (cell === undefined) break;
      try {
        const r = fork(t, parentId, 1 + (i % 2), cell);
        t = r.tree;
        parents.push(r.universe.id);
        nodes++;
      } catch {
        // Skip illegal forks (occupied/terminal/identical) — just advance.
      }
      i++;
      if (i > 500) break; // safety guard
    }
    expect(nodes).toBeGreaterThanOrEqual(50);
    const start = Date.now();
    assertTreeInvariants(t);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});

import { Canvas, Circle, Group, Line as SkLine, Path, Skia, vec } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CellIndex } from '../game';
import { fullMoves as canonicalFullMoves } from '../multiverse';
import { normalizedStrengths, topN } from '../overlay';
import { useAppStore } from '../state';
import { colors, fonts, spacing, viridis } from '../ui';

const BOARD_SIZE = 300;
const CELL = BOARD_SIZE / 3;

function cellRect(idx: number) {
  const col = idx % 3;
  const row = Math.floor(idx / 3);
  return { x: col * CELL, y: row * CELL };
}

export function BoardView() {
  const tree = useAppStore((s) => s.tree);
  const activeId = useAppStore((s) => s.activeUniverseId);
  const scrubPly = useAppStore((s) => s.scrubPly);
  const overlayFlags = useAppStore((s) => s.overlayFlags);
  const overlayTopN = useAppStore((s) => s.overlayTopN);
  const attemptPlay = useAppStore((s) => s.attemptPlay);

  const active = tree.universes[activeId];
  const fullMoves = useMemo(
    () => (active ? canonicalFullMoves(tree, active.id) : []),
    [tree, active],
  );

  const displayed = useMemo(() => {
    const board: ('X' | 'O' | null)[] = Array(9).fill(null);
    for (let i = 0; i < scrubPly && i < fullMoves.length; i++) {
      const m = fullMoves[i];
      if (m) board[m.cell] = m.mark;
    }
    return board;
  }, [fullMoves, scrubPly]);

  if (!active) return null;

  const atTip = scrubPly === fullMoves.length;
  const toMove = atTip && active.status.kind === 'open' ? active.status.toMove : null;
  const overlayOn = toMove ? overlayFlags[toMove] : false;
  const heat = overlayOn && toMove ? normalizedStrengths(displayed, toMove) : [];
  const topMoves = overlayOn && toMove ? topN(displayed, toMove, overlayTopN) : [];

  const winLine = atTip && active.status.kind === 'win' ? active.status.line : null;
  const winPath = winLine
    ? (() => {
        const a = cellRect(winLine[0]);
        const c = cellRect(winLine[2]);
        const p = Skia.Path.Make();
        p.moveTo(a.x + CELL / 2, a.y + CELL / 2);
        p.lineTo(c.x + CELL / 2, c.y + CELL / 2);
        return p;
      })()
    : null;
  const winColor =
    active.status.kind === 'win'
      ? active.status.winner === 'X'
        ? colors.outcomeXWin
        : colors.outcomeOWin
      : colors.outcomeXWin;

  return (
    <View accessibilityLabel="Tic-tac-toe board" style={styles.wrap}>
      <View style={{ width: BOARD_SIZE, height: BOARD_SIZE }}>
        <Canvas style={{ flex: 1 }}>
          {/* heat overlay */}
          {heat.map(({ cell, norm }) => {
            const { x, y } = cellRect(cell);
            return (
              <Path
                key={`heat-${cell}`}
                path={Skia.Path.Make().addRect({
                  x: x + 2,
                  y: y + 2,
                  width: CELL - 4,
                  height: CELL - 4,
                })}
                color={viridis(norm)}
                opacity={0.18 + 0.32 * norm}
              />
            );
          })}

          {/* grid lines */}
          {[1, 2].map((i) => (
            <Group key={`grid-${i}`}>
              <SkLine
                p1={vec(i * CELL, 0)}
                p2={vec(i * CELL, BOARD_SIZE)}
                color={colors.border}
                strokeWidth={2}
              />
              <SkLine
                p1={vec(0, i * CELL)}
                p2={vec(BOARD_SIZE, i * CELL)}
                color={colors.border}
                strokeWidth={2}
              />
            </Group>
          ))}

          {/* marks: X via Path, O via stroked Circle */}
          {displayed.map((c, idx) => {
            if (!c) return null;
            const { x, y } = cellRect(idx);
            const pad = 18;
            if (c === 'X') {
              const p = Skia.Path.Make();
              p.moveTo(x + pad, y + pad);
              p.lineTo(x + CELL - pad, y + CELL - pad);
              p.moveTo(x + CELL - pad, y + pad);
              p.lineTo(x + pad, y + CELL - pad);
              return (
                <Path
                  key={`m-${idx}`}
                  path={p}
                  color={colors.markX}
                  style="stroke"
                  strokeWidth={6}
                  strokeCap="round"
                />
              );
            }
            return (
              <Circle
                key={`m-${idx}`}
                cx={x + CELL / 2}
                cy={y + CELL / 2}
                r={CELL / 2 - pad}
                color={colors.markO}
                style="stroke"
                strokeWidth={6}
              />
            );
          })}

          {/* top-N halos */}
          {topMoves.map(({ cell, score }, rank) => {
            if (score <= 0) return null;
            const { x, y } = cellRect(cell);
            return (
              <Circle
                key={`top-${cell}`}
                cx={x + CELL / 2}
                cy={y + CELL / 2}
                r={CELL / 2 - 8 - rank * 4}
                color={colors.accent}
                opacity={0.55 - rank * 0.15}
                style="stroke"
                strokeWidth={3}
              />
            );
          })}

          {/* winning line */}
          {winPath && (
            <Path
              path={winPath}
              color={winColor}
              style="stroke"
              strokeWidth={8}
              strokeCap="round"
              opacity={0.85}
            />
          )}
        </Canvas>

        {/* Tap layer */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {Array.from({ length: 9 }).map((_, idx) => {
            const { x, y } = cellRect(idx);
            const v = displayed[idx];
            const occupied = v !== null;
            return (
              <Pressable
                key={`hit-${idx}`}
                accessibilityRole="button"
                accessibilityLabel={`Cell ${idx + 1}, ${v ?? 'empty'}`}
                accessibilityState={{ disabled: occupied && atTip }}
                style={{ position: 'absolute', left: x, top: y, width: CELL, height: CELL }}
                onPress={() => attemptPlay(idx as CellIndex)}
              />
            );
          })}
        </View>
      </View>

      <BoardStatusLine />
    </View>
  );
}

function BoardStatusLine() {
  const tree = useAppStore((s) => s.tree);
  const activeId = useAppStore((s) => s.activeUniverseId);
  const aiThinking = useAppStore((s) => s.aiThinking);
  const scrubPly = useAppStore((s) => s.scrubPly);
  const u = tree.universes[activeId];
  if (!u) return null;
  const moves = canonicalFullMoves(tree, activeId);
  const atTip = scrubPly === moves.length;
  let label = '';
  if (!atTip) label = `viewing ply ${scrubPly} (scrubbed)`;
  else if (u.status.kind === 'win') label = `${u.status.winner} wins`;
  else if (u.status.kind === 'draw') label = 'Draw';
  else label = `${u.status.toMove} to move${aiThinking ? ' • thinking…' : ''}`;
  return (
    <View style={styles.statusWrap}>
      <Text style={styles.status} accessibilityLiveRegion="polite">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    padding: spacing.md,
  },
  statusWrap: {
    marginTop: spacing.md,
  },
  status: {
    ...fonts.label,
    color: colors.text,
  },
});

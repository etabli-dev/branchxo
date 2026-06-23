import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { biggestSwingPly } from '../analysis';
import { useAppStore } from '../state';
import { colors, fonts, spacing } from '../ui';

const W = 320;
const H = 160;
const PAD_L = 32;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;

export function ProbabilityChart() {
  const tree = useAppStore((s) => s.tree);
  const activeId = useAppStore((s) => s.activeUniverseId);
  const probMode = useAppStore((s) => s.probMode);
  const active = tree.universes[activeId];

  const history = active?.probHistory ?? [];

  const points = useMemo(() => {
    if (history.length === 0) {
      return { x: [] as number[], pX: [] as number[], pO: [] as number[], pD: [] as number[], plies: [] as number[] };
    }
    const maxPly = Math.max(1, history[history.length - 1]?.ply ?? 1);
    const xs = history.map((p) => PAD_L + ((p.ply / maxPly) * (W - PAD_L - PAD_R)));
    const px = history.map((p) => PAD_T + (1 - p.pX) * (H - PAD_T - PAD_B));
    const po = history.map((p) => PAD_T + (1 - p.pO) * (H - PAD_T - PAD_B));
    const pd = history.map((p) => PAD_T + (1 - p.pDraw) * (H - PAD_T - PAD_B));
    return { x: xs, pX: px, pO: po, pD: pd, plies: history.map((p) => p.ply) };
  }, [history]);

  const swingPly = useMemo(() => biggestSwingPly(history), [history]);

  function buildPath(ys: number[]): ReturnType<typeof Skia.Path.Make> {
    const p = Skia.Path.Make();
    for (let i = 0; i < ys.length; i++) {
      const x = points.x[i] ?? 0;
      const y = ys[i] ?? 0;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    return p;
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Win probability ({probMode === 'perfect' ? 'vs perfect play' : 'vs random play'})</Text>
      <View style={{ width: W, height: H, backgroundColor: colors.panel, borderRadius: 8 }}>
        <Canvas style={{ flex: 1 }}>
          {/* axes */}
          <Group>
            <Path
              path={Skia.Path.Make()
                .moveTo(PAD_L, PAD_T)
                .lineTo(PAD_L, H - PAD_B)
                .lineTo(W - PAD_R, H - PAD_B)}
              color={colors.border}
              style="stroke"
              strokeWidth={1}
            />
          </Group>
          {/* gridline at 0.5 */}
          <Path
            path={Skia.Path.Make()
              .moveTo(PAD_L, PAD_T + (H - PAD_T - PAD_B) / 2)
              .lineTo(W - PAD_R, PAD_T + (H - PAD_T - PAD_B) / 2)}
            color={colors.border}
            style="stroke"
            strokeWidth={0.5}
            opacity={0.6}
          />
          {history.length > 0 && (
            <>
              <Path path={buildPath(points.pX)} color={colors.markX} style="stroke" strokeWidth={2} />
              <Path path={buildPath(points.pO)} color={colors.markO} style="stroke" strokeWidth={2} />
              <Path path={buildPath(points.pD)} color={colors.outcomeDraw} style="stroke" strokeWidth={2} />
              {/* dot for each data point so a 1-point history is still visible */}
              {points.x.map((x, i) => (
                <Circle key={`dot-${i}`} cx={x} cy={points.pX[i] ?? 0} r={2} color={colors.markX} />
              ))}
            </>
          )}
          {swingPly !== null && history.length > 1 && (() => {
            const i = history.findIndex((p) => p.ply === swingPly);
            if (i < 0) return null;
            const cx = points.x[i] ?? 0;
            return (
              <Circle cx={cx} cy={PAD_T + 4} r={4} color={colors.accent} />
            );
          })()}
        </Canvas>
        {/* x-axis labels (DOM text overlay) — subsample to avoid overlap */}
        {points.plies.map((ply, i) => {
          // show every label only when there are <=5 points; otherwise show first, last, and every Nth
          const n = points.plies.length;
          const stride = n <= 5 ? 1 : Math.max(1, Math.ceil((n - 1) / 4));
          const isEdge = i === 0 || i === n - 1;
          if (!isEdge && i % stride !== 0) return null;
          return (
            <Text
              key={`xlbl-${i}`}
              style={[styles.tickLabel, { left: (points.x[i] ?? 0) - 6, top: H - PAD_B + 4 }]}
            >
              {ply}
            </Text>
          );
        })}
        {/* y-axis labels at 0 / 0.5 / 1 */}
        <Text style={[styles.yTick, { top: PAD_T - 7 }]}>1</Text>
        <Text style={[styles.yTick, { top: PAD_T + (H - PAD_T - PAD_B) / 2 - 7 }]}>0.5</Text>
        <Text style={[styles.yTick, { top: H - PAD_B - 7 }]}>0</Text>
      </View>
      <View style={styles.legendRow}>
        <Legend color={colors.markX} label="P(X)" />
        <Legend color={colors.markO} label="P(O)" />
        <Legend color={colors.outcomeDraw} label="P(draw)" />
        {swingPly !== null && <Text style={styles.swing}>turning point: ply {swingPly}</Text>}
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={{ width: 10, height: 10, backgroundColor: color, borderRadius: 5 }} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.md },
  title: { ...fonts.label, color: colors.text, marginBottom: spacing.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { ...fonts.small, color: colors.textDim },
  swing: { ...fonts.small, color: colors.accent },
  tickLabel: {
    position: 'absolute',
    color: colors.textDim,
    fontSize: 10,
  },
  yTick: {
    position: 'absolute',
    left: 6,
    color: colors.textDim,
    fontSize: 10,
  },
});

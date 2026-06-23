import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CellIndex } from '../game';
import { normalizedStrengths } from '../overlay';
import { useAppStore } from '../state';
import { colors, fonts, radii, spacing, viridis } from '../ui';

const SIZE = 280;
const CELL = SIZE / 3;

export function HeatView() {
  const tree = useAppStore((s) => s.tree);
  const activeId = useAppStore((s) => s.activeUniverseId);
  const active = tree.universes[activeId];

  const scores = useMemo(() => {
    if (!active || active.status.kind !== 'open') return [];
    return normalizedStrengths(active.board, active.status.toMove);
  }, [active]);

  if (!active) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Strength heat (active board)</Text>
      <View style={{ width: SIZE, height: SIZE }}>
        <Canvas style={{ flex: 1 }}>
          {/* base cells */}
          {Array.from({ length: 9 }).map((_, idx) => {
            const col = idx % 3;
            const row = Math.floor(idx / 3);
            const x = col * CELL;
            const y = row * CELL;
            const entry = scores.find((s) => (s.cell as CellIndex) === (idx as CellIndex));
            const fill = entry ? viridis(entry.norm) : colors.panel;
            const opacity = entry ? 0.55 + entry.norm * 0.4 : 0.6;
            return (
              <Group key={idx}>
                <Path
                  path={Skia.Path.Make().addRect({ x: x + 2, y: y + 2, width: CELL - 4, height: CELL - 4 })}
                  color={fill}
                  opacity={opacity}
                />
              </Group>
            );
          })}
          {/* grid lines */}
          {[1, 2].map((i) => (
            <Group key={i}>
              <Path
                path={Skia.Path.Make().moveTo(i * CELL, 0).lineTo(i * CELL, SIZE)}
                color={colors.border}
                style="stroke"
                strokeWidth={2}
              />
              <Path
                path={Skia.Path.Make().moveTo(0, i * CELL).lineTo(SIZE, i * CELL)}
                color={colors.border}
                style="stroke"
                strokeWidth={2}
              />
            </Group>
          ))}
        </Canvas>
        {/* score labels */}
        {scores.map((s) => {
          const col = (s.cell as number) % 3;
          const row = Math.floor((s.cell as number) / 3);
          return (
            <Text
              key={`l-${s.cell}`}
              style={[
                styles.scoreLabel,
                {
                  left: col * CELL + 4,
                  top: row * CELL + 4,
                },
              ]}
            >
              {s.score >= 100 ? '★' : s.score >= 90 ? '◆' : ''} {s.score.toFixed(1)}
            </Text>
          );
        })}
      </View>
      <Text style={styles.legend}>
        viridis · darker = weaker · ★ = immediate win · ◆ = immediate block
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.md, alignItems: 'center' },
  title: { ...fonts.label, color: colors.text, marginBottom: spacing.sm },
  scoreLabel: {
    position: 'absolute',
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  legend: { ...fonts.small, color: colors.textDim, marginTop: spacing.sm },
});

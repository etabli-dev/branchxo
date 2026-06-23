import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { hydrate, useAppStore } from './src/state';
import {
  BoardView,
  BranchPromptModal,
  HeaderSummary,
  HeatView,
  MultiverseTree,
  ProbabilityChart,
  SettingsPanel,
  TimelineStrip,
  ViewSwitcher,
} from './src/views';
import { colors, fonts, spacing } from './src/ui';

export default function App() {
  const view = useAppStore((s) => s.view);
  const hydrated = useAppStore((s) => s.hydrated);

  useEffect(() => {
    void hydrate();
  }, []);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
          <StatusBar style="light" />
          <View style={styles.header}>
            <Text style={styles.brand} accessibilityRole="header">branchxo</Text>
            <Text style={styles.sub}>multiverse tic-tac-toe</Text>
          </View>

          <HeaderSummary />

          <View style={styles.switcher}>
            <ViewSwitcher />
          </View>

          <ScrollView
            contentContainerStyle={styles.main}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!hydrated ? (
              <Text style={styles.dim}>loading…</Text>
            ) : (
              <>
                {view === 'board' && (
                  <>
                    <BoardView />
                    <TimelineStrip />
                    <ProbabilityChart />
                  </>
                )}
                {view === 'timeline' && (
                  <>
                    <TimelineStrip />
                    <BoardView />
                  </>
                )}
                {view === 'tree' && <MultiverseTree />}
                {view === 'heat' && <HeatView />}

                <View style={styles.settings}>
                  <Text style={styles.sectionTitle}>Settings</Text>
                  <SettingsPanel />
                </View>
              </>
            )}
          </ScrollView>

          <BranchPromptModal />
        </SafeAreaView>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  brand: { ...fonts.title, color: colors.text },
  sub: { ...fonts.small, color: colors.textDim },
  switcher: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  main: { paddingBottom: spacing.xl },
  dim: { ...fonts.small, color: colors.textDim, padding: spacing.md },
  settings: { paddingTop: spacing.lg },
  sectionTitle: { ...fonts.label, color: colors.text, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
});

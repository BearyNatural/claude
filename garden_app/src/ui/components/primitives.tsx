/**
 * Core UI primitives. Accessibility is built in: every pressable has a role
 * and label, touch targets are at least 48 px tall, text scales with the
 * system font size, and status uses icon + words, not colour alone.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, TOUCH, type, usePalette, type Palette } from '../theme/theme';

export type IconName = keyof typeof Ionicons.glyphMap;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

type Variant = keyof typeof type;

export function T({
  children,
  variant = 'body',
  muted,
  color,
  style,
  center,
  accessibilityRole,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: Variant;
  muted?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  center?: boolean;
  accessibilityRole?: 'header' | 'text';
  numberOfLines?: number;
}) {
  const p = usePalette();
  return (
    <Text
      accessibilityRole={accessibilityRole ?? (variant === 'title' || variant === 'h2' ? 'header' : undefined)}
      numberOfLines={numberOfLines}
      style={[type[variant], { color: color ?? (muted ? p.textMuted : p.text) }, center && { textAlign: 'center' }, style]}
    >
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Scrollable screen body. `safeTop` pads for the status bar on screens without a header. */
/** In a wide browser window, content sits in a centred column instead of stretching edge to edge. */
export const WIDE_CONTENT_MAX = 960;

export function useWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 900;
}

export function Screen({ children, scroll = true, padded = true, safeTop = false }: { children: ReactNode; scroll?: boolean; padded?: boolean; safeTop?: boolean }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const content = (
    <View
      style={[
        padded && { padding: space.lg, gap: space.lg },
        { paddingBottom: space.xxl * 2 },
        safeTop && { paddingTop: insets.top + space.lg },
        wide && { width: '100%', maxWidth: WIDE_CONTENT_MAX, alignSelf: 'center', paddingHorizontal: space.xl },
      ]}
    >
      {children}
    </View>
  );
  if (!scroll) return <View style={{ flex: 1, backgroundColor: p.bg }}>{content}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      {content}
    </ScrollView>
  );
}

export function Row({ children, gap = space.sm, wrap, style, align = 'center' }: { children: ReactNode; gap?: number; wrap?: boolean; style?: StyleProp<ViewStyle>; align?: ViewStyle['alignItems'] }) {
  return <View style={[{ flexDirection: 'row', alignItems: align, gap }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Card({ children, onPress, accessibilityLabel, style, tone }: { children: ReactNode; onPress?: () => void; accessibilityLabel?: string; style?: StyleProp<ViewStyle>; tone?: Tone }) {
  const p = usePalette();
  const bg = tone ? toneColors(p, tone).bg : p.surface;
  const base: StyleProp<ViewStyle> = [styles.card, { backgroundColor: bg, borderColor: p.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <T variant="h2">{title}</T>
          {subtitle ? <T variant="small" muted>{subtitle}</T> : null}
        </View>
        {action}
      </Row>
      {children}
    </View>
  );
}

export function Divider() {
  const p = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border, marginVertical: space.xs }} />;
}

// ---------------------------------------------------------------------------
// Tones, badges, notices
// ---------------------------------------------------------------------------

export type Tone = 'good' | 'caution' | 'danger' | 'info' | 'neutral' | 'earth';

export function toneColors(p: Palette, tone: Tone) {
  switch (tone) {
    case 'good':
      return { fg: p.good, bg: p.goodSoft };
    case 'caution':
      return { fg: p.caution, bg: p.cautionSoft };
    case 'danger':
      return { fg: p.danger, bg: p.dangerSoft };
    case 'info':
      return { fg: p.sky, bg: p.skySoft };
    case 'earth':
      return { fg: p.accent, bg: p.accentSoft };
    default:
      return { fg: p.textMuted, bg: p.neutralSoft };
  }
}

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const p = usePalette();
  const c = toneColors(p, tone);
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]} accessible accessibilityLabel={label}>
      {icon ? <Ionicons name={icon} size={14} color={c.fg} /> : null}
      <Text style={[type.tiny, { color: c.fg, fontWeight: '600' }]}>{label}</Text>
    </View>
  );
}

export function Notice({ tone = 'info', icon, title, children, action }: { tone?: Tone; icon?: IconName; title?: string; children?: ReactNode; action?: ReactNode }) {
  const p = usePalette();
  const c = toneColors(p, tone);
  const defaultIcon: IconName = tone === 'caution' ? 'alert-circle-outline' : tone === 'danger' ? 'warning-outline' : tone === 'good' ? 'checkmark-circle-outline' : 'information-circle-outline';
  return (
    <View style={[styles.notice, { backgroundColor: c.bg }]} accessibilityRole="summary">
      <Ionicons name={icon ?? defaultIcon} size={22} color={c.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[type.h3, { color: c.fg }]}>{title}</Text> : null}
        {typeof children === 'string' ? <Text style={[type.small, { color: p.text }]}>{children}</Text> : children}
        {action}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Buttons & inputs
// ---------------------------------------------------------------------------

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  compact,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const colors = {
    primary: { bg: p.primary, fg: p.onPrimary, border: p.primary },
    secondary: { bg: p.surface, fg: p.primary, border: p.primary },
    ghost: { bg: 'transparent', fg: p.primary, border: 'transparent' },
    danger: { bg: p.dangerSoft, fg: p.danger, border: p.danger },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        compact && { paddingHorizontal: space.md, minHeight: 40 },
        { backgroundColor: colors.bg, borderColor: colors.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.fg} /> : icon ? <Ionicons name={icon} size={18} color={colors.fg} /> : null}
      <Text style={[type.h3, { color: colors.fg, fontSize: compact ? 15 : 16 }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color }: { icon: IconName; label: string; onPress: () => void; color?: string }) {
  const p = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={22} color={color ?? p.primary} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress: () => void; icon?: IconName }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? p.primary : p.border, backgroundColor: selected ? p.primarySoft : p.surface, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      {selected ? <Ionicons name="checkmark" size={16} color={p.primary} /> : icon ? <Ionicons name={icon} size={16} color={p.textMuted} /> : null}
      <Text style={[type.small, { color: selected ? p.primary : p.text, fontWeight: selected ? '600' : '400' }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  keyboardType,
  multiline,
  autoFocus,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  const p = usePalette();
  return (
    <View style={{ gap: space.xs }}>
      <T variant="small" style={{ fontWeight: '600' }}>{label}</T>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        autoFocus={autoFocus}
        accessibilityLabel={label}
        accessibilityHint={hint}
        style={[
          styles.input,
          { borderColor: error ? p.danger : p.border, color: p.text, backgroundColor: p.surface },
          multiline && { minHeight: 96, textAlignVertical: 'top' },
        ]}
      />
      {error ? (
        <Row gap={4}>
          <Ionicons name="alert-circle" size={14} color={p.danger} />
          <T variant="tiny" color={p.danger}>{error}</T>
        </Row>
      ) : hint ? (
        <T variant="tiny" muted>{hint}</T>
      ) : null}
    </View>
  );
}

export function Stepper({ label, value, onChange, min = 0, max = 9999, step = 1, suffix }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const p = usePalette();
  const set = (n: number) => onChange(Math.max(min, Math.min(max, n)));
  return (
    <View style={{ gap: space.xs }}>
      <T variant="small" style={{ fontWeight: '600' }}>{label}</T>
      <Row gap={space.md}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} onPress={() => set(value - step)} style={[styles.stepBtn, { borderColor: p.border, backgroundColor: p.surface }]}>
          <Ionicons name="remove" size={22} color={p.primary} />
        </Pressable>
        <View accessible accessibilityRole="adjustable" accessibilityLabel={`${label}: ${value}${suffix ? ` ${suffix}` : ''}`} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => set(value + (e.nativeEvent.actionName === 'increment' ? step : -step))}>
          <T variant="h2">
            {value}
            {suffix ? <T variant="small" muted>{` ${suffix}`}</T> : null}
          </T>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} onPress={() => set(value + step)} style={[styles.stepBtn, { borderColor: p.border, backgroundColor: p.surface }]}>
          <Ionicons name="add" size={22} color={p.primary} />
        </Pressable>
      </Row>
    </View>
  );
}

export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
  description?: string;
  icon?: IconName;
}

export function Choice<V extends string>({ label, options, value, onChange }: { label?: string; options: ChoiceOption<V>[]; value: V | undefined; onChange: (v: V) => void }) {
  const p = usePalette();
  return (
    <View style={{ gap: space.xs }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {label ? <T variant="small" style={{ fontWeight: '600' }}>{label}</T> : null}
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel, checked: sel }}
            accessibilityLabel={o.description ? `${o.label}. ${o.description}` : o.label}
            style={({ pressed }) => [styles.choice, { borderColor: sel ? p.primary : p.border, backgroundColor: sel ? p.primarySoft : p.surface, opacity: pressed ? 0.85 : 1 }]}
          >
            <Ionicons name={sel ? 'radio-button-on' : 'radio-button-off'} size={20} color={sel ? p.primary : p.textMuted} />
            {o.icon ? <Ionicons name={o.icon} size={20} color={p.textMuted} /> : null}
            <View style={{ flex: 1 }}>
              <T variant="body" style={{ fontWeight: sel ? '600' : '400' }}>{o.label}</T>
              {o.description ? <T variant="small" muted>{o.description}</T> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ListRow({ title, subtitle, icon, imageUri, right, onPress, accessibilityLabel }: { title: string; subtitle?: string; icon?: IconName; /** Shown instead of the icon, e.g. a plant photo. */ imageUri?: string; right?: ReactNode; onPress?: () => void; accessibilityLabel?: string }) {
  const p = usePalette();
  const inner = (
    <Row gap={space.md} style={{ minHeight: TOUCH, paddingVertical: space.sm }}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={[styles.rowIcon, { backgroundColor: p.primarySoft }]} accessibilityIgnoresInvertColors />
      ) : icon ? (
        <View style={[styles.rowIcon, { backgroundColor: p.primarySoft }]}>
          <Ionicons name={icon} size={20} color={p.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T variant="body" style={{ fontWeight: '600' }}>{title}</T>
        {subtitle ? <T variant="small" muted>{subtitle}</T> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={20} color={p.textMuted} /> : null)}
    </Row>
  );
  if (!onPress) return inner;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}. ${subtitle}` : title)} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {inner}
    </Pressable>
  );
}

export function EmptyState({ icon = 'leaf-outline', title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}>
      <Ionicons name={icon} size={40} color={p.primary} />
      <T variant="h3" center>{title}</T>
      {body ? <T variant="small" muted center>{body}</T> : null}
      {action}
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg, gap: space.md }} accessibilityLabel={label}>
      <ActivityIndicator color={p.primary} size="large" />
      <T muted>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  notice: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md },
  button: { minHeight: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  iconButton: { minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { minHeight: TOUCH, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16 },
  stepBtn: { width: TOUCH, height: TOUCH, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, minHeight: TOUCH },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});

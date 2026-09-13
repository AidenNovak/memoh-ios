import { requireNativeView, requireOptionalNativeModule } from 'expo';
import React, { type ComponentType } from 'react';
import { Platform, Text, View, type ViewProps } from 'react-native';

export interface NativeMessageListProps extends ViewProps {
  /** JSON.stringify(RenderTurn[]); the reducer owns ordering and stream assembly. */
  turnsJson: string;
  onReachTop?: () => void;
  emptyTitle?: string;
  emptyBody?: string;
  unavailableLabel?: string;
}

let resolved = false;
let NativeView: ComponentType<NativeMessageListProps> | null = null;

function resolveView() {
  if (resolved) return NativeView;
  resolved = true;
  if (Platform.OS !== 'ios') return null;
  try {
    const module = requireOptionalNativeModule('MemohKit');
    // Expo registers host views lazily: module presence alone cannot prove a view exists.
    const runtime = globalThis as typeof globalThis & {
      expo?: { getViewConfig?: (module: string, view: string) => unknown };
    };
    if (module && runtime.expo?.getViewConfig?.('MemohKit', 'NativeMessageList')) {
      NativeView = requireNativeView('MemohKit', 'NativeMessageList');
    }
  } catch {
    // An older dev client may not contain the native module yet.
  }
  return NativeView;
}

export function NativeMessageList({
  unavailableLabel = 'Native messages unavailable. Rebuild the iOS app.',
  ...props
}: NativeMessageListProps) {
  const Component = resolveView();
  if (Component) return <Component {...props} />;
  // Availability notice only, never a second transcript renderer or Android implementation.
  return (
    <View style={props.style} testID="native-messages-unavailable">
      <Text accessibilityRole="alert">{unavailableLabel}</Text>
    </View>
  );
}

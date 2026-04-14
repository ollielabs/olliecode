/**
 * Theme picker modal component.
 * Displays available themes with live preview as user navigates.
 */

import { Index, createEffect, createSignal } from 'solid-js';
import { Modal } from './modal';
import { useTheme, getThemeList } from '../../design';
import { FocusLayer, useScopedKeyboard } from '../keyboard';

export type ThemePickerProps = {
  onSelect: (themeId: string) => void;
  onCancel: () => void;
};

export function ThemePicker(props: ThemePickerProps) {
  const { themeId: currentThemeId, setTheme, tokens } = useTheme();

  const themes = getThemeList();
  const currentIndex = themes.findIndex((t) => t.id === currentThemeId);
  const [selectedIndex, setSelectedIndex] = createSignal(
    currentIndex >= 0 ? currentIndex : 0,
  );
  const originalThemeId = currentThemeId;

  // Live-preview: apply theme whenever selection changes
  createEffect(() => {
    const theme = themes[selectedIndex()];
    if (theme) {
      setTheme(theme.id);
    }
  });

  const handleCancel = () => {
    setTheme(originalThemeId);
    props.onCancel();
  };

  useScopedKeyboard(FocusLayer.MODAL, (key) => {
    switch (key.name) {
      case 'up':
      case 'k':
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        break;
      case 'down':
      case 'j':
        setSelectedIndex((prev) => Math.min(themes.length - 1, prev + 1));
        break;
      case 'return': {
        const theme = themes[selectedIndex()];
        if (theme) props.onSelect(theme.id);
        break;
      }
      case 'escape':
      case 'q':
        handleCancel();
        break;
    }
  });

  return (
    <Modal title="Select Theme" onClose={handleCancel} size="small">
      <box flexDirection="column">
        <box flexDirection="column" marginBottom={1}>
          <Index each={themes}>
            {(theme, idx) => {
              // All derivations must read signals inline for reactivity
              const isSelected = () => idx === selectedIndex();
              const isCurrent = theme().id === originalThemeId;

              return (
                <box flexDirection="row">
                  <text
                    style={{
                      fg: isSelected()
                        ? tokens.success
                        : isCurrent
                          ? tokens.primaryBase
                          : tokens.textMuted,
                    }}
                  >
                    {isSelected() ? '> ' : '  '}
                    {theme().name}
                    {isCurrent ? ' (current)' : ''}
                  </text>
                </box>
              );
            }}
          </Index>
        </box>

        <box flexDirection="row" gap={2}>
          <text style={{ fg: tokens.textSubtle }}>
            <b>select</b> Enter
          </text>
          <text style={{ fg: tokens.textSubtle }}>
            <b>cancel</b> Esc
          </text>
        </box>
      </box>
    </Modal>
  );
}

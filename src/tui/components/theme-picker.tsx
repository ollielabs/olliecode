/**
 * Theme picker modal component.
 * Displays available themes with live preview as user navigates.
 */

import { useKeyboard } from '@opentui/react';
import { useState, useEffect } from 'react';
import { Modal } from './modal';
import { useTheme, getThemeList } from '../../design';

export type ThemePickerProps = {
  onSelect: (themeId: string) => void;
  onCancel: () => void;
};

export function ThemePicker({ onSelect, onCancel }: ThemePickerProps) {
  const { themeId: currentThemeId, setTheme, tokens } = useTheme();

  const themes = getThemeList();
  const currentIndex = themes.findIndex((t) => t.id === currentThemeId);
  const [selectedIndex, setSelectedIndex] = useState(
    currentIndex >= 0 ? currentIndex : 0,
  );
  const [originalThemeId] = useState(currentThemeId);

  useEffect(() => {
    const theme = themes[selectedIndex];
    if (theme && theme.id !== currentThemeId) {
      setTheme(theme.id);
    }
  }, [selectedIndex, themes, currentThemeId, setTheme]);

  const handleCancel = () => {
    setTheme(originalThemeId);
    onCancel();
  };

  useKeyboard((key: { name?: string }) => {
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
        const theme = themes[selectedIndex];
        if (theme) onSelect(theme.id);
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
          {themes.map((theme, idx) => {
            const isSelected = idx === selectedIndex;
            const isCurrent = theme.id === originalThemeId;
            const prefix = isSelected ? '> ' : '  ';

            const fg = isSelected
              ? tokens.success
              : isCurrent
                ? tokens.primaryBase
                : tokens.textMuted;

            return (
              <box key={theme.id} flexDirection="row">
                <text style={{ fg }}>
                  {prefix}
                  {theme.name}
                  {isCurrent ? ' (current)' : ''}
                </text>
              </box>
            );
          })}
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

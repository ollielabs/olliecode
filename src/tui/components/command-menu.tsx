/**
 * Slash command menu component.
 * Overlays above the textarea when user types '/'.
 */

import type { ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { createEffect, createMemo, Index, mergeProps, Show } from 'solid-js';
import { useTheme } from '../../design';
import { getScrollChildBounds, scrollIntoView } from '../utils';

export type SlashCommand = {
  name: string;
  description: string;
  action: () => void;
};

export type CommandMenuProps = {
  commands: SlashCommand[];
  filter: string;
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onCancel: () => void;
  onIndexChange: (index: number) => void;
  bottom?: number;
  width?: number;
};

export function getFilteredCommands(
  commands: SlashCommand[],
  filter: string,
): SlashCommand[] {
  return commands.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(filter.toLowerCase()),
  );
}

export function CommandMenu(rawProps: CommandMenuProps) {
  const props = mergeProps({ bottom: 0 }, rawProps);
  const { tokens } = useTheme();
  let scrollRef: ScrollBoxRenderable | undefined;

  // Must be a memo so it recomputes when props.filter changes
  const filteredCommands = createMemo(() =>
    getFilteredCommands(props.commands, props.filter),
  );

  createEffect(() => {
    const cmds = filteredCommands();
    if (props.selectedIndex >= cmds.length && cmds.length > 0) {
      props.onIndexChange(cmds.length - 1);
    }
  });

  // Scroll-into-view: only adjust when selected item is outside the viewport
  createEffect(() => {
    const idx = props.selectedIndex;
    if (!scrollRef) return;
    const bounds = getScrollChildBounds(scrollRef, idx);
    if (bounds) scrollIntoView(scrollRef, bounds.top, bounds.bottom);
  });

  useKeyboard((key: { name?: string }) => {
    const cmds = filteredCommands();
    switch (key.name) {
      case 'up':
      case 'k':
        props.onIndexChange(Math.max(0, props.selectedIndex - 1));
        break;
      case 'down':
      case 'j':
        props.onIndexChange(Math.min(cmds.length - 1, props.selectedIndex + 1));
        break;
      case 'return': {
        const selected = cmds[props.selectedIndex];
        if (selected) props.onSelect(selected);
        break;
      }
      case 'escape':
        props.onCancel();
        break;
    }
  });

  return (
    <Show
      when={filteredCommands().length > 0}
      fallback={
        <box
          style={{
            position: 'absolute',
            left: 0,
            bottom: props.bottom,
            width: props.width,
            zIndex: 100,
            backgroundColor: tokens.bgSurface,
            flexDirection: 'column',
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <text style={{ fg: tokens.textSubtle }}>No matching commands</text>
        </box>
      }
    >
      <box
        style={{
          position: 'absolute',
          left: 0,
          bottom: props.bottom,
          width: props.width,
          zIndex: 100,
          backgroundColor: tokens.bgSurface,
          flexDirection: 'column',
          maxHeight: 8,
        }}
      >
        <scrollbox ref={scrollRef} maxHeight={6} stickyScroll={false}>
          <box flexDirection="column">
            <Index each={filteredCommands()}>
              {(cmd, idx) => {
                const isSelected = () => idx === props.selectedIndex;
                return (
                  <box
                    style={{
                      flexDirection: 'row',
                      paddingLeft: 1,
                      paddingRight: 1,
                      backgroundColor: isSelected()
                        ? tokens.selected
                        : 'transparent',
                    }}
                  >
                    <text
                      style={{
                        width: 10,
                        fg: isSelected() ? tokens.primaryBase : tokens.textBase,
                      }}
                    >
                      <b>/{cmd().name}</b>
                    </text>
                    <text style={{ fg: tokens.textSubtle }}>
                      {' '}
                      {cmd().description}
                    </text>
                  </box>
                );
              }}
            </Index>
          </box>
        </scrollbox>
      </box>
    </Show>
  );
}

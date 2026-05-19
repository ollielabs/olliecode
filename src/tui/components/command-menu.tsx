/**
 * Slash command menu component.
 * Overlays above the textarea when user types '/'.
 */

import type { ScrollBoxRenderable } from '@opentui/core';
import { createMemo, Index, mergeProps, Show } from 'solid-js';
import { useTheme } from '../../design';
import { useListNavigation } from '../hooks/use-list-navigation';

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

  const filteredCommands = createMemo(() =>
    getFilteredCommands(props.commands, props.filter),
  );

  useListNavigation({
    itemCount: () => filteredCommands().length,
    selectedIndex: () => props.selectedIndex,
    setSelectedIndex: (i) => props.onIndexChange(i),
    onSelect: (i) => {
      const cmd = filteredCommands()[i];
      if (cmd) props.onSelect(cmd);
    },
    onCancel: () => props.onCancel(),
    getScrollRef: () => scrollRef,
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
            paddingX: 1,
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
                      paddingX: 1,
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

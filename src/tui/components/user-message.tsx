/**
 * User message component.
 * Displays user input with a blue left border.
 */

import { Show } from 'solid-js';
import { useTheme } from '../../design';

export type UserMessageProps = {
  content: string;
  attachedFiles?: string[];
};

export function UserMessage(props: UserMessageProps) {
  const { tokens } = useTheme();

  return (
    <box
      style={{
        backgroundColor: tokens.bgSurface,
        padding: 1,
        border: ['left'],
        borderStyle: 'heavy',
        borderColor: tokens.borderAccent,
      }}
      flexDirection="column"
    >
      <text>{props.content}</text>
      <Show when={props.attachedFiles && props.attachedFiles.length > 0}>
        <box marginTop={1}>
          <text style={{ fg: tokens.textSubtle }}>
            [{props.attachedFiles?.length} file
            {props.attachedFiles?.length !== 1 ? 's' : ''} attached]
          </text>
        </box>
      </Show>
    </box>
  );
}

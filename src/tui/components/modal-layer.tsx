/**
 * ModalLayer — renders all modals and pickers exactly once.
 * Eliminates duplication of modal rendering across welcome/chat screens.
 */

import type { Accessor } from 'solid-js';
import { Show } from 'solid-js';
import type { McpStatusMap } from '../../agent/mcp/types';
import type { McpManager } from '../../agent/mcp/manager';
import type { ConfigLayer } from '../../config/merge';
import type { ResolvedConfig } from '../../config/schema';
import { listSessions } from '../../session';
import type { ContextStats, Session } from '../types';
import { ContextStatsModal } from './context-stats-modal';
import { ConfigModal } from './config-modal';
import { McpStatusModal } from './mcp-status-modal';
import { KeyboardShortcutsModal } from './keyboard-shortcuts-modal';
import { SessionPicker } from './session-picker';
import { ThemePicker } from './theme-picker';

export interface ModalLayerProps {
  // Context stats modal
  showContextStats: Accessor<boolean>;
  contextStats: Accessor<ContextStats | null>;
  modelName: string;
  onContextStatsClose: () => void;

  // Config modal
  showConfigModal: Accessor<boolean>;
  config: ResolvedConfig;
  /** Static: set once at mount, never changes */
  configLayers: ConfigLayer[];
  /** Static: set once at mount, never changes */
  configWarnings: string[];
  onConfigModalClose: () => void;

  // MCP status modal
  showMcpModal: Accessor<boolean>;
  mcpStatus: Accessor<McpStatusMap>;
  mcpManager: McpManager;
  onMcpModalClose: () => void;

  // Keyboard shortcuts modal
  showHelp: Accessor<boolean>;
  onHelpClose: () => void;

  // Session picker
  showSessionPicker: Accessor<boolean>;
  projectPath: string;
  sessionListLimit: number;
  onSessionSelect: (session: Session) => void;
  onSessionPickerCancel: () => void;
  onSessionsChanged: () => void;

  // Theme picker
  showThemePicker: Accessor<boolean>;
  onThemeSelect: (theme: string) => void;
  onThemePickerCancel: () => void;
}

export function ModalLayer(props: ModalLayerProps) {
  return (
    <>
      <Show when={props.showContextStats() && props.contextStats()}>
        {(stats: () => ContextStats) => (
          <ContextStatsModal
            stats={stats()}
            modelName={props.modelName}
            onClose={props.onContextStatsClose}
          />
        )}
      </Show>

      <Show when={props.showConfigModal()}>
        <ConfigModal
          config={props.config}
          layers={props.configLayers}
          warnings={props.configWarnings}
          onClose={props.onConfigModalClose}
        />
      </Show>

      <Show when={props.showMcpModal()}>
        <McpStatusModal
          mcpStatus={props.mcpStatus()}
          manager={props.mcpManager}
          onClose={props.onMcpModalClose}
        />
      </Show>

      <Show when={props.showHelp()}>
        <KeyboardShortcutsModal onClose={props.onHelpClose} />
      </Show>

      <Show when={props.showSessionPicker()}>
        <SessionPicker
          sessions={listSessions({ limit: props.sessionListLimit })}
          projectPath={props.projectPath}
          onSelect={props.onSessionSelect}
          onCancel={props.onSessionPickerCancel}
          onSessionsChanged={props.onSessionsChanged}
        />
      </Show>

      <Show when={props.showThemePicker()}>
        <ThemePicker
          onSelect={props.onThemeSelect}
          onCancel={props.onThemePickerCancel}
        />
      </Show>
    </>
  );
}

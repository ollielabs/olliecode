/**
 * TUI Entry Point.
 * Main application component with all hooks and UI rendering.
 */

import { useRef } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { RGBA } from "@opentui/core";
import { ThemeProvider, useTheme } from "../design";
import { listSessions } from "../session";
import {
  useAgentSubmit,
  useAgentConfirmation,
  useAgentContext,
  useSession,
  useCommandMenu,
  useKeyboardShortcuts,
} from "./hooks";
import {
  ContextStatsModal,
  SessionPicker,
  ThemePicker,
  ContextInfoNotification,
  CommandMenu,
  InputBox,
  ConfirmationDialog,
  SidePanel,
  UserMessage,
  AssistantMessage,
  ToolMessage,
} from "./components";
import { fastScrollAccel } from "./utils";
import type { AppProps, Status } from "./types";

export function App({ initialTheme, model, host, projectPath, initialSessionId }: AppProps) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <AppContent model={model} host={host} projectPath={projectPath} initialSessionId={initialSessionId} />
    </ThemeProvider>
  );
}

function AppContent({ model, host, projectPath, initialSessionId }: Omit<AppProps, "initialTheme">) {
  const { tokens } = useTheme();
  const textareaRef = useRef<TextareaRenderable>(null);
  const statusRef = useRef<Status>("idle");

  // Initialize session hook first as other hooks depend on it
  const session = useSession({
    projectPath,
    model,
    host,
    initialSessionId,
    textareaRef,
  });

  // Confirmation hook for risky operations
  const confirmation = useAgentConfirmation();

  // Context hook for stats, compaction, and related operations
  const context = useAgentContext({
    history: session.history,
    model,
    host,
    setHistory: session.setHistory,
    setDisplayMessages: session.setDisplayMessages,
  });

  // Agent submission hook
  const agent = useAgentSubmit({
    model,
    host,
    ensureSession: session.ensureSession,
    mode: session.mode,
    history: session.history,
    setDisplayMessages: session.setDisplayMessages,
    setHistory: session.setHistory,
    setSidebarTodos: session.setSidebarTodos,
    requestConfirmation: confirmation.requestConfirmation,
  });

  // Keep statusRef in sync
  statusRef.current = agent.status;

  // Command menu hook
  const commands = useCommandMenu({
    textareaRef,
    status: agent.status,
    showSessionPicker: session.showSessionPicker,
    handlers: {
      handleNewSession: session.handleNewSession,
      handleClearContext: context.handleClearContext,
      handleCompact: context.handleCompact,
      handleShowContext: context.handleShowContext,
      handleForget: context.handleForget,
      setShowSessionPicker: session.setShowSessionPicker,
      setShowThemePicker: session.setShowThemePicker,
    },
  });

  // Global keyboard shortcuts
  const { toolsExpanded } = useKeyboardShortcuts({
    status: agent.status,
    mode: session.mode,
    setMode: session.setMode,
    abort: agent.abort,
    showCommandMenu: commands.showCommandMenu,
    showSessionPicker: session.showSessionPicker,
    currentSession: session.currentSession,
  });

  // Render welcome screen if no messages
  if (session.displayMessages.length === 0) {
    return (
      <box
        key="greeting-container"
        style={{ backgroundColor: tokens.bgBase }}
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        {context.showContextStats && context.contextStats && (
          <ContextStatsModal stats={context.contextStats} modelName={model} onClose={context.handleContextStatsClose} />
        )}

        <box flexDirection="row">
          <ascii-font text="Olly" font="tiny" color={RGBA.fromHex(tokens.primaryBase)} />
          <text>{" "}</text>
          <ascii-font text="Code" font="tiny" color={RGBA.fromHex(tokens.textBase)} />
        </box>

        {session.showSessionPicker && (
          <SessionPicker
            key={session.sessionRefreshKey}
            sessions={listSessions({ limit: 50 })}
            projectPath={projectPath}
            onSelect={session.handleSessionSelect}
            onCancel={session.handleSessionPickerCancel}
            onSessionsChanged={session.handleSessionsChanged}
          />
        )}

        {session.showThemePicker && (
          <ThemePicker onSelect={session.handleThemeSelect} onCancel={session.handleThemePickerCancel} />
        )}

        {context.contextInfo && (
          <box marginTop={1}>
            <ContextInfoNotification message={context.contextInfo} />
          </box>
        )}

        <box flexDirection="column" marginTop={2} width={80} position="relative">
          {commands.showCommandMenu && (
            <CommandMenu
              commands={commands.slashCommands}
              filter={commands.commandFilter}
              selectedIndex={commands.commandSelectedIndex}
              onSelect={commands.handleCommandSelect}
              onCancel={commands.handleCommandMenuCancel}
              onIndexChange={commands.handleCommandIndexChange}
              bottom={5}
              width={80}
            />
          )}

          <InputBox
            id="greeting-textarea"
            model={model}
            status={agent.status}
            error={agent.error}
            mode={session.mode}
            textareaRef={textareaRef}
            statusRef={statusRef}
            onSubmit={agent.handleSubmit}
          />
        </box>
      </box>
    );
  }

  // Render chat screen with messages
  return (
    <box
      key="chat-container"
      style={{ backgroundColor: tokens.bgBase }}
      flexDirection="row"
      flexGrow={1}
      flexShrink={1}
    >
      {context.showContextStats && context.contextStats && (
        <ContextStatsModal stats={context.contextStats} modelName={model} onClose={context.handleContextStatsClose} />
      )}

      {session.showSessionPicker && (
        <SessionPicker
          key={session.sessionRefreshKey}
          sessions={listSessions({ limit: 50 })}
          projectPath={projectPath}
          onSelect={session.handleSessionSelect}
          onCancel={session.handleSessionPickerCancel}
          onSessionsChanged={session.handleSessionsChanged}
        />
      )}

      {session.showThemePicker && (
        <ThemePicker onSelect={session.handleThemeSelect} onCancel={session.handleThemePickerCancel} />
      )}

      <box flexDirection="column" flexGrow={1} flexShrink={1} paddingTop={1} paddingLeft={2} paddingRight={2}>
        <scrollbox
          flexGrow={1}
          flexShrink={1}
          stickyScroll={true}
          stickyStart="bottom"
          scrollAcceleration={fastScrollAccel}
        >
          <box flexDirection="column" flexGrow={1} paddingRight={2}>
            {session.displayMessages.map((msg, idx) => (
              <box key={`msg-${idx}`} marginBottom={1}>
                {msg.type === "user" && <UserMessage content={msg.content} />}
                {msg.type === "assistant" && <AssistantMessage content={msg.content} />}
                {msg.type === "tool_call" && (
                  <ToolMessage type="call" name={msg.name} args={msg.args} expanded={toolsExpanded} />
                )}
                {msg.type === "tool_result" && (
                  <ToolMessage type="result" name={msg.name} output={msg.output} error={msg.error} args={msg.args} expanded={toolsExpanded} />
                )}
              </box>
            ))}

            {agent.streamingContent && (
              <box key="streaming">
                <text>{agent.streamingContent}</text>
              </box>
            )}

            {confirmation.pendingConfirmation && (
              <ConfirmationDialog
                request={confirmation.pendingConfirmation}
                onResponse={(response) => {
                  confirmation.handleConfirmationResponse(response);
                  // Abort the agent run if user denies
                  if (response.action === "deny") {
                    agent.abort();
                  }
                }}
              />
            )}
          </box>
        </scrollbox>

        <box flexDirection="column" flexShrink={0} position="relative">
          {context.contextInfo && <ContextInfoNotification message={context.contextInfo} />}

          {commands.showCommandMenu && (
            <CommandMenu
              commands={commands.slashCommands}
              filter={commands.commandFilter}
              selectedIndex={commands.commandSelectedIndex}
              onSelect={commands.handleCommandSelect}
              onCancel={commands.handleCommandMenuCancel}
              onIndexChange={commands.handleCommandIndexChange}
              bottom={5}
            />
          )}

          <InputBox
            id="chat-textarea"
            model={model}
            status={agent.status}
            error={agent.error}
            mode={session.mode}
            textareaRef={textareaRef}
            statusRef={statusRef}
            onSubmit={agent.handleSubmit}
            disabled={!!confirmation.pendingConfirmation}
          />
        </box>
      </box>

      <SidePanel contextStats={context.sidebarStats} todos={session.sidebarTodos} width={40} />
    </box>
  );
}

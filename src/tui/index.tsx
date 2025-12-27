import { RGBA, type TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useRef, useState, useCallback, useEffect } from "react";

import type { Message, ToolCall } from "ollama";

import { markdownStyle } from "../design/styles";
import { runAgent } from "../agent";
import type { ToolResult, AgentStep } from "../agent/types";
import type { ConfirmationRequest, ConfirmationResponse } from "../agent/safety/types";
import type { AgentMode } from "../agent/modes";
import { toggleMode, DEFAULT_MODE } from "../agent/modes";
import { InputBox } from "./components/input-box";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import type { Status } from "./components/status-bar";
import {
  getSession,
  getMessages,
  listSessions,
  createSession,
  addMessage,
  updateSession,
  toOllamaMessages,
  toDisplayMessages,
  fromUserInput,
  fromAssistantResponse,
  type Session,
} from "../session";
import { SessionPicker } from "./components/session-picker";
import { CommandMenu, getFilteredCommands, type SlashCommand } from "./components/command-menu";

// Display message - can be user, assistant, or tool activity
type DisplayMessage =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string; error?: string };

type AppProps = {
  model: string;
  host: string;
  projectPath: string;
  initialSessionId?: string;
};

export function App({ model, host, projectPath, initialSessionId }: AppProps) {
  const renderer = useRenderer();
  const textareaRef = useRef<TextareaRenderable>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastEscapeRef = useRef<number>(0);

  // Session state
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);

  // Agent conversation history (for context)
  const [history, setHistory] = useState<Message[]>([]);
  
  // Display messages (what the user sees)
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  
  // Mode state (plan or build)
  const [mode, setMode] = useState<AgentMode>(DEFAULT_MODE);
  
  // Confirmation state
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null);
  const confirmationResolverRef = useRef<((response: ConfirmationResponse) => void) | null>(null);

  // Session picker state
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);

  // Command menu state
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandFilter, setCommandFilter] = useState("");
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);

  // Refs to avoid stale closures in async handlers
  const statusRef = useRef(status);
  statusRef.current = status;
  
  const historyRef = useRef(history);
  historyRef.current = history;
  
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Keep session ref in sync
  sessionRef.current = currentSession;

  // Load initial session if provided
  useEffect(() => {
    if (initialSessionId) {
      const session = getSession(initialSessionId);
      if (session) {
        setCurrentSession(session);
        setMode(session.mode);
        
        // Load messages and convert to display format
        const storedMessages = getMessages(session.id);
        const ollamaMessages = toOllamaMessages(storedMessages);
        const displayMsgs = toDisplayMessages(storedMessages);
        
        setHistory(ollamaMessages);
        setDisplayMessages(displayMsgs);
      }
    }
  }, [initialSessionId]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "k") {
      renderer.toggleDebugOverlay();
      renderer.console.toggle();
    }

    // Tab to toggle mode (only when idle and not in command menu)
    if (key.name === "tab" && status === "idle" && !showCommandMenu && !showSessionPicker) {
      const newMode = toggleMode(modeRef.current);
      setMode(newMode);
      
      // Persist mode change if session exists
      if (sessionRef.current) {
        updateSession(sessionRef.current.id, { mode: newMode });
      }
    }

    // Double-escape to abort
    if (key.name === "escape" && status === "thinking") {
      const now = Date.now();
      if (now - lastEscapeRef.current < 500) {
        abortControllerRef.current?.abort();
        lastEscapeRef.current = 0;
      } else {
        lastEscapeRef.current = now;
      }
    }

    // Use setTimeout to read text after textarea has processed the keypress
    setTimeout(() => {
      // Guard against accessing destroyed textarea (e.g., on app exit)
      if (!textareaRef.current || textareaRef.current.isDestroyed) return;
      
      const currentText = textareaRef.current.plainText ?? "";
      
      if (status === "idle" && !showSessionPicker) {
        if (currentText.startsWith("/")) {
          const newFilter = currentText.slice(1);
          if (!showCommandMenu) {
            // Open menu when / is typed
            setShowCommandMenu(true);
          }
          setCommandFilter(newFilter);
        } else if (showCommandMenu) {
          // Close menu if / is deleted
          setShowCommandMenu(false);
          setCommandFilter("");
          setCommandSelectedIndex(0);
        }
      }
    }, 0);
  });

  const handleSubmit = async (prompt: string) => {
    setStatus("thinking");
    setError("");
    setStreamingContent("");

    // Create session on first message if none exists
    let session = sessionRef.current;
    if (!session) {
      session = await createSession({
        projectPath,
        model,
        host,
        mode: modeRef.current,
      });
      setCurrentSession(session);
    }

    // Persist user message
    addMessage(session.id, "user", fromUserInput(prompt));

    // Add user message to display
    setDisplayMessages((prev) => [...prev, { type: "user", content: prompt }]);

    abortControllerRef.current = new AbortController();

    const result = await runAgent({
      model,
      host,
      userMessage: prompt,
      history: historyRef.current,
      mode: modeRef.current,
      signal: abortControllerRef.current.signal,

      onReasoningToken: (token) => {
        setStreamingContent((prev) => prev + token);
      },

      onToolCall: (call: ToolCall) => {
        // Show tool call in UI
        setDisplayMessages((prev) => [
          ...prev,
          {
            type: "tool_call",
            name: call.function.name,
            args: call.function.arguments,
          },
        ]);
      },

      onToolResult: (result: ToolResult) => {
        // Show tool result in UI
        setDisplayMessages((prev) => [
          ...prev,
          {
            type: "tool_result",
            name: result.tool,
            output: result.output,
            error: result.error,
          },
        ]);
      },

      onStepComplete: (_step: AgentStep) => {
        // Clear streaming content after each step
        setStreamingContent("");
      },
      
      onConfirmationNeeded: (request: ConfirmationRequest): Promise<ConfirmationResponse> => {
        return new Promise((resolve) => {
          confirmationResolverRef.current = resolve;
          setPendingConfirmation(request);
        });
      },
      
      onToolBlocked: (tool: string, reason: string) => {
        // Show blocked tool in UI
        setDisplayMessages((prev) => [
          ...prev,
          {
            type: "tool_result",
            name: tool,
            output: "",
            error: `Blocked: ${reason}`,
          },
        ]);
      },
    });

    // Handle result
    if ("type" in result) {
      // It's an AgentError
      switch (result.type) {
        case "aborted":
          setStatus("idle");
          if (streamingContent.trim()) {
            setDisplayMessages((prev) => [
              ...prev,
              { type: "assistant", content: streamingContent + "\n\n[interrupted]" },
            ]);
          }
          break;
        case "model_error":
          setStatus("error");
          setError(result.message);
          break;
        case "max_iterations":
          setStatus("error");
          setError(`Max iterations (${result.iterations}) reached. Last thought: ${result.lastThought.slice(0, 100)}...`);
          break;
        case "loop_detected":
          setStatus("error");
          setError(`Loop detected: ${result.action} called ${result.attempts} times`);
          break;
        case "tool_error":
          // This shouldn't happen as tool errors are fed back as observations
          setStatus("error");
          setError(`Tool error (${result.tool}): ${result.message}`);
          break;
      }
    } else {
      // It's an AgentResult
      setDisplayMessages((prev) => [
        ...prev,
        { type: "assistant", content: result.finalAnswer },
      ]);
      setHistory(result.messages);
      setStatus("idle");

      // Persist assistant response with tool calls/results
      if (session) {
        // Collect tool calls and results from the last step
        const lastStep = result.steps[result.steps.length - 1];
        const toolCalls = lastStep?.actions.map((tc) => ({
          name: tc.function.name,
          args: tc.function.arguments as Record<string, unknown>,
        }));
        const toolResults = lastStep?.observations.map((obs) => ({
          name: obs.tool,
          output: obs.output,
          error: obs.error,
        }));

        addMessage(
          session.id,
          "assistant",
          fromAssistantResponse(result.finalAnswer, toolCalls, toolResults)
        );
      }
    }

    setStreamingContent("");
  };
  
  // Handle confirmation response
  const handleConfirmationResponse = useCallback((response: ConfirmationResponse) => {
    if (confirmationResolverRef.current) {
      confirmationResolverRef.current(response);
      confirmationResolverRef.current = null;
    }
    setPendingConfirmation(null);
  }, []);

  // Handle /new command - start fresh session
  const handleNewSession = useCallback(() => {
    setCurrentSession(null);
    setHistory([]);
    setDisplayMessages([]);
    setMode(DEFAULT_MODE);
    setError("");
    setStreamingContent("");
  }, []);

  // Handle session selection from picker
  const handleSessionSelect = useCallback((session: Session) => {
    setShowSessionPicker(false);
    setCurrentSession(session);
    setMode(session.mode);

    // Load messages and convert to display format
    const storedMessages = getMessages(session.id);
    const ollamaMessages = toOllamaMessages(storedMessages);
    const displayMsgs = toDisplayMessages(storedMessages);

    setHistory(ollamaMessages);
    setDisplayMessages(displayMsgs);

    // Refocus textarea after modal closes
    setTimeout(() => textareaRef.current?.focus(), 10);
  }, []);

  // Handle session picker cancel
  const handleSessionPickerCancel = useCallback(() => {
    setShowSessionPicker(false);
    // Refocus textarea after modal closes
    setTimeout(() => textareaRef.current?.focus(), 10);
  }, []);

  // Handle session list change (delete/rename)
  const handleSessionsChanged = useCallback(() => {
    setSessionRefreshKey((prev) => prev + 1);
  }, []);

  // Define available slash commands
  const slashCommands: SlashCommand[] = [
    {
      name: "new",
      description: "Start a new session",
      action: () => {
        handleNewSession();
        textareaRef.current?.setText("");
      },
    },
    {
      name: "session",
      description: "Switch to a different session",
      action: () => {
        setShowSessionPicker(true);
        textareaRef.current?.setText("");
      },
    },
  ];

  // Handle command selection from menu
  const handleCommandSelect = useCallback((command: SlashCommand) => {
    setShowCommandMenu(false);
    setCommandFilter("");
    command.action();
  }, []);

  // Handle command menu cancel
  const handleCommandMenuCancel = useCallback(() => {
    setShowCommandMenu(false);
    setCommandFilter("");
    setCommandSelectedIndex(0);
  }, []);

  // Handle command index change
  const handleCommandIndexChange = useCallback((index: number) => {
    setCommandSelectedIndex(index);
  }, []);

  // Welcome screen
  if (displayMessages.length === 0) {
    return (
      <box key="greeting-container" flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
        <box flexDirection="row">
          <ascii-font text="Olly" font="tiny" color={RGBA.fromHex("#7aa2f7")} />
          <text>{' '}</text>
          <ascii-font text="Code" font="tiny" color={RGBA.fromHex("#ffffff")} />
        </box>
        
        {showSessionPicker && (
          <SessionPicker
            key={sessionRefreshKey}
            sessions={listSessions({ limit: 50 })}
            projectPath={projectPath}
            onSelect={handleSessionSelect}
            onCancel={handleSessionPickerCancel}
            onSessionsChanged={handleSessionsChanged}
          />
        )}
        
        {/* Input container - command menu overlays above textarea */}
        <box flexDirection="column" marginTop={2} width={60} position="relative">
          {showCommandMenu && (
            <CommandMenu
              commands={slashCommands}
              filter={commandFilter}
              selectedIndex={commandSelectedIndex}
              onSelect={handleCommandSelect}
              onCancel={handleCommandMenuCancel}
              onIndexChange={handleCommandIndexChange}
              bottom={5}
              width={60}
            />
          )}
          
          <InputBox
            id="greeting-textarea"
            model={model}
            status={status}
            error={error}
            mode={mode}
            textareaRef={textareaRef}
            statusRef={statusRef}
            onSubmit={handleSubmit}
          />
        </box>
      </box>
    );
  }

  // Chat screen
  return (
    <box key="chat-container" flexDirection="column" flexGrow={1} flexShrink={1} paddingTop={1} paddingLeft={2} paddingRight={2}>
      <scrollbox flexGrow={1} flexShrink={1} stickyScroll={true} stickyStart="bottom">
        <box flexDirection="column" flexGrow={1}>
          <box>
            <text>Olly • Enter to send • Ctrl+C to quit{"\n"}</text>
          </box>

          {displayMessages.map((msg, idx) => (
            <box key={`msg-${idx}`} marginBottom={1}>
              {msg.type === "user" && (
                <box backgroundColor="#333" padding={1} border={["left"]} borderStyle="heavy" borderColor="#23bc38">
                  <text>{msg.content}</text>
                </box>
              )}
              {msg.type === "assistant" && (
                <box flexDirection="column">
                  <code selectable={true} content={msg.content} filetype="markdown" syntaxStyle={markdownStyle} drawUnstyledText={true} />
                </box>
              )}
              {msg.type === "tool_call" && (
                <box backgroundColor="#1a1a2e" padding={1} border={["left"]} borderStyle="heavy" borderColor="#f39c12">
                  <text fg="#f39c12">⚡ {msg.name}</text>
                  <text fg="#888"> {JSON.stringify(msg.args)}</text>
                </box>
              )}
              {msg.type === "tool_result" && (
                <box backgroundColor="#1a1a2e" padding={1} border={["left"]} borderStyle="heavy" borderColor={msg.error ? "#e74c3c" : "#27ae60"}>
                  {msg.error ? (
                    <text fg="#e74c3c">✗ {msg.name}: {msg.error}</text>
                  ) : (
                    <text fg="#27ae60">✓ {msg.name}: {msg.output.length > 100 ? msg.output.slice(0, 100) + "..." : msg.output}</text>
                  )}
                </box>
              )}
            </box>
          ))}

          {streamingContent && (
            <box key="streaming">
              <text>{streamingContent}</text>
            </box>
          )}
          
          {pendingConfirmation && (
            <ConfirmationDialog
              request={pendingConfirmation}
              onResponse={handleConfirmationResponse}
            />
          )}
        </box>
      </scrollbox>

      <box flexDirection="column" flexShrink={0} position="relative">
        {showCommandMenu && (
          <CommandMenu
            commands={slashCommands}
            filter={commandFilter}
            selectedIndex={commandSelectedIndex}
            onSelect={handleCommandSelect}
            onCancel={handleCommandMenuCancel}
            onIndexChange={handleCommandIndexChange}
            bottom={5}
          />
        )}
        
        {showSessionPicker && (
          <SessionPicker
            key={sessionRefreshKey}
            sessions={listSessions({ limit: 50 })}
            projectPath={projectPath}
            onSelect={handleSessionSelect}
            onCancel={handleSessionPickerCancel}
            onSessionsChanged={handleSessionsChanged}
          />
        )}
        
        <InputBox
          id="chat-textarea"
          model={model}
          status={status}
          error={error}
          mode={mode}
          textareaRef={textareaRef}
          statusRef={statusRef}
          onSubmit={handleSubmit}
        />
      </box>
    </box>
  );
}

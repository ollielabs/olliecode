/**
 * Hook for session management.
 * Handles session CRUD, mode, history, display messages, and todos.
 */

import { createEffect, createSignal, type Setter } from 'solid-js';
import type { TuiConfig } from '../../config/resolve';
import type { ResolvedConfig } from '../../config/schema';
import {
  createSession,
  getMessages,
  getSession,
  listSessions,
  toDisplayMessages,
  toOllamaMessages,
} from '../../session';
import { getTodos } from '../../session/todo';
import { FOCUS_DELAY_MS, SESSION_LIST_LIMIT } from '../constants';
import type {
  AgentMode,
  DisplayMessage,
  Message,
  Session,
  TextareaRef,
  Todo,
} from '../types';

export type UseSessionProps = {
  /** Project path for session creation */
  projectPath: string;
  /** Resolved config (config.host is authoritative, includes OLLAMA_HOST) */
  config: ResolvedConfig;
  /** Initial session ID to load */
  initialSessionId?: string;
  /** Getter for textarea ref */
  getTextareaRef: () => TextareaRef;
  /** TUI config for session list limit */
  tuiConfig?: TuiConfig;
};

export type UseSessionReturn = {
  /** Current session or null */
  currentSession: () => Session | null;
  /** Set current session */
  setCurrentSession: Setter<Session | null>;
  /** Message history for Ollama */
  history: () => Message[];
  /** Set history */
  setHistory: Setter<Message[]>;
  /** Display messages for UI */
  displayMessages: () => DisplayMessage[];
  /** Set display messages */
  setDisplayMessages: Setter<DisplayMessage[]>;
  /** Current agent mode */
  mode: () => AgentMode;
  /** Set mode */
  setMode: Setter<AgentMode>;
  /** Todos for sidebar */
  sidebarTodos: () => Todo[];
  /** Set sidebar todos */
  setSidebarTodos: Setter<Todo[]>;
  /** Whether session picker is visible */
  showSessionPicker: () => boolean;
  /** Set session picker visibility */
  setShowSessionPicker: Setter<boolean>;
  /** Key for forcing session picker refresh */
  sessionRefreshKey: () => number;
  /** Whether theme picker is visible */
  showThemePicker: () => boolean;
  /** Set theme picker visibility */
  setShowThemePicker: Setter<boolean>;
  /** List available sessions */
  listAvailableSessions: () => Session[];
  /** Create a new session */
  handleNewSession: () => void;
  /** Select a session */
  handleSessionSelect: (session: Session) => void;
  /** Cancel session picker */
  handleSessionPickerCancel: () => void;
  /** Notify sessions changed */
  handleSessionsChanged: () => void;
  /** Handle theme selection */
  handleThemeSelect: (themeId: string) => void;
  /** Cancel theme picker */
  handleThemePickerCancel: () => void;
  /** Create session if needed and return it */
  ensureSession: () => Promise<Session>;
};

export function useSession(props: UseSessionProps): UseSessionReturn {
  const model = props.config.model;
  const host = props.config.host;
  const sessionListLimit =
    props.tuiConfig?.sessionListLimit ?? SESSION_LIST_LIMIT;
  const defaultMode = props.config.agent.defaultMode;

  const [currentSession, setCurrentSession] = createSignal<Session | null>(
    null,
  );
  const [history, setHistory] = createSignal<Message[]>([]);
  const [displayMessages, setDisplayMessages] = createSignal<DisplayMessage[]>(
    [],
  );
  const [mode, setMode] = createSignal<AgentMode>(defaultMode);
  const [sidebarTodos, setSidebarTodos] = createSignal<Todo[]>([]);
  const [showSessionPicker, setShowSessionPicker] = createSignal(false);
  const [sessionRefreshKey, setSessionRefreshKey] = createSignal(0);
  const [showThemePicker, setShowThemePicker] = createSignal(false);

  // Load initial session
  createEffect(() => {
    const id = props.initialSessionId;
    if (id) {
      const session = getSession(id);
      if (session) {
        setCurrentSession(session);
        setMode(session.mode);
        const storedMessages = getMessages(session.id);
        const ollamaMessages = toOllamaMessages(storedMessages);
        const displayMsgs = toDisplayMessages(storedMessages);
        setHistory(ollamaMessages);
        setDisplayMessages(displayMsgs);
      }
    }
  });

  // Load todos when session changes
  createEffect(() => {
    const session = currentSession();
    if (session) {
      setSidebarTodos(getTodos(session.id));
    } else {
      setSidebarTodos([]);
    }
  });

  const listAvailableSessions = () => {
    return listSessions({ limit: sessionListLimit });
  };

  const handleNewSession = () => {
    setCurrentSession(null);
    setHistory([]);
    setDisplayMessages([]);
    setMode(defaultMode);
  };

  const handleSessionSelect = (session: Session) => {
    setShowSessionPicker(false);
    setCurrentSession(session);
    setMode(session.mode);
    const storedMessages = getMessages(session.id);
    setHistory(toOllamaMessages(storedMessages));
    setDisplayMessages(toDisplayMessages(storedMessages));
    setTimeout(() => props.getTextareaRef()?.focus(), FOCUS_DELAY_MS);
  };

  const handleSessionPickerCancel = () => {
    setShowSessionPicker(false);
    setTimeout(() => props.getTextareaRef()?.focus(), FOCUS_DELAY_MS);
  };

  const handleSessionsChanged = () => {
    setSessionRefreshKey((prev) => prev + 1);
  };

  const handleThemeSelect = (themeId: string) => {
    setShowThemePicker(false);
    // Persist theme selection to config
    void import('../../config').then(({ setConfigValue }) => {
      setConfigValue(['tui', 'theme'], themeId);
    });
    setTimeout(() => props.getTextareaRef()?.focus(), FOCUS_DELAY_MS);
  };

  const handleThemePickerCancel = () => {
    setShowThemePicker(false);
    setTimeout(() => props.getTextareaRef()?.focus(), FOCUS_DELAY_MS);
  };

  const ensureSession = async (): Promise<Session> => {
    const existing = currentSession();
    if (existing) {
      return existing;
    }
    const session = await createSession({
      projectPath: props.projectPath,
      model,
      host,
      mode: mode(),
    });
    setCurrentSession(session);
    return session;
  };

  return {
    currentSession,
    setCurrentSession,
    history,
    setHistory,
    displayMessages,
    setDisplayMessages,
    mode,
    setMode,
    sidebarTodos,
    setSidebarTodos,
    showSessionPicker,
    setShowSessionPicker,
    sessionRefreshKey,
    showThemePicker,
    setShowThemePicker,
    listAvailableSessions,
    handleNewSession,
    handleSessionSelect,
    handleSessionPickerCancel,
    handleSessionsChanged,
    handleThemeSelect,
    handleThemePickerCancel,
    ensureSession,
  };
}

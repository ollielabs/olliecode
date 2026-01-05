import { Ollama } from 'ollama';
import type { Message } from 'ollama';
import { getSystemPrompt } from '../agent/system-prompt';

// Re-export Message type for consumers
export type { Message };

function getSystemMessage(): Message {
  return {
    role: 'system',
    content: getSystemPrompt(),
  };
}

export type StreamOllamaChatArgs = {
  model: string;
  host: string;
  messages: Message[];
  onToken: (token: string) => void;
  onDone: () => void;
  onAbort: () => void;
  onError: (msg: string) => void;
  signal: AbortSignal;
};

export async function streamOllamaChat(args: StreamOllamaChatArgs) {
  // Create a new client per request so we can abort independently
  const client = new Ollama({
    host: args.host,
    headers: {
      Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
    },
  });

  // Wire up abort signal to client.abort()
  const abortHandler = () => client.abort();
  args.signal.addEventListener('abort', abortHandler);

  try {
    const response = await client.chat({
      model: args.model,
      messages: [getSystemMessage(), ...args.messages],
      stream: true,
      options: {
        temperature: 0.2,
      },
    });

    for await (const chunk of response) {
      const token = chunk.message?.content;
      if (token) {
        args.onToken(token);
      }

      if (chunk.done) {
        break;
      }
    }

    args.onDone();
  } catch (e) {
    // AbortError is thrown when client.abort() is called
    if (e instanceof Error && e.name === 'AbortError') {
      args.onAbort();
      return;
    }

    // Also check if signal was aborted (belt and suspenders)
    if (args.signal.aborted) {
      args.onAbort();
      return;
    }

    const message = e instanceof Error ? e.message : String(e);
    args.onError(`Ollama error: ${message}`);
  } finally {
    args.signal.removeEventListener('abort', abortHandler);
  }
}

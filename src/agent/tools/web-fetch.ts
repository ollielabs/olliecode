/**
 * Web Fetch Tool - Fetches URL content and converts to a readable format.
 *
 * Supports three output formats:
 * - markdown (default): HTML → Markdown via TurndownService
 * - text: HTML → plain text via Bun's HTMLRewriter
 * - html: raw HTML passthrough
 *
 * Content negotiation: sends Accept: text/markdown when markdown format
 * is requested — some doc sites serve markdown natively.
 */

import TurndownService from 'turndown';
import { z } from 'zod';
import type { ToolContext, ToolDefinition } from '../types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

const OUTPUT_FORMATS = ['markdown', 'text', 'html'] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const ACCEPT_HEADERS: Record<OutputFormat, string> = {
  markdown:
    'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
  text: 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1',
  html: 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1',
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

const HONEST_USER_AGENT = 'ollie';

/** HTML elements stripped before markdown/text conversion */
const STRIPPED_ELEMENTS = [
  'script',
  'style',
  'meta',
  'link',
  'nav',
  'footer',
  'header',
  'noscript',
  'iframe',
  'object',
  'embed',
] as const;

// ============================================================================
// Schemas
// ============================================================================

const inputSchema = z.object({
  url: z.string().describe('The URL to fetch content from'),
  format: z
    .enum(OUTPUT_FORMATS)
    .optional()
    .default('markdown')
    .describe('Output format: "markdown" (default), "text", or "html"'),
  timeout: z
    .number()
    .optional()
    .describe('Timeout in seconds (default 30, max 120)'),
});

const outputSchema = z
  .string()
  .describe('The fetched content in the requested format');

// ============================================================================
// HTML Conversion
// ============================================================================

function convertHTMLToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });

  turndown.remove(STRIPPED_ELEMENTS as unknown as string[]);

  return turndown.turndown(html);
}

/** Block-level elements that should have whitespace separation in text output */
const BLOCK_ELEMENTS = new Set([
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'tr',
  'br',
  'blockquote',
  'pre',
  'section',
  'article',
  'aside',
  'main',
  'dt',
  'dd',
]);

async function extractTextFromHTML(html: string): Promise<string> {
  let text = '';
  let skipContent = false;

  const skipTags = new Set(STRIPPED_ELEMENTS);

  const rewriter = new HTMLRewriter()
    .on(STRIPPED_ELEMENTS.join(', '), {
      element() {
        skipContent = true;
      },
      text() {
        // Discard text inside stripped elements
      },
    })
    .on('*', {
      element(element) {
        if (
          !skipTags.has(element.tagName as (typeof STRIPPED_ELEMENTS)[number])
        ) {
          skipContent = false;
          // Add newline before block elements for readable spacing
          if (BLOCK_ELEMENTS.has(element.tagName) && text.length > 0) {
            text += '\n';
          }
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text;
        }
      },
    })
    .transform(new Response(html));

  await rewriter.text();

  // Collapse runs of whitespace into single newlines for readability
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================================
// Fetch Logic
// ============================================================================

/**
 * Perform the HTTP fetch with content negotiation, timeout, and Cloudflare retry.
 */
async function fetchURL(
  url: string,
  format: OutputFormat,
  timeoutMs: number,
  signal?: AbortSignal,
  maxResponseSize: number = DEFAULT_MAX_RESPONSE_SIZE,
): Promise<{ content: string; contentType: string }> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: ACCEPT_HEADERS[format],
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const controller = new AbortController();

  // Combine external abort signal with our timeout
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    let response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    // Cloudflare bot detection: retry with honest UA
    if (
      response.status === 403 &&
      response.headers.get('cf-mitigated') === 'challenge'
    ) {
      response = await fetch(url, {
        headers: { ...headers, 'User-Agent': HONEST_USER_AGENT },
        signal: controller.signal,
        redirect: 'follow',
      });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${response.statusText} for ${url}`,
      );
    }

    // Check content-length header before downloading body
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number.parseInt(contentLength, 10) > maxResponseSize) {
      throw new Error(
        `Response too large: ${contentLength} bytes exceeds ${maxResponseSize} byte limit`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxResponseSize) {
      throw new Error(
        `Response too large: ${arrayBuffer.byteLength} bytes exceeds ${maxResponseSize} byte limit`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    const content = new TextDecoder().decode(arrayBuffer);

    return { content, contentType };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Format Routing
// ============================================================================

async function formatContent(
  content: string,
  contentType: string,
  format: OutputFormat,
): Promise<string> {
  const isHTML = contentType.includes('text/html');

  // html format: always return raw
  if (format === 'html') {
    return content;
  }

  // If the response isn't HTML, return as-is (could be markdown, plain text, JSON, etc.)
  if (!isHTML) {
    return content;
  }

  // HTML content — convert to requested format
  if (format === 'text') {
    return extractTextFromHTML(content);
  }

  // markdown (default)
  return convertHTMLToMarkdown(content);
}

// ============================================================================
// Tool Definition
// ============================================================================

export const webFetchTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: 'web_fetch',
  description: `Fetch content from a URL and return it in a readable format.

Use this tool to retrieve web content for documentation lookup, API references, or external resources.

Parameters:
- url: The URL to fetch (required, must start with http:// or https://)
- format: Output format — "markdown" (default), "text", or "html"
- timeout: Request timeout in seconds (optional, default 30, max 120)

Format details:
- markdown: Converts HTML to clean Markdown. Best for documentation, articles, and web pages. Preserves headings, code blocks, links, and lists.
- text: Extracts plain text from HTML. Strips all markup. Use when you only need raw text content.
- html: Returns raw HTML. Use when you need to inspect the page structure.

Content negotiation: When markdown format is requested, the Accept header prefers text/markdown — some documentation sites serve markdown directly, avoiding lossy conversion.

Notes:
- Maximum response size is 5MB
- Non-HTML responses (JSON, plain text, markdown) are returned as-is regardless of format
- Images and binary content are not supported`,

  parameters: inputSchema,
  outputSchema,
  risk: 'safe',

  execute: async (
    params: { url: string; format?: OutputFormat; timeout?: number },
    signal?: AbortSignal,
    context?: ToolContext,
  ) => {
    const { url, format = 'markdown' } = params;

    // Validate URL scheme
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return `Error: URL must start with http:// or https:// — received: ${url}`;
    }

    // Resolve timeout from params → config → default
    const configTimeout =
      context?.toolsConfig?.web_fetch.timeout ?? DEFAULT_TIMEOUT_MS;
    const timeoutMs = params.timeout
      ? Math.min(params.timeout * 1000, MAX_TIMEOUT_MS)
      : configTimeout;

    const maxResponseSize =
      context?.toolsConfig?.web_fetch.maxResponseSize ??
      DEFAULT_MAX_RESPONSE_SIZE;

    try {
      const { content, contentType } = await fetchURL(
        url,
        format,
        timeoutMs,
        signal,
        maxResponseSize,
      );

      const formatted = await formatContent(content, contentType, format);

      return `<web_fetch url="${url}" format="${format}" content_type="${contentType}">\n${formatted}\n</web_fetch>`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('abort')) {
        return `Error: Request timed out after ${Math.round(timeoutMs / 1000)}s for ${url}`;
      }

      return `Error fetching ${url}: ${message}`;
    }
  },
};

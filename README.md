# Ollie Code

Agentic coding tool powered by Ollama - local, private, and fast.

Ollie is an AI-powered coding assistant that runs entirely through Ollama. Run models locally on your machine for complete privacy, or use Ollama Cloud for access to larger models without the hardware requirements.

## Features

- **Ollama Powered** - Works with any Ollama model, local or cloud
- **Privacy First** - Run locally and your code never leaves your machine
- **Agentic Workflows** - Ollie can read, write, and edit files autonomously
- **Multiple Modes** - Plan, Build, and Explore modes for different tasks
- **Tool Use** - File operations, grep, glob, command execution, and more
- **Session Management** - Persistent conversation history across sessions
- **Beautiful TUI** - Modern terminal interface with syntax highlighting
- **Themeable** - Multiple built-in themes (Ollie, Catppuccin, Dracula, Nord, Tokyo Night, Monokai)

## Requirements

- [Bun](https://bun.sh) >= 1.0.0
- [Ollama](https://ollama.ai) running locally (or Ollama Cloud account)

## Installation

### Homebrew (macOS)

```bash
brew tap ollielabs/tap
brew install ollie
```

### npm

```bash
# Install globally with bun
bun add -g olliecode

# Or with npm
npm install -g olliecode
```

### From Source

```bash
git clone https://github.com/ollielabs/olliecode.git
cd olliecode
bun install
bun dev
```

### Binary Download

Download pre-built binaries from the [releases page](https://github.com/ollielabs/olliecode/releases).

## Recommended Models

Ollie works with any Ollama-compatible model. Here are some recommendations based on your setup.

### Ollama Cloud Models

Access powerful models without local hardware requirements via [Ollama Cloud](https://ollama.com/search?c=cloud):

| Model | Best For | Notes |
|-------|----------|-------|
| `gpt-oss` | Reasoning, agentic tasks | OpenAI's open-weight models (20B/120B) |
| `gemini-3-pro-preview` | Complex reasoning | Google's most intelligent model |
| `gemini-3-flash-preview` | Fast, cost-effective | Frontier intelligence built for speed |
| `deepseek-v3.2` | Reasoning, agent performance | High computational efficiency |
| `deepseek-v3.1` | Thinking mode support | Hybrid thinking/non-thinking |
| `kimi-k2` | Coding agent tasks | State-of-the-art MoE model |
| `kimi-k2-thinking` | Deep reasoning | Moonshot AI's best thinking model |
| `qwen3-coder` | Agentic coding | Long context, 30B/480B variants |
| `qwen3-next` | Efficiency, speed | Strong tool use and thinking |
| `devstral-2` | Code exploration, editing | 123B, excellent for agents |
| `devstral-small-2` | Code exploration | 24B, vision + tools |
| `mistral-large-3` | Enterprise workloads | General-purpose multimodal MoE |
| `glm-4.7` | Coding | Advanced coding capability |
| `glm-4.6` | Agentic, reasoning | Strong all-rounder |
| `minimax-m2.1` | Multilingual, code | Exceptional multilingual |
| `minimax-m2` | Coding, agentic | High-efficiency |
| `cogito-2.1` | General purpose | 671B, MIT licensed |

### Local Coding Specialists

Models specifically trained for code generation and understanding:

| Model | Parameters | VRAM | Best For |
|-------|------------|------|----------|
| `qwen3-coder` | 30B | ~18GB | Best local coding model |
| `devstral-small-2` | 24B | ~16GB | Excellent for code tasks |
| `deepseek-coder-v2` | 16B | ~10GB | Strong code completion |
| `codellama` | 34B | ~20GB | Meta's code-focused model |
| `starcoder2` | 15B | ~10GB | Multi-language support |

### Local General Purpose (with Tool Use)

These models support function calling, essential for Ollie's agentic features:

| Model | Parameters | VRAM | Notes |
|-------|------------|------|-------|
| `qwen3` | 32B | ~20GB | Excellent tool use support |
| `qwen3` | 14B | ~9GB | Good balance of speed/quality |
| `llama3.3` | 70B | ~42GB | Best open model, needs high VRAM |
| `llama4-scout` | 17B | ~11GB | Meta's latest, efficient |
| `mistral-small` | 22B | ~14GB | Good tool use, reasonable size |
| `command-r` | 35B | ~22GB | Cohere's tool-focused model |
| `gemma3` | 27B | ~17GB | Vision support, runs on single GPU |

### Lightweight Models

For machines with limited resources (8GB RAM or less):

| Model | Parameters | VRAM | Notes |
|-------|------------|------|-------|
| `qwen3` | 8B | ~5GB | Best lightweight option |
| `qwen3` | 4B | ~3GB | Very fast, basic tasks |
| `llama3.2` | 3B | ~2GB | Minimal footprint |
| `phi-4` | 3.8B | ~3GB | Microsoft's efficient model |
| `gemma3` | 4B | ~3GB | Google's compact model |
| `ministral-3` | 3B | ~2GB | Edge deployment ready |

### Quick Start with Models

```bash
# Pull a recommended model
ollama pull qwen3:14b

# Or for coding-specific tasks
ollama pull qwen3-coder:30b

# For limited hardware
ollama pull qwen3:8b
```

## Usage

### Starting Ollie

```bash
# Start with default model
ollie

# Start with a specific model
ollie --model qwen3:14b

# Resume a previous session
ollie --session <session-id>

# Start in a specific mode
ollie --mode plan
```

### Modes

Ollie has three operational modes:

- **Build** (default) - For implementing features and writing code
- **Plan** - For designing and planning before implementation
- **Explore** - For understanding and navigating codebases

Switch modes with `/mode <mode>` or use keyboard shortcuts.

### File Mentions

Reference files directly in your prompts using `@`:

```
@src/index.ts what does this file do?
@package.json update the version
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+P` | Open command menu |
| `Ctrl+N` | New session |
| `Ctrl+L` | Clear screen |
| `Ctrl+C` | Cancel/Exit |
| `Esc` | Close modals |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/mode <mode>` | Switch mode (plan, build, explore) |
| `/model <name>` | Switch model |
| `/session` | Session management |
| `/theme <name>` | Change theme |
| `/clear` | Clear conversation |
| `/compact` | Compact conversation history |

## Configuration

### Environment Variables

```bash
# Ollama host (default: http://localhost:11434)
OLLAMA_HOST=http://localhost:11434

# Default model
OLLIE_MODEL=qwen3:14b

# Default mode
OLLIE_MODE=build
```

### CLI Options

```
Usage: ollie [options]

Options:
  -m, --model <model>     Model to use
  -s, --session <id>      Resume session
  --mode <mode>           Starting mode (plan, build, explore)
  -v, --version           Show version
  -h, --help              Show help
```

### Config Directory

Ollie stores configuration in `~/.config/ollie/` and session data in `~/.local/share/ollie/`.

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun dev

# Build binary
bun run build

# Format code
bun run format:fix

# Lint
bun run lint:fix

# Type check
bun run check:types
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

Built with:
- [Ollama](https://ollama.ai) - Local LLM runtime
- [OpenTUI](https://github.com/open-tui/opentui) - Terminal UI framework
- [Bun](https://bun.sh) - JavaScript runtime

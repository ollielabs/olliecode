/**
 * Test raw Ollama API to see what the model actually returns
 */

const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file at the given path",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path to read" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function", 
    function: {
      name: "list_dir",
      description: "List files and directories at the given path",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The directory path to list" }
        },
        required: ["path"]
      }
    }
  }
];

async function main() {
  const response = await fetch("http://192.168.1.221:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5-coder:7b",
      messages: [
        { role: "user", content: "List the files in /tmp" }
      ],
      tools,
      stream: false
    })
  });

  const data = await response.json();
  console.log("=== RAW RESPONSE ===");
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);

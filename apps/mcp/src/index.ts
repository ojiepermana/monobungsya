import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { tools } from "./tools/index";
import { errorToolResponse } from "./utils/toolResponse";

const server = new Server(
  { name: "monobungsia-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.inputSchema) as Tool["inputSchema"],
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  const parsed = tool.inputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid arguments for ${name}: ${issues}`,
    );
  }

  try {
    return await tool.execute(parsed.data);
  } catch (error) {
    return errorToolResponse(
      error instanceof Error ? error.message : String(error),
    );
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries MCP protocol traffic; all logging goes to stderr.
  console.error(`monobungsia-mcp ready on stdio with ${tools.length} tool(s)`);
}

main().catch((error) => {
  console.error("monobungsia-mcp failed to start:", error);
  process.exit(1);
});

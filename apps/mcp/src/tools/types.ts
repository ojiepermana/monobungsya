import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

export interface ToolDefinition<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: Schema;
  execute(args: z.infer<Schema>): Promise<CallToolResult>;
}

export function defineTool<Schema extends z.ZodType>(
  tool: ToolDefinition<Schema>,
): ToolDefinition<Schema> {
  return tool;
}

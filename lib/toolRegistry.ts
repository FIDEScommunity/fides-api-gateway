/**
 * In-memory tool registry for the homepage chat endpoint (Phase 2).
 *
 * The MCP server (Phase 1) registers its tools by calling `registerAllTools()`
 * with an `mcp-handler` server. Here we implement the *same* minimal
 * `ToolServer` contract with a collector that records every tool, so the chat
 * endpoint reuses the exact catalog tool definitions — no duplication. The only
 * extra step the LLM needs is a JSON-Schema view of each tool's zod shape for
 * function calling, produced here once at registry-build time.
 *
 * See docs/MCP-IMPLEMENTATION-PLAN.md → section 4 (Phase 2).
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolResult, ToolServer } from "./catalogClient";
import { registerAllTools } from "./catalogTools";

export interface RegisteredTool {
  name: string;
  description: string;
  /** JSON-Schema for the tool parameters, suitable for LLM function calling. */
  parameters: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
  ) => ToolResult | Promise<ToolResult>;
}

export interface ToolRegistry {
  list(): RegisteredTool[];
  get(name: string): RegisteredTool | undefined;
  /** Execute a tool by name with already-parsed arguments. */
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

// Cast `z.object` to a shallow signature. The real overload infers the literal
// shape, which makes `tsc` instantiate types so deeply it runs out of memory
// (the same TS2589 issue documented in catalogClient.ts).
const makeObject = z.object as unknown as (
  shape: Record<string, z.ZodTypeAny>,
) => z.ZodTypeAny;

// `zodToJsonSchema` is also generic over the schema type; inferring it against
// our wide object schema re-triggers the deep instantiation, so call it through
// a loose signature too.
const toJson = zodToJsonSchema as unknown as (
  schema: unknown,
  options?: unknown,
) => Record<string, unknown>;

function toJsonSchema(
  shape: Record<string, z.ZodTypeAny>,
): Record<string, unknown> {
  // Wrap the raw zod shape into an object schema, then inline all refs so the
  // result is a single self-contained JSON-Schema object the LLM can consume.
  const schema = toJson(makeObject(shape), {
    $refStrategy: "none",
    target: "jsonSchema7",
  });
  // LLM function-calling parameters must not carry a `$schema` meta key.
  delete schema.$schema;
  return schema;
}

/** Build the chat tool registry by replaying the shared tool registration. */
export function buildToolRegistry(): ToolRegistry {
  const tools = new Map<string, RegisteredTool>();

  const collector: ToolServer = {
    // Annotations are MCP-client hints; the chat function-calling layer does not
    // need them, so we accept and ignore the 4th argument.
    tool: (name, description, paramsSchema, _annotations, cb) => {
      tools.set(name, {
        name,
        description,
        parameters: toJsonSchema(paramsSchema),
        handler: cb,
      });
    },
  };

  registerAllTools(collector);

  return {
    list: () => Array.from(tools.values()),
    get: (name) => tools.get(name),
    call: async (name, args) => {
      const tool = tools.get(name);
      if (!tool) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Unknown tool: ${name}` }),
            },
          ],
          isError: true,
        };
      }
      return tool.handler(args ?? {});
    },
  };
}

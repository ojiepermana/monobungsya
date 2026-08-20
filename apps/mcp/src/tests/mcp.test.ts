import { describe, expect, it } from "bun:test";

interface ServerMessage {
  id?: number;
  result?: {
    content?: Array<{ text?: string }>;
    isError?: boolean;
    serverInfo?: { name?: string };
    tools?: Array<{
      name?: string;
      description?: string;
      inputSchema?: { required?: string[] };
    }>;
  };
  error?: { code?: number };
}

async function runMcp(
  messages: unknown[],
  environment: Record<string, string>,
): Promise<{ messages: ServerMessage[]; stderr: string; exitCode: number }> {
  const child = Bun.spawn(["bun", "run", "apps/mcp/src/index.ts"], {
    env: { ...Bun.env, ...environment },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  child.stdin.write(
    `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
  );
  child.stdin.end();

  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const exitCode = await child.exited;

  return {
    messages: stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ServerMessage),
    stderr,
    exitCode,
  };
}

function request(id: number, name: string, argumentsValue: object) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: argumentsValue },
  };
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "bun-test", version: "1.0.0" },
  },
};

const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };

describe("MCP server", () => {
  it("lists check_stock and returns formatted ERP data over STDIO (AC-1, AC-2, AC-3, AC-8)", async () => {
    const requests: Array<{ authorization: string | null; url: string }> = [];
    const erp = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push({
          authorization: request.headers.get("authorization"),
          url: request.url,
        });
        return Response.json({
          sku: new URL(request.url).searchParams.get("sku"),
          quantity: 7,
        });
      },
    });

    try {
      const result = await runMcp(
        [
          initialize,
          initialized,
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          request(3, "check_stock", { sku: "A/B C" }),
        ],
        { ERP_URL: `http://127.0.0.1:${erp.port}`, ERP_TOKEN: "test-token" },
      );
      const list = result.messages.find((message) => message.id === 2)?.result;
      const call = result.messages.find((message) => message.id === 3)?.result;

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("ready on stdio");
      expect(result.messages[0]?.result?.serverInfo?.name).toBe(
        "monobungsia-mcp",
      );
      expect(list?.tools).toEqual([
        {
          name: "check_stock",
          description: "Check inventory stock by SKU from ERP",
          inputSchema: expect.objectContaining({
            type: "object",
            required: ["sku"],
          }),
        },
      ]);
      expect(call?.content?.[0]?.text).toBe(
        JSON.stringify({ sku: "A/B C", quantity: 7 }, null, 2),
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toContain("/api/v1/stock?sku=A%2FB%20C");
      expect(requests[0]?.authorization).toBe("Bearer test-token");
    } finally {
      erp.stop();
    }
  });

  it("rejects invalid arguments and unknown tools without calling ERP (AC-4, AC-5)", async () => {
    let requestCount = 0;
    const erp = Bun.serve({
      port: 0,
      fetch() {
        requestCount += 1;
        return Response.json({ quantity: 7 });
      },
    });

    try {
      const result = await runMcp(
        [
          initialize,
          initialized,
          request(2, "check_stock", { sku: "" }),
          request(3, "missing_tool", {}),
        ],
        { ERP_URL: `http://127.0.0.1:${erp.port}`, ERP_TOKEN: "test-token" },
      );

      expect(
        result.messages.find((message) => message.id === 2)?.error?.code,
      ).toBe(-32602);
      expect(
        result.messages.find((message) => message.id === 3)?.error?.code,
      ).toBe(-32601);
      expect(requestCount).toBe(0);
    } finally {
      erp.stop();
    }
  });

  it("returns ERP failures as tool errors and continues serving (AC-7)", async () => {
    const erp = Bun.serve({
      port: 0,
      fetch(request) {
        const sku = new URL(request.url).searchParams.get("sku");
        return sku === "FAIL"
          ? new Response("ERP unavailable", { status: 503 })
          : Response.json({ sku, quantity: 3 });
      },
    });

    try {
      const result = await runMcp(
        [
          initialize,
          initialized,
          request(2, "check_stock", { sku: "FAIL" }),
          request(3, "check_stock", { sku: "RECOVERED" }),
        ],
        { ERP_URL: `http://127.0.0.1:${erp.port}`, ERP_TOKEN: "test-token" },
      );
      const failedCall = result.messages.find(
        (message) => message.id === 2,
      )?.result;
      const recoveredCall = result.messages.find(
        (message) => message.id === 3,
      )?.result;

      expect(failedCall?.isError).toBe(true);
      expect(failedCall?.content?.[0]?.text).toContain("503");
      expect(recoveredCall?.isError).not.toBe(true);
      expect(recoveredCall?.content?.[0]?.text).toContain("RECOVERED");
    } finally {
      erp.stop();
    }
  });

  it("fails startup when a required environment variable is empty (AC-6)", async () => {
    const result = await runMcp([], {
      ERP_URL: "http://127.0.0.1:3000",
      ERP_TOKEN: "",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ERP_TOKEN");
  });
});

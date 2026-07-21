import type { FastifyInstance, FastifyReply } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { currentMcpUser } from "../http";
import { createLanternMcpServer } from "../mcp/server";

function methodNotAllowed(reply: FastifyReply) {
  return reply.status(405).send({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
}

export function registerMcpRoutes(app: FastifyInstance) {
  app.post("/mcp", async (request, reply) => {
    const user = await currentMcpUser(request);
    const server = createLanternMcpServer(user.id);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
      reply.raw.once("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      request.log.error({ err: error }, "MCP request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }));
      }
      await transport.close();
      await server.close();
    }
  });

  app.get("/mcp", async (request, reply) => {
    await currentMcpUser(request);
    return methodNotAllowed(reply);
  });

  app.delete("/mcp", async (request, reply) => {
    await currentMcpUser(request);
    return methodNotAllowed(reply);
  });
}

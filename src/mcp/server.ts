#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerReadTools } from './tools/reads.js';
import { registerWriteTools } from './tools/writes-registration.js';

const server = new McpServer({
  name: 'canopytag',
  version: '0.1.0',
});

registerReadTools(server);
registerWriteTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

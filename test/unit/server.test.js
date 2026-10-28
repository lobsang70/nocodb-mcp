const { spawnSync } = require("node:child_process");

test("the stdio MCP server advertises update_column with its schema", () => {
  const script = `
    import assert from 'node:assert/strict';
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
    const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js'],
      env: { ...process.env, NOCODB_API_TOKEN: 'test-token', NOCODB_BASE_URL: 'https://nocodb.invalid' },
      stderr: 'pipe',
    });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'update_column');
      assert.ok(tool);
      assert.deepEqual(tool.inputSchema.required, ['column_id', 'updates']);
      assert.equal(tool.inputSchema.properties.updates.additionalProperties, false);
    } finally {
      await client.close();
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
}, 15000);

// SPDX-License-Identifier: AGPL-3.0-or-later
// The MCP server Claude Code starts for one question (stdio). It serves only Aurelia's tools, for one
// workspace folder, as the person who asked: their own Cloudflare Access token goes to the store with
// every request, so the store checks it as it checks the app's.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { WebDavStore } from '@/storage/remote/webdav-store'
import { SERVER_NAME, TOOLS, type ToolContext, type ToolResult } from './tools.ts'
import { checkFolder, readWorkspace, type Workspace } from './workspace.ts'

/** The store, reached from inside the container network, as the person whose token this is. */
export const storeAs = (base: string, token: string) =>
  new WebDavStore(base, (url, init) =>
    fetch(url, {
      method: init?.method,
      headers: { ...(init?.headers as Record<string, string>), 'Cf-Access-Jwt-Assertion': token },
      body: init?.body,
      redirect: 'manual',
    }),
  )

/** An MCP server over these tools. The workspace is read once, at the first tool call. */
export function createMcpServer(
  load: () => Promise<Omit<ToolContext, 'ws'> & { ws: () => Promise<Workspace> }>,
) {
  const server = new McpServer({ name: SERVER_NAME, version: '0.1.0' })
  let ctx: Promise<ToolContext> | undefined
  const context = () =>
    (ctx ??= load().then(async ({ ws, ...rest }) => ({ ...rest, ws: await ws() })))
  for (const [name, tool] of Object.entries(TOOLS))
    server.registerTool(name, { description: tool.description, inputSchema: tool.input }, (async (
      args: never,
    ) => {
      let r: ToolResult
      try {
        r = await (tool.run as (c: ToolContext, a: unknown) => ToolResult | Promise<ToolResult>)(
          await context(),
          args,
        )
      } catch (e) {
        r = {
          label: 'A tool failed',
          data: e instanceof Error ? e.message : 'Unknown error',
          error: true,
        }
      }
      // The first part is the line the author sees in the activity log; the second is for the model.
      return {
        content: [
          { type: 'text' as const, text: r.label },
          { type: 'text' as const, text: r.data },
        ],
        ...(r.error ? { isError: true } : {}),
      }
    }) as never)
  return server
}

if (import.meta.main) {
  const {
    AURELIA_STORE_URL: base = '',
    AURELIA_FOLDER: folder = '',
    AURELIA_ACCESS_JWT: token = '',
  } = process.env
  const store = storeAs(base, token)
  const server = createMcpServer(async () => {
    const checked = checkFolder(folder)
    return { store, folder: checked, ws: () => readWorkspace(store, checked) }
  })
  await server.connect(new StdioServerTransport())
}

# ADR-0008 — AI assistant: use your own Claude or ChatGPT account

- Status: proposed (owner, 2026-11-12: "connect a Claude or ChatGPT account (user side)
  so the user can get an agent helping"). Supersedes the AI part of PLANS M10.
- Facts checked on 2026-11-12. Provider rules change often: re-check before M8 starts.

## Goal

An author can get help from an AI agent that reads their story and proposes changes,
paid for by **the author's own** Claude or ChatGPT account. No Aurelia account, no
Aurelia-paid AI, no Aurelia server in the middle.

## Facts that shape the design

1. **Claude.** Claude subscription sign-in (Free, Pro, Max) is "designed to support
   ordinary use of Claude Code and other native Anthropic applications". Developers of
   other products must use **API keys**. So Aurelia must **not** offer "Sign in with
   Claude" or reuse a Claude subscription token.
   Source: https://code.claude.com/docs/en/legal-and-compliance
2. **Claude apps can connect to other tools through MCP.** Claude Desktop runs local MCP
   servers and desktop extensions (`.mcpb`); claude.ai custom connectors need a public
   HTTPS server. So a Claude subscriber can use Aurelia **from inside Claude**, on their
   own plan, within the rules. Source: https://support.claude.com/en/articles/11175166
3. **ChatGPT.** "Sign in with ChatGPT" lets ChatGPT Plus and Pro users spend their plan
   in other apps. "ChatGPT plan usage is available to all open-source partners", with
   OAuth for Responses API requests and **no client secret**. The open-source flow
   **requires an HTTP loopback callback on `127.0.0.1`**, so it needs a local process —
   a pure browser app cannot do it. The button must follow OpenAI's brand guidelines.
   Sources: https://developers.openai.com/siwc/quickstart ,
   https://developers.openai.com/siwc/token-sharing-open-source/sign-in
4. ChatGPT can only reach **remote** MCP servers, and full write support is limited to
   Business / Enterprise / Edu. So "use Aurelia from ChatGPT" is not a v1 path.

### Verified contract of the ChatGPT open-source flow

Source: https://developers.openai.com/siwc/token-sharing-open-source (checked
2026-11-12; labelled **preview**).

- Requests must set `store: false` and `stream: true`.
- `{role:"system"}` items are rejected; use `instructions`.
- `temperature`, `max_output_tokens`, `previous_response_id`, hosted tools and
  `tool_search` are unsupported.
- Persist a stable opaque `ext_agent_host_id` (a JWK thumbprint) and the per-account
  issued `client_id`.
- Validate the ID token against OpenAI's JWKS and check the `chatgpt.tokens.use.direct`
  scope.
- Refresh tokens rotate: store the new one every time.
- A usage-limit error (`subscription_sharing_usage_limit_exceeded`) can arrive
  **mid-stream**.
- The UI must show a first-sign-in "You're using your ChatGPT plan" notice, a "Using
  ChatGPT plan" indicator and a "Manage usage" link, and use OpenAI's approved button
  formats.

## Decision

### Three ways to connect, one assistant

| Way | Who it is for | Where it works | Paid by |
|---|---|---|---|
| **Use Aurelia from Claude** (MCP) | Claude Pro / Max users | Desktop app (built in), or `npx @aurelia/mcp` (also with a browser workspace, but only a **real-folder** workspace) | Their Claude plan |
| **Continue with ChatGPT** (in-app) | ChatGPT Plus / Pro users | Desktop app only (loopback sign-in) | Their ChatGPT plan |
| **API key** (in-app) | Anyone; also local models (Ollama, LM Studio) | Desktop and browser | Their API account, or free for local models |

### One tool registry, two front doors

`src/assistant/tools.ts` defines every tool once. The MCP server and the in-app agent
both expose this same list, so Claude-via-MCP and the in-app agent can do exactly the
same things.

- **Read tools:** `search`, `get_outline`, `get_scene`, `get_record`, `get_links`,
  `state_at(record, scene)`, `get_findings` (continuity), `get_story_graph`.
- **Propose tools:** `propose_edit(scene, diff)`, `propose_record(…)`,
  `propose_change(scene, change)`, `propose_comment(…)`, `propose_choice(…)`.
- **No direct writes, no deletes, no network tools.** Every proposal lands in the
  **Review inbox** (`.aurelia/proposals/`, one JSON file each). The author accepts,
  edits or rejects it. Accepting is an ordinary, undoable edit with a snapshot first.

### Proposals are anchored

- A proposal stores `baseHash` (the scene's content hash when it was made) and the
  **block IDs** it targets.
- **Accept is a per-block 3-way merge.** It is refused ("text changed — ask again") when
  an anchored block is gone or has changed.
- Proposals are shown as **diffs with the inserted text highlighted**. There is **no
  "accept all"**.
- Snapshot-before-accept stays.

### One provider adapter shape for all three paths

The Claude (API key), ChatGPT and OpenAI-compatible paths share one adapter shape:

- **Stateless**: the app carries the history; no provider-side conversation state.
- **Function tools only** (the registry above); no hosted tools.
- **Stream-first**.
- Only `response.completed` (or the provider's equivalent) counts as success. A stream
  that dies, or ends in a usage-limit error, produces **no proposal**.

### Privacy and trust

- **Scope first.** The in-app panel has a scope picker (selection, scene, chapter, book,
  universe). Before the first message in a scope, it shows **what will be sent and to
  whom**. The MCP server only serves the workspace folder the author chose.
- **Treat story text as untrusted.** Imported research can contain instructions aimed at
  an AI. In the **in-app path** the tools can only read and propose, so an injected
  instruction can at worst create a proposal the author sees and rejects.
- **Honest limit in the MCP path.** Claude Desktop has other tools (web, other
  connectors) that Aurelia does not control. An instruction planted in research text
  could make Claude misuse **those** tools. Aurelia cannot prevent that. It reduces the
  risk: every tool result is wrapped as untrusted data (a preamble saying so, and no
  instruction-shaped formatting). For sensitive work, we recommend a Claude project
  **without web tools**. The M8 injection test covers both the in-app path and the MCP
  path.
- **Secrets never touch project files.** Desktop: ChatGPT tokens and API keys in the OS
  keychain. Browser: API keys in IndexedDB, labelled "stored on this device", wrapped
  with a **non-extractable WebCrypto key** so a dump of IndexedDB alone is not enough
  (it does not stop code running in the same page). The author can remove them at any
  time. Nothing in logs.
- **Visible activity.** The panel lists each tool call ("Read 6.3 The Customs House").
  With an API key, it shows the cost of the conversation so far.

### The MCP server runs the same code

- The plain-TS layers (`domain`, `index`, continuity) run **unchanged in Node**. A CI
  test runs them there.
- The server **rebuilds its index on start**. Budget: a 150k-word book indexes in under
  5 seconds.
- Every input to findings lives in the folder (for example `dismissedFindings` in
  `book.json`, [ADR-0006](0006-continuity-model.md)), so the server and the app agree.
- The browser + `npx @aurelia/mcp` path only works for real-folder workspaces.

### Desktop app becomes a first-class target

The loopback sign-in (ChatGPT) and the built-in MCP server (Claude) both need a local
process. A **Tauri 2** desktop app (the same Vue app in a native shell) gives that, and
also fixes R1 (real folders in every browser engine) and R2 (no CORS for WebDAV/S3).
The browser PWA stays as the zero-install option. When the desktop app first ships
(v0.1 or before M8) is an **open owner decision** in `PLANS.md`; it exists before M8
either way. Desktop builds are direct, notarised downloads (ADR-0005).

## Consequences

- PLANS: the Tauri adapter lands in M2 or before M8 (open decision); a new milestone
  **M8 · Assistant** (release **v0.5**).
- Apply as an open-source client for Sign in with ChatGPT and follow its UI guidelines;
  use OpenAI's official "Continue with ChatGPT" button artwork, never a home-made logo.
  No Claude or OpenAI logos anywhere else (ADR-0005).
- Publish `@aurelia/mcp` (npm) and a Claude Desktop extension (`.mcpb`).
- Model choice is the provider's: we send no model name we have not tested, and the
  settings show which model answered.

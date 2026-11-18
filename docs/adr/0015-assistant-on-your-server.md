# ADR-0015 — The assistant on your own server, with your own Claude account

- Status: accepted (owner, 2026-11-18: "Add the Claude Agent SDK there", "I want to use my Claude
  subscription, not the API", "I am not sharing my license. I want each user to setup their own claude
  account", "I want claude to be able to read the work, evaluate, suggest changes, fixes, potentially help
  generate the story", "suggestions had a visual wrapper with actions (accept, reject, ask for changes)").
- Amends [ADR-0008](0008-ai-assistant.md). Every safety rule of ADR-0008 stays.
- Facts checked on 2026-11-18. Provider rules change often: check them again before a release.

## Facts that shape the design

1. **A Claude plan can run Claude Code and the Agent SDK.** "Update June 15, 2026: … Claude Agent SDK,
   `claude -p`, and third-party app usage still draw from your subscription limits."
   Source: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
2. **Another app must not take a Claude login.** "Anthropic does not permit third-party developers to offer
   Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan
   credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate
   Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's
   own flow." The same page allows "an end user … signing in to the unmodified Claude Code binary with their
   own Claude subscription, including where a platform hosts Claude Code". Plan limits "assume ordinary,
   individual usage of Claude Code and the Agent SDK". Source: https://code.claude.com/docs/en/legal-and-compliance
3. **Running Claude Code in a product has conditions** (same page): the binary is not modified; none of its
   sign-in methods is removed, disabled or restricted; each end user signs in with their own credentials;
   and, unless agreed otherwise, the product's maker accepts Anthropic's Commercial Terms of Service.
4. **The Agent SDK is not open source.** Its licence is "© Anthropic PBC. All rights reserved". Aurelia is
   AGPL and allows only open-source dependencies (ADR-0005). So Aurelia does not use the SDK. It runs the
   Claude Code program (`claude`) as a separate process, and the program is never in Aurelia's images.
5. **Claude Code signs in without a browser on the machine.** `claude auth login` prints a link and asks
   "Paste code here if prompted"; it writes the sign-in to `.credentials.json` in its configuration folder
   (`CLAUDE_CONFIG_DIR`). `claude auth status` exits 0 when signed in and 1 when not; `claude auth logout`
   signs out. Sources: https://code.claude.com/docs/en/cli-reference, https://code.claude.com/docs/en/authentication.
   Checked on 2026-11-18 with Claude Code 2.1.295 in the real `aurelia-agent` image (Alpine, read-only root,
   user 568, no TTY).

## Decision

### One more container, `aurelia-agent`

`server/agent` is a small Node 24 server (TypeScript run directly, like `aurelia-store`). nginx sends
`/agent/` to it, on the app's own address. It checks the Cloudflare Access login with the store's own code
(`server/store/src/auth.ts`, which now returns the token's claims). It needs no settings beyond the store's
two values.

**Claude Code is installed, not shipped.** On start, the container runs Anthropic's documented installer
(`curl -fsSL https://claude.ai/install.sh | bash -s <version>`) into its data volume, pinned to the version
the image names (`CLAUDE_CODE_VERSION`). Updates are off; a new Aurelia image raises the pin. The licence
check covers the server's own dependencies (all open source) and says why Claude Code is not among them.

### Each person signs in with their own Claude account

- People are told apart by the `email` claim of their Cloudflare Access token. Each person has their own
  folder in the volume, named by a hash of the email, with their own `HOME` and `CLAUDE_CONFIG_DIR`.
- **Claude Code on this server** (the Assistant tab) runs Claude Code's own `claude auth login` (or
  `--console` for an Anthropic Console account) for that person: "Start Claude Code sign-in". Aurelia
  offers no Claude login of its own; it passes the program's text to the page as it comes (a web address
  is shown as a link) and the line the person types to the program as typed. Aurelia's code does not read,
  keep, log or send the code or any token. Claude Code writes the sign-in into that person's folder, which
  the server's owner can read (the page says so). "Sign out of Claude Code" runs `claude auth logout`.
- Claude Code always runs with an environment built from nothing: no token or API key in the container's
  environment can reach a run. A test proves that one person's request never runs with another's folder.
- Nobody's plan is used for anybody else. That is also why there is no shared token: an owner who lets a
  family member in through Cloudflare does not lend them a plan.

### A question is one run of `claude -p`

`claude -p --tools "" --allowedTools <Aurelia's tools> --strict-mcp-config --mcp-config <file>
--setting-sources "" --permission-mode dontAsk --no-session-persistence --disable-slash-commands
--output-format stream-json --verbose --max-turns 40 --system-prompt <Aurelia's>` with
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. So it has no built-in tool (no files, no shell, no web), only the MCP
server below, no settings or `CLAUDE.md`, and keeps nothing on disk. The prompt goes in on stdin. One
question at a time per person; a run stops after 10 minutes. A quiet answer or sign-in sends a blank line
every 30 seconds, since Cloudflare closes a connection that says nothing for 100 seconds. The container
runs with an init process, which reaps the processes each question starts. The panel keeps the conversation and sends it
with each question.

### The tools (ADR-0008's registry, first part)

A stdio MCP server (`@modelcontextprotocol/sdk`, MIT), started by Claude Code for one run. It reads the
synced copy (`<folder>/current/`, ADR-0012) through the store's WebDAV, **as the person who asked** (their
own Access token goes with every request), and loads it with the app's own loader, index and continuity
code. Those layers run unchanged in Node through a small resolve hook (`server/agent/src/register.ts`); a
CI test runs the real MCP server in plain Node.

- Read: `get_outline`, `get_scene` (the text in blocks with IDs), `search`, `list_records`, `get_record`,
  `get_links`, `get_findings` (continuity), `get_proposal`.
- Propose: `propose_edit` (replace, remove, insert or add paragraphs) and `propose_scene` (a new scene with
  draft text at the end of a chapter). Each writes one new file, `.aurelia/proposals/prp_….json`, with
  `If-None-Match: *`. Nothing else is ever written. `propose_record` is not built (YAGNI).
- Every result that holds story text is fenced as untrusted data, and the fence cannot be closed from inside.
  Titles are inside the fence too. The activity-log line, which the model also sees, quotes a title cut to
  80 characters, with the fence tags made harmless.
- The system prompt: Claude may critique, fix and draft, and everything it writes is a proposal.

### Proposals, Accept and the Review inbox

- **Block IDs.** Scenes carry no block IDs in their files (ADR-0007 forbids inventing visible ones). A
  proposal's block ID is `b<index>-<fingerprint>` of a paragraph as the assistant read it, and the proposal
  keeps that paragraph's text (`before`) and the scene's `baseHash`. Nothing is written into the scene.
- **Accept is a per-block 3-way merge** (`domain/proposals.ts`): every changed paragraph must still read as
  `before`, and be the same one of the paragraphs that read so (the proposal stores which, and how many there
  were; if their number changed, which one is a guess, so it is refused); everything else may have changed and
  stays. An insertion that is already there (an earlier Accept whose file could not be cleared) is refused too.
  If one is gone or changed, Accept is refused: "The text changed after this was suggested — ask again."
  Before it writes, Accept takes a **"Before a suggestion"** snapshot of the scene (ADR-0013), then writes
  through the session (compare-and-write). A new scene is added at the end of its chapter; nothing is
  overwritten, so it takes no snapshot.
- If the change is in but the proposal file cannot be removed, the author is told: "Accepted, but the suggestion
  could not be cleared — reject it." A new scene that cannot be finished is moved to Recently deleted.
- **Reject** removes the proposal file. **Ask for changes** sends the author's note (only the note: the
  proposal is read back with `get_proposal`, as data); the revision names the proposal it `replaces`, and the
  app removes the old file once the new one is there, so the two show as one. `replaces` counts only for a
  proposal about the same thing (the same scene's text, or a new scene in the same chapter).
- **No accept-all.** Each suggestion is a card with a word diff (removed words crossed out, added words
  underlined, and said in words to a screen reader), in the Review inbox and inside the text on the writing
  page (a frame on the paragraphs, the card after them; decorations only, the document is not touched).
- Before each question the app saves and runs one sync round, so the assistant reads what the author sees;
  after the answer, another round brings the proposals in. `.aurelia/proposals/` syncs like any file (test).

## What it does not do

- It works only for a workspace kept in sync with the server (the assistant reads the server's copy).
- It does not offer ChatGPT or API keys yet, and not the Claude Desktop path of ADR-0008. Those stay planned.
- It does not show a "what will be sent" sheet or a scope picker yet: the assistant can read the whole
  workspace the person syncs. The person sees each read in the activity log.
- Out-of-date check is per paragraph text; a paragraph moved to a place where two read the same is refused.

## Open owner item

- **Anthropic's Commercial Terms.** Fact 3 says a maker who runs Claude Code in a product accepts the
  Commercial Terms unless agreed otherwise. The owner runs this for themselves and the people they let in,
  each on their own account. Whether that makes the owner "a maker running Claude Code in a product" is the
  owner's call, not this ADR's. Decide before offering the image to other people.

## Tests

`server/agent/test/` (tools through a real store as the person, untrusted fence, `If-None-Match`, folder
check; HTTP: forged or missing login is 401, the relayed sign-in, per-person folders, the exact flags, no
token in the environment, one question at a time; the MCP server in plain Node), `server/store/test/auth.test.ts`
(claims), `src/domain/proposals.test.ts`, `src/storage/proposal-actions.test.ts` (snapshot first, refused
when changed, new scene, reject, revision), `src/backup/sync.test.ts` (proposals sync), the panel's hidden
state, `tests/e2e/assistant.spec.ts`, and `deploy/smoke-agent.sh`.

# Alfred (阿福) — AI Personal Assistant

An AI-powered personal assistant for the China market, built on a human-in-the-loop agent architecture. The user types natural language instructions, the AI generates an executable plan, the user reviews and approves, and the system executes using real integrations.

---

## Architecture

```
User (Web UI) → WebSocket → Server (Express + WS)
                                ↓
                         AI Planner (Claude / Qwen)
                                ↓
                         Execution Engine
                                ↓
                    ┌───────────┼───────────────┐
                    ↓           ↓               ↓
              Server Tools   Connector Tools   WeCom Kefu
              (cloud APIs)   (macOS local)     (WeChat messaging)
```

- **Server tools** run directly on the backend (web search, email, calendar, LLM generation)
- **Connector tools** run on the user's Mac via a WebSocket bridge (Apple Contacts, iMessage)
- **WeCom Kefu** provides official WeChat messaging through Tencent's enterprise API

---

## Features

### Computer-Use Architecture

Alfred controls the browser and desktop applications directly — like a human using a computer — instead of relying on external APIs. This means no OAuth tokens, no API keys, and no rate limits for core tasks.

---

#### Browser Computer-Use Tools

These tools run via Playwright on the user's Mac (through the Connector). Alfred opens a real browser, navigates, clicks, fills forms, and extracts results — exactly as a human would.

| Tool | Description | Notes |
|------|-------------|-------|
| `browser.search_web` | Open a browser and perform a web search; extract top results | Replaces `web.search` API |
| `browser.search_flights` | Open Google Flights and search for live flight results | Replaces `flights.search` API |
| `browser.compose_gmail_draft` | Open Gmail, click Compose, fill To/Subject/Body, stop before Send | Replaces `email.send` API |
| `browser.read_gmail` | Open Gmail inbox and extract recent emails | Replaces `email.read` API |
| `browser.manage_calendar` | Open Google Calendar and create/view events | Replaces `calendar.manage` API |
| `browser.open_page` | Navigate to any URL in the browser | Connector |
| `browser.extract_page` | Extract and summarize the current open page | Connector |
| `browser.fill_input` | Fill an input field on the current page | Connector |
| `browser.click_link_by_text` | Click a link by its visible text | Connector |
| `browser.submit_chatgpt_prompt` | Open ChatGPT and submit a prompt | Connector |

---

#### Desktop Computer-Use Tools

These tools run natively on macOS via the Connector (AppleScript / JXA / `open -a`).

| Tool | Description | Requires |
|------|-------------|----------|
| `app.open` | Open any installed macOS desktop app (WeChat, Figma, Zoom, etc.) | Connector |
| `contacts.apple` | Look up contacts from macOS Contacts (iCloud synced) | Connector |
| `imessage.send` | Send iMessages via macOS | Connector |
| `sms.send` | Send SMS (stub — ready for Twilio) | — |
| `reminders.manage` | Create/complete/list Apple Reminders via macOS | Connector |
| `wechat.send` | Send WeChat messages via WeCom Kefu API | WeCom credentials |
| `platform.send` | Generic platform message send (WeCom / DingTalk / Feishu) | — |

---

#### AI / Local Tools

These tools run locally on the server — no browser or external API needed.

| Tool | Description | Requires |
|------|-------------|----------|
| `text.generate` | Generate text (messages, summaries, translations) | LLM API key |
| `image.generate` | Generate images | LLM API key |
| `pdf.process` | Extract, summarize, or answer questions about PDFs | LLM API key |
| `file.save` | Save content to the outbox directory | — |
| `clarify` | Ask the user for missing information | — |

---

### AI Planning with Human Approval

- Natural language input → structured JSON execution plan
- Each plan shows the tools, arguments, and data flow between steps
- User must approve before execution (permission checkboxes for sensitive actions)
"""
# Alfred (阿福) — AI Personal Assistant

Comprehensive developer README for the Alfred / Clawbot project. This document describes repository layout, local development, macOS Connector usage (Playwright-driven browser automation, AppleScript/JXA integrations), testing, and a curated list of demo prompts you can show in demos.

NOTE: this README focuses on the `clawbot-image-demo` workspace found at `clawbot-image-demo/` inside this repository. The server (backend) runs at `clawbot-image-demo/server` and the web frontend at `clawbot-image-demo/web`.

Contents
- Overview
- Architecture
- Local development (install, run, test)
- Connector (macOS) instructions
- Common operations & troubleshooting
- End-to-end demo prompts (curated and localized)
- Project structure (summary)
- Deployment notes

--

## Overview

Alfred is a human-in-the-loop agent platform that turns natural language into an executable plan of small tools. Plans are reviewed and approved via a UI; many steps execute through a local Connector (Mac) that controls a real browser and desktop apps using Playwright and native automation.

Key capabilities
- Generate and run multi-step plans (LLM planner → tool execution)
- Control a real browser for Gmail, ChatGPT, Google Calendar, flights, and web scraping
- Access macOS apps and services: Contacts, iMessage, Reminders, open apps
- WeCom (企业微信) Kefu webhook integration for WeChat messaging

--

## Architecture (high level)

User (Web UI) → WebSocket → Server (Express + WS)
                                                                                                                ↓
                                                                                     AI Planner (LLM)
                                                                                                                ↓
                                                                                     Execution Engine
                                                                                                                ↓
                                                                      ┌───────────┼───────────────┐
                                                                      ↓           ↓               ↓
                                                 Server Tools   Connector Tools   WeCom Kefu
                                                 (cloud APIs)   (macOS local)     (WeChat messaging)

Important runtime invariants
- The Connector owns Playwright browser/context lifecycle on macOS. Server routes browser-related tools to the Connector by WebSocket.
- The server keeps an in-memory session map and may persist to Supabase if configured.

--

## Local development

Prerequisites
- Node.js 18+ (Node 20 recommended)
- On macOS for Connector features: access to Contacts, iMessage, Playwright (Chromium)
- Optional: Docker for containerized runs

Install dependencies

```bash
# server deps
cd clawbot-image-demo/server
npm install

# frontend deps
cd ../web
npm install

# project root (optional helper scripts)
cd ../..
```

Environment
- Copy and edit server env example

```bash
cp clawbot-image-demo/server/.env.example clawbot-image-demo/server/.env
# then edit clawbot-image-demo/server/.env to add keys
```

Recommended env entries (development)
- `PORT` (default 8080)
- `OLLAMA_URL` / `LLM_PROVIDER` / provider keys (`ANTHROPIC_API_KEY`, etc.)
- `WECOM_*` variables for WeChat (only if enabling WeCom Kefu)

Run the server

```bash
cd clawbot-image-demo/server
npm run dev
```

Run the web frontend (Vite)

```bash
cd clawbot-image-demo/web
npm run dev
# open http://localhost:5173
```

Start the Connector (macOS local agent)

```bash
cd clawbot-image-demo/server
# use your connector id (e.g., rae-mac)
CONNECTOR_ID=rae-mac CONNECTOR_SERVER_WS=ws://localhost:8080 npm run connector
```

The Connector will connect to the server via WebSocket and register its ID. The web UI can then bind sessions to that Connector ID to route browser and desktop tool calls.

--

## Running tests and demos

The repo contains runnable demo/test scripts under `server/src/tests/`.

Examples

```bash
# minimal lifecycle test (Playwright lifecycle validation)
npx tsx clawbot-image-demo/server/src/tests/test-playwright-lifecycle.ts

# investor-demo (full plan: search → generate → compose Gmail draft)
npx tsx clawbot-image-demo/server/src/tests/test-investor-demo.ts

# run all tool tests (may require connector and env config)
npx tsx clawbot-image-demo/server/src/tests/test-all-tools.ts
```

Troubleshooting
- If a tool fails with "must be executed via the local connector" make sure `CONNECTOR_ID` is registered and the session is bound to that connector (see below). Use `lsof -iTCP:8080 -sTCP:LISTEN` to confirm server is listening.
- If Playwright errors mention "Target page, context or browser has been closed" the Connector's Playwright lifecycle manager may have recreated browser/context; restart the Connector and re-run the test.

--

## Connector usage and session binding

How the server routes connector-capable tools
- Many `browser.*` tools and `app.open`, `contacts.apple`, `imessage.send`, etc., are flagged to require a Connector.
- `executePlan()` checks `sessionStore.getConnectorId(sessionId)` and `connectorHub.hasConnector(connId)` and forwards calls to that connector ID.

Bind sessions to a connector (web UI or via WebSocket/CLI helper)

Example: bind by WebSocket message (server is running)

```js
// send over ws: { id: 1, method: 'session.bindConnector', params: { sessionId: 'test-session', connectorId: 'rae-mac' }}
```

Or via helper script executed against the running server (example used during development):

```bash
npx tsx -e "import('./clawbot-image-demo/server/src/sessionStore.js').then(m=>m.bindConnector('test-session','rae-mac'))"
```

Once a session is bound, `executePlan()` will route connector-capable tool calls to the connector and wait for results.

--

## Demo prompts (curated)

These prompts are formatted for easy demoing. The list includes English and Chinese variants and ranges from simple queries to multi-step workflows. Use these with the web UI or in `test-*` scripts (replace session IDs):

- Email / Compose
       - "Draft an email to my team summarizing the top 3 AI funding rounds this month."
       - "帮我写一封邮件给王华，说明我们下周产品发布会的议程并附上会议链接。"

- Research / Web
       - "Search the web for the latest news about autonomous vehicles and summarize three key points."
       - "搜索最近一周内有关GPT模型安全性的报道，并给出要点摘要。"

- Browser automation
       - "Open ChatGPT and submit: 'Write a short product update email for marketing.'"
       - "打开 Gmail，点击撰写，填写收件人 test@example.com，主题 '测试'，正文写 '这是一封测试邮件'（不要发送）。"

- Calendar & Reminders
       - "Schedule a 30-minute meeting with Alice next Tuesday at 10am and add Zoom link."
       - "下周五晚上8点和Adam吃饭，添加到日历并提醒我提前1小时。"

- Contacts & Messaging
       - "Look up 'Charlie' in my contacts and start an iMessage draft saying 'Are we still on for Friday?'."
       - "给文件传输助手发微信消息：我刚上传了新图片，请查看。"

- PDF / Documents
       - "Summarize the attached PDF into three bullet points and draft an email to the team with the summary."

- Flights / Travel
       - "Search Google Flights for a one-way ticket from SFO to JFK departing 2026-04-01 and show cheapest options."

- Agent / Compound tasks
       - "Find my last email from investor 'Sarah', summarize it, and draft a reply proposing a meeting next week."
       - "检查我的收件箱，找到来自 'hr@company.com' 的最新邮件并把摘要发到我的微信。"

Tips for demos
- If a connector-required step is included, ensure the Connector is running and the session is bound to it.
- Use `test-playwright-lifecycle.ts` to verify the Connector's Playwright lifecycle before running large demos.

--

## Project structure (short)

```
clawbot-image-demo/
├─ server/                 # backend (Express + WS + tools)
├─ web/                    # frontend (Vite + React)
├─ ios/                    # iOS project artifacts (Capacitor)
└─ render.yaml, docker-compose.yml
```

Files of interest
- `server/src/index.ts` — main server with WebSocket handlers and plan execution
- `server/src/connector/index.ts` — Connector process (runs on macOS)
- `server/src/connector/browserTools` — Playwright manager and browser task implementations
- `server/src/tests` — demo and test scripts (investor demo, lifecycle test, etc.)

--

## Troubleshooting & notes

- Port collisions: kill processes listening on `8080` or `5173` (server/frontend) before starting. Example:

```bash
# free ports 8080 and 5173
pids=$(lsof -t -iTCP:8080 -sTCP:LISTEN || true); if [ -n "$pids" ]; then kill -9 $pids; fi
pids2=$(lsof -t -iTCP:5173 -sTCP:LISTEN || true); if [ -n "$pids2" ]; then kill -9 $pids2; fi
```

- Connector flapping: if connector repeatedly registers then disconnects, check for duplicate connector processes and stop the extras. Use `ps aux | grep connector`.
- Playwright lifecycle: the Connector contains robust logic to avoid returning closed pages; if you still see closed-page errors, restart the Connector and re-run the lifecycle test.

--

## Deployment

Docker (compose)

```bash
cd clawbot-image-demo
docker compose up -d
```

Render.com

Push to GitHub and connect the repository to Render. Add required environment variables in the Render dashboard (`OLLAMA_URL`, `ANTHROPIC_API_KEY`, `WECOM_*`, etc.).

--

If you'd like, I can also:
- Add a short `README.dev.md` with one-line commands for restarting Connector and running tests.
- Create a `DEMO_PROMPTS.md` file enumerating the prompts and expected outcomes for each demo step.

Pull requests, contributions, and bug reports are welcome. Thank you for using Alfred.

"""

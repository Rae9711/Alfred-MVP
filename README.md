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

### 16 Integrated Tools

| Tool | Description | Requires |
|------|-------------|----------|
| `wechat.send` | Send WeChat messages via WeCom Kefu API | WeCom credentials |
| `contacts.apple` | Look up contacts from macOS Apple Contacts (iCloud synced) | Connector |
| `imessage.send` | Send iMessages via macOS | Connector |
| `sms.send` | Send SMS (stub — ready for Twilio integration) | — |
| `email.send` | Send email via Gmail API | Google OAuth |
| `email.read` | Read/search Gmail inbox | Google OAuth |
| `calendar.manage` | Create/list/update/delete Google Calendar events | Google OAuth |
| `reminders.manage` | Create/complete/list Apple Reminders via macOS | Connector |
| `web.search` | Web search via Brave Search API | Brave API key |
| `flights.search` | Search flights via Kiwi API | Kiwi API key |
| `text.generate` | Generate text using Claude or Qwen | LLM API key |
| `image.generate` | Generate images | LLM API key |
| `pdf.process` | Extract text, summarize, or answer questions about PDFs | LLM API key |
| `file.save` | Save files to the outbox directory | — |
| `clarify` | Ask the user for missing information before proceeding | — |
| `platform.send` | Generic platform message send | — |

### AI Planning with Human Approval

- Natural language input → structured JSON execution plan
- Each plan shows the tools, arguments, and data flow between steps
- User must approve before execution (permission checkboxes for sensitive actions)
- Supports compound tasks (e.g., "look up Adam's contact and send him a WeChat message about dinner Friday")

### WeChat Integration (WeCom Kefu)

Uses Tencent's official WeCom (企业微信) Customer Service API for WeChat messaging:

- **Bidirectional**: send and receive messages with any WeChat user
- **Official API**: no risk of account bans (unlike iPad/web protocol approaches)
- **Auto-reply webhook**: incoming WeChat messages trigger the AI agent pipeline — plan, execute, and reply automatically
- **Welcome messages**: automatic greeting when a new user starts a conversation

### Supabase Auth & Persistence

- Optional authentication via Supabase (email/password login)
- Sessions, plans, and execution runs persist to Supabase PostgreSQL
- Write-through cache: in-memory Map for reads, async persist to DB
- Graceful fallback: works fully in-memory when Supabase is not configured

### Connector System

A WebSocket-based bridge that allows the cloud server to invoke tools on the user's local Mac:

- `contacts.apple` — queries macOS Contacts via JXA (JavaScript for Automation)
- `imessage.send` — sends iMessages via AppleScript
- `reminders.manage` — manages Apple Reminders via JXA
- Auto-reconnect on disconnect
- Connector ID binding via the web UI

### Agent Avatar (养成系统)

- Animated character with states: idle, thinking, focused, success, error, sleep
- XP and leveling system based on task completion
- Cosmetic customization (head, face, back, halo, badge)
- Streak tracking for daily interaction

---

## Setup

### Prerequisites

- Node.js 18+
- macOS (for Connector tools — contacts, iMessage, reminders)

### 1. Install dependencies

```bash
cd clawbot-image-demo/server && npm install
cd ../web && npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` in the server directory and fill in:

```bash
cp clawbot-image-demo/server/.env.example clawbot-image-demo/server/.env
```

**Required for core functionality:**
- `LLM_PROVIDER` — `claude` or `ollama`
- `ANTHROPIC_API_KEY` — Claude API key (if using Claude)

**For WeChat (WeCom Kefu):**
- `WECOM_CORP_ID` — WeCom enterprise ID
- `WECOM_CORP_SECRET` — App secret with Kefu permissions
- `WECOM_KF_ID` — Kefu account ID (starts with `wk`)
- `WECOM_CALLBACK_TOKEN` — Callback verification token
- `WECOM_CALLBACK_AES_KEY` — 43-char AES key for message decryption

**For email/calendar:**
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`

**For web search:**
- `BRAVE_SEARCH_API_KEY`

**For Supabase auth (optional):**
- `SUPABASE_URL`, `SUPABASE_KEY`

### 3. Start the server

```bash
cd clawbot-image-demo/server
npm run dev
```

### 4. Start the frontend

```bash
cd clawbot-image-demo/web
npm run dev
```

### 5. Start the Connector (for macOS local tools)

```bash
cd clawbot-image-demo/server
CONNECTOR_ID=your-name-mac CONNECTOR_SERVER_WS=ws://127.0.0.1:8081 npx tsx src/connector/index.ts
```

Then in the web UI, enter the same Connector ID and click "绑定".

### 6. Open the app

Navigate to `http://localhost:5173`

---

## WeCom Kefu Setup

To enable real WeChat messaging:

1. Register at [work.weixin.qq.com](https://work.weixin.qq.com)
2. Create a self-built app (自建应用) with 微信客服 permissions
3. Create a Kefu account — note the `open_kfid`
4. Generate a "Contact Me" QR code for WeChat users to scan
5. Configure the callback URL to `https://your-domain/webhook/wechat`
6. Fill in the `WECOM_*` env vars in `.env`

WeChat users scan the QR code → start chatting → Albert auto-replies via the AI agent.

---

## Example Prompts

```
给文件传输助手发微信消息说：你好
查一下Adam的手机号
搜索一下最近的AI新闻
帮我写一段生日祝福发给查理
查看我的邮件
下周五晚上8点和Adam吃饭
提醒我明天给妈妈打电话
帮我总结这个PDF
```

---

## Project Structure

```
clawbot-image-demo/
├── server/
│   ├── src/
│   │   ├── index.ts              # Express + WebSocket server, webhook handlers
│   │   ├── agent/
│   │   │   ├── plan.ts           # AI planner (prompt engineering, JSON extraction)
│   │   │   ├── render.ts         # Final response renderer
│   │   │   ├── executeStore.ts   # Execution run storage
│   │   │   ├── llm.ts            # LLM provider abstraction (Claude / Ollama)
│   │   │   └── tools/
│   │   │       ├── registry.ts   # Tool registration and catalog
│   │   │       ├── wechat.send.ts    # WeCom Kefu integration
│   │   │       ├── contacts.apple.ts # macOS Contacts via JXA
│   │   │       ├── imessage.send.ts  # iMessage via AppleScript
│   │   │       ├── email.send.ts     # Gmail send
│   │   │       ├── email.read.ts     # Gmail read
│   │   │       ├── calendar.ts       # Google Calendar
│   │   │       ├── reminders.ts      # Apple Reminders
│   │   │       ├── web.search.ts     # Brave Search
│   │   │       ├── flights.search.ts # Kiwi Flights
│   │   │       ├── text.generate.ts  # LLM text generation
│   │   │       ├── pdf.process.ts    # PDF extraction/summarization
│   │   │       └── clarify.ts        # Clarification prompt
│   │   ├── connector/
│   │   │   └── index.ts          # Connector WebSocket bridge
│   │   ├── connectorHub.ts       # Server-side connector management
│   │   ├── sessionStore.ts       # Session management
│   │   ├── planStore.ts          # Plan storage
│   │   ├── googleAuth.ts         # Google OAuth token management
│   │   └── db/
│   │       ├── supabase.ts       # Supabase client
│   │       └── schema.sql        # Database schema
│   └── .env.example
├── web/
│   ├── src/
│   │   ├── App.tsx               # Main app with WebSocket, auth gate
│   │   ├── components/
│   │   │   ├── ProposedPlan.tsx   # Plan review UI
│   │   │   ├── ExecutionLog.tsx   # Live execution viewer
│   │   │   ├── FinalAnswer.tsx    # Result display
│   │   │   ├── AgentAvatarCard.tsx # Agent character/avatar
│   │   │   └── AuthScreen.tsx    # Login/signup screen
│   │   └── api/
│   │       ├── ws.ts             # WebSocket client with auto-reconnect
│   │       └── supabase.ts       # Supabase frontend client
│   └── .env
├── docker-compose.yml            # Production deployment config
└── render.yaml                   # Render.com deployment config
```

---

## Deployment

### Docker Compose

```bash
cd clawbot-image-demo
docker compose up -d
```

### Render.com

Push to GitHub and connect the repo in Render. The `render.yaml` defines the service configuration. Add all `WECOM_*`, `ANTHROPIC_API_KEY`, and other secrets as environment variables in the Render dashboard.

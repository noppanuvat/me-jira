# Jira AI Spec & QA Generator

เว็บแอปสำหรับวิเคราะห์การ์ด Jira ด้วย AI แล้วแปลงเป็น **Implementation Spec สำหรับ Developer** และ **Test Case สำหรับ QA** พร้อมกันในหน้าเดียว

- Frontend: หน้าเว็บไฟล์เดียว (Vue 3 + Tailwind CSS ผ่าน CDN)
- Backend: Node.js proxy server (zero dependency, ใช้ `fetch` built-in)
- Deploy: Caddy reverse proxy ที่ `https://jira.meturr.online`

---

## ✨ Features

- **ดึงข้อมูล Jira** ตาม Issue Key (read-only) พร้อม parent issue context อัตโนมัติ
- **วิเคราะห์ 2 สไตล์** เลือกได้: `Frontend` หรือ `Backend` — prompt และ output ต่างกันตาม stack
- **Frontend output**: state diagram (Mermaid), UX behavior, UI copy (TH/EN), UI states ครบ (idle/loading/success/empty/error/...)
- **Backend output**: API contract (method, endpoint, request/response body, error codes), business logic, edge cases
- **Multi-model**: GLM 5.3 Flash, MiniMax M3.1 Flash (free), Deepseek v4.1 Flash ผ่าน OpenRouter และ Gemini 3.8 Flash / 3.5 Flash Lite
- **Clarifying questions**: ถ้า requirement ไม่ครบ AI จะถามกลับใน `missingPoints` แทนการเดา แล้วนำคำตอบกลับไปวิเคราะห์ซ้ำได้
- **3rd party error mapping**: prompt บังคับให้ map error ของ downstream service ตามมาตรฐานองค์กร (ดูหัวข้อถัดไป)

---

## 🧭 3rd Party Error Mapping (built into prompt)

ทุก spec ที่เกี่ยวกับการเชื่อมต่อ external service ต้อง map error ตามนี้

| # | สถานการณ์ | HTTP ที่ให้ Frontend | หมวด | Error Code |
|---|---|---|---|---|
| 1 | 3rd party ตอบ HTTP 200 และ `response code = "00"` | 200 | Success | – |
| 2 | HTTP 200 แต่ `response code ≠ "00"` และมี business case ที่ handle ได้ | 422 | B (Business) | `B00xxxx` (ตาม case) |
| 3 | HTTP 200 แต่ `response code ≠ "00"` และไม่ได้ handle | 500 | D (Downstream return error) | `D00xxxx` |
| 4 | 3rd party down (timeout, connection refused, ไม่มี response) | 500 | E (Failure) | `E999999` |

**หลักการจำง่าย**

- `B` = ผิดกฎธุรกิจ → 422
- `D` = 3rd party ตอบกลับมาแต่ไม่สำเร็จ และเราไม่ได้ handle → 500
- `E` = ไม่มี response / ติดต่อไม่ได้ / error ทั่วไป → 500
- ห้ามส่ง HTTP 200 กลับไปถ้า `response code ≠ "00"`

**ข้อควรระวัง**

- ปรับ HTTP `503` → `500` กรณี 3rd party down
- ปรับ HTTP `422, 503` → `500` กรณี response code ไม่ใช่ `"00"` และไม่มี handler

---

## 📁 Project Structure

```
jira-ai/
├── jira-proxy-server.js                  # Node.js proxy + AI orchestration + prompt
├── jira_ai_requirement_analyzer_dev_qa.html  # Frontend app (Vue 3, single file)
├── jira_ai_requirement_analyzer_dev_qa.css   # Custom styles
├── index.html                            # Alias ของไฟล์ HTML หลัก (ใช้โดย Caddy/Docker)
├── Caddyfile                             # Reverse proxy config (jira.meturr.online)
├── ensure-running.sh                     # Health-check + auto-start ทุก service
├── Dockerfile / nginx.conf / entrypoint.sh  # Docker deployment (nginx serves HTML)
├── start-jira-proxy.sh                   # Dev launcher (macOS เท่านั้น — ใช้ `open`)
├── .env                                  # Credentials (gitignored)
└── JIRA_PROXY_SETUP.md                   # Setup note แบบย่อ
```

---

## ⚙️ Requirements

- Node.js **18+** (ต้องมี global `fetch`) — เครื่องนี้ใช้ Node 26
- Jira Cloud account + API token
- API key ของ Gemini หรือ OpenRouter (อย่างน้อยหนึ่งตัว)

ไม่ต้อง `npm install` — ไม่มี dependency ภายนอก

---

## 🚀 Quick Start

### 1. สร้าง `.env`

```bash
cp .env.example .env   # หรือสร้างเอง
```

```ini
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your_jira_api_token
GEMINI_API_KEY=your_gemini_key
OPENROUTER_API_KEY=your_openrouter_key
PORT=8787
```

### 2. รันเซิร์ฟเวอร์

```bash
cd jira-ai
set -a && . ./.env && set +a
node jira-proxy-server.js
```

ตรวจสอบ:

```bash
curl http://localhost:8787/health
# {"ok":true,"jiraConfigured":true,"aiConfigured":true,...}
```

### 3. เปิดหน้าเว็บ

เปิด `index.html` ผ่าน browser หรือเสิร์ฟstatic ก็ได้ (ต้องให้ `/api/*` ชี้มาที่ `localhost:8787`)

> ⚠️ `start-jira-proxy.sh` ใช้คำสั่ง `open` ของ macOS จึงใช้บน Linux ไม่ได้ — บน Linux ให้รันตามข้อ 2 หรือใช้ `ensure-running.sh`

---

## 🔌 API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | สถานะ proxy + ว่าตั้งค่า Jira/AI key ครบหรือไม่ |
| `GET` | `/api/jira/issues/:issueKey` | ดึงข้อมูล issue จาก Jira + parent issue (ถ้ามี) |
| `POST` | `/api/ai/analyze` | วิเคราะห์ issue แล้วคืน spec เป็น JSON |

### `POST /api/ai/analyze` — Request body

```json
{
  "issue": {
    "key": "ABC-123",
    "title": "Issue summary",
    "type": "Story",
    "priority": "High",
    "reporter": "someone",
    "sprint": "Sprint 12",
    "rawDescription": "รายละเอียดจากการ์ด Jira",
    "parentKey": "ABC-100",
    "parentTitle": "Parent summary",
    "parentDescription": "Parent description"
  },
  "style": "frontend",
  "model": "deepseek/deepseek-v4.1-flash-1017",
  "clarifyingAnswers": [
    { "question": "ต้องรองรับกรณี x ไหม?", "answer": "ต้องรองรับ" }
  ]
}
```

`style`: `frontend` | `backend`
`model`: ระบุ model id ตรงๆ — ถ้าเป็น OpenRouter model (`deepseek/*`, `z-ai/*`, `minimax/*`) จะ routed ไป OpenRouter, ถ้าเป็น `gemini-*` จะไป Gemini API

### Response (ย่อ)

```json
{
  "ok": true,
  "style": "frontend",
  "modelUsed": "deepseek/deepseek-v4.1-flash-1017",
  "spec": {
    "storyPoints": 3,
    "summary": "...",
    "missingPoints": [],
    "architectureSections": [{ "title": "State Diagram", "badge": "Frontend", "items": [] }],
    "stateDiagramMermaid": "flowchart TD ...",
    "uiCopy": [{ "context": "Error Message", "element": "toast", "textTh": "...", "textEn": "..." }],
    "apiContract": [],
    "subtasks": [],
    "codeSnippet": "...",
    "acceptanceCriteria": [{ "scenario": "...", "given": "...", "when": "...", "then": "..." }],
    "testCases": [{ "id": "TC-FE-01", "type": "Positive", "title": "...", "steps": "...", "expected": "...", "status": "PENDING" }]
  }
}
```

---

## 🏗 Deployment

### Production (เครื่องนี้) — Caddy

`Caddyfile` ให้บริการ:
- `jira.meturr.online` → static HTML + reverse proxy `/api/*` และ `/health` → `localhost:8787`
- ทุก request (ยกเว้น `/health`) ผ่าน `forward_auth` ไป `localhost:3002` (meturr-auth)

รัน/ซ่อมทุก service ด้วย:

```bash
./ensure-running.sh
```

สคริปต์จะ health-check แล้ว start เฉพาะตัวที่ล่ม: jira-proxy (8787), jira-doc-creator backend (3001), auth (3002), Caddy

### Docker

```bash
docker build -t jira-ai .
docker run -p 8787:8787 --env-file .env jira-ai
```

Container ภายในรัน nginx บน 8787 (serve HTML) และ node proxy บน 3000 (`nginx.conf` proxy `/api/` → `127.0.0.1:3000`)

---

## 🔐 Security Notes

- `.env` ถูก gitignore — **ห้าม commit** API token ใดๆ
- Jira integration เป็น **read-only** (ยังไม่มีการเขียนกลับไป Jira)
- Frontend/Backend ถูกป้องกันด้วย auth service แยก (`meturr-auth`)
- อย่าใส่ credential ลง `README.md` หรือไฟล์ที่ commit

---

## 🧩 AI Prompt Design

Prompt อยู่ในฟังก์ชัน `buildGeminiPrompt()` ใน `jira-proxy-server.js` ประกอบด้วย:

- **Persona + stack rules** แยก frontend (Preact Hooks, Zustand, Tailwind) / backend (Spring Boot, Redis, SQL Server, GraphQL)
- **Common rules** — ตอบไทย, กระชับ, ห้าม hallucinate, 3-6 subtasks/test cases
- **3rd party error mapping rules** — ตามตารางด้านบน
- **Parent context rules** — ใช้ parent เป็น background เท่านั้น ไม่ขยาย scope
- **API contract rules** (backend) — บังคับ endpoint จริง, JSON body, exception class + HTTP code
- **JSON schema แบบ strict** — บังคับ output เป็น JSON ตาม schema ทุกครั้ง

แก้ prompt แล้วต้อง **restart process** เพื่อให้มีผล

---

## 📝 License

Internal use — meturr

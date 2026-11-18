#!/usr/bin/env node

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8787);
const JIRA_BASE_URL = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
const JIRA_EMAIL = process.env.JIRA_EMAIL || '';
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_GEMINI_MODEL = 'deepseek/deepseek-v4.1-flash-1017';

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(body));
}

function isConfigured() {
  return Boolean(JIRA_BASE_URL && JIRA_EMAIL && JIRA_API_TOKEN);
}

function isAiConfigured() {
  return Boolean(GEMINI_API_KEY || OPENROUTER_API_KEY);
}

function getIssueKeyFromPath(pathname) {
  const match = pathname.match(/^\/api\/jira\/issues\/([^/]+)$/);
  if (!match) return '';
  return decodeURIComponent(match[1]).trim().toUpperCase();
}

function getGeminiModel(rawModel) {
  if (typeof rawModel !== 'string' || !rawModel.trim()) {
    return DEFAULT_GEMINI_MODEL;
  }
  return rawModel.trim();
}

function isOpenRouterModel(model) {
  const clean = typeof model === 'string' ? model.trim().toLowerCase() : '';
  return (
    clean.startsWith('deepseek/') ||
    clean.startsWith('deepseek-') ||
    clean.startsWith('z-ai/') ||
    clean.startsWith('glm-') ||
    clean.startsWith('minimax/') ||
    clean.startsWith('minimax-') ||
    clean.includes('/')
  );
}

function resolveOpenRouterModel(rawModel) {
  const clean = typeof rawModel === 'string' ? rawModel.trim() : '';
  if (clean === 'deepseek-v4.1-flash-1017') {
    return 'deepseek/deepseek-v4.1-flash-1017';
  }
  if (clean === 'glm-5.3-flash') {
    return 'z-ai/glm-5.3-flash';
  }
  if (clean === 'minimax-m3.1-flash' || clean === 'minimax-m3.1-flash:free') {
    return 'minimax/minimax-m3.1-flash:free';
  }
  return clean;
}

async function readJsonBody(req) {
  const chunks = [];
  let totalSize = 0;

  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > 1_000_000) {
      throw new Error('Request payload is too large');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim();
  return clean || fallback;
}

function normalizeList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value;
}

function normalizeAiSpec(rawSpec, issueKey, style) {
  const styleTag = style === 'backend' ? 'Backend' : 'Frontend';
  const subtasks = normalizeList(rawSpec?.subtasks).map((item, index) => ({
    id: sanitizeText(item?.id, `${issueKey}-${style.slice(0, 2)}-${index + 1}`),
    title: sanitizeText(item?.title, `Sub-task ${index + 1}`),
    detail: sanitizeText(item?.detail, '-'),
    estimate: sanitizeText(item?.estimate, '2h'),
    tag: sanitizeText(item?.tag, styleTag),
    done: Boolean(item?.done)
  }));

  const testCases = normalizeList(rawSpec?.testCases).map((item, index) => ({
    id: sanitizeText(item?.id, `TC-${style.toUpperCase().slice(0, 2)}-${String(index + 1).padStart(2, '0')}`),
    type: sanitizeText(item?.type, 'Positive'),
    title: sanitizeText(item?.title, `Test Case ${index + 1}`),
    steps: sanitizeText(item?.steps, '-'),
    expected: sanitizeText(item?.expected, '-'),
    status: ['PENDING', 'PASS', 'FAIL'].includes(item?.status) ? item.status : 'PENDING'
  }));

  const acceptanceCriteria = normalizeList(rawSpec?.acceptanceCriteria).map((item, index) => ({
    scenario: sanitizeText(item?.scenario, `Scenario ${index + 1}`),
    given: sanitizeText(item?.given, '-'),
    when: sanitizeText(item?.when, '-'),
    then: sanitizeText(item?.then, '-')
  }));

  const architectureSections = normalizeList(rawSpec?.architectureSections).map((section, index) => ({
    title: sanitizeText(section?.title, `Architecture ${index + 1}`),
    badge: sanitizeText(section?.badge, styleTag),
    items: normalizeList(section?.items)
      .map(item => sanitizeText(item))
      .filter(Boolean)
  }));

  const stateDiagramMermaid = style === 'frontend'
    ? sanitizeText(rawSpec?.stateDiagramMermaid, '')
    : '';

  const uiCopy = style === 'frontend'
    ? normalizeList(rawSpec?.uiCopy)
        .map(item => ({
          context: sanitizeText(item?.context, 'General'),
          element: sanitizeText(item?.element, '-'),
          textTh: sanitizeText(item?.textTh),
          textEn: sanitizeText(item?.textEn)
        }))
        .filter(item => item.textTh || item.textEn)
    : [];

  const apiContract = style === 'backend'
    ? normalizeList(rawSpec?.apiContract)
        .map((item) => ({
          method: sanitizeText(item?.method, 'GET').toUpperCase(),
          endpoint: sanitizeText(item?.endpoint),
          description: sanitizeText(item?.description, '-'),
          authRequired: item?.authRequired !== false,
          requestBody: sanitizeText(item?.requestBody, ''),
          responseBody: sanitizeText(item?.responseBody, ''),
          errorCodes: normalizeList(item?.errorCodes)
            .map(err => ({
              exceptionClass: sanitizeText(err?.exceptionClass || err?.code),
              httpCode: sanitizeText(
                typeof err?.httpCode === 'number' ? String(err.httpCode) : err?.httpCode,
                ''
              ),
              condition: sanitizeText(err?.condition, '-')
            }))
            .filter(err => err.exceptionClass)
        }))
        .filter(item => item.endpoint)
    : [];

  return {
    storyPoints: Number.isFinite(Number(rawSpec?.storyPoints)) ? Number(rawSpec.storyPoints) : 3,
    summary: sanitizeText(rawSpec?.summary, `วิเคราะห์ ${issueKey} (${styleTag}) จากข้อมูล Jira สำเร็จ`),
    missingPoints: normalizeList(rawSpec?.missingPoints).map(item => sanitizeText(item)).filter(Boolean),
    architectureSections,
    stateDiagramMermaid,
    uiCopy,
    apiContract,
    subtasks,
    codeSnippet: sanitizeText(rawSpec?.codeSnippet, '// ไม่มีโค้ดตัวอย่างจาก AI'),
    acceptanceCriteria,
    testCases
  };
}

function extractJsonObject(text) {
  const trimmed = sanitizeText(text);
  if (!trimmed) {
    throw new Error('Gemini response is empty');
  }
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('Gemini response is not valid JSON');
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function buildGeminiPrompt({ issue, style, clarifyingAnswers = [] }) {
  const isBackend = style === 'backend';
  const outputStyle = isBackend ? 'backend' : 'frontend';
  const personaLines = isBackend
    ? [
        'You are a senior backend specialist.',
        'Primary stack focus: Spring Boot (Java), Redis, SQL Server, GraphQL.',
        'Design outputs with production-grade API, data consistency, transaction safety, observability, and performance concerns.'
      ]
    : [
        'You are a senior frontend specialist.',
        'Primary stack focus: Preact Hooks, Zustand, Tailwind CSS.',
        'Design outputs with reusable UI patterns, predictable state flow, accessibility, and responsive behavior.'
      ];
  const commonRules = [
    '- Write primarily in Thai.',
    '- Keep only technical terms, API names, component names, and code identifiers in English when needed.',
    '- Use concise, implementation-oriented wording for internal engineering handoff.',
    '- Prefer practical dev wording with natural Thai + English technical terms.',
    '- Avoid marketing tone and avoid over-formal Thai.',
    '- Do NOT hallucinate missing data; if data is ambiguous or incomplete, ask minimally required clarifications via output fields.',
    '- Produce exactly 3-6 subtasks and 3-6 test cases.',
    '- Ensure output is actionable for engineering and QA teams.'
  ];
  const thirdPartyErrorRules = [
    '- 3rd Party Error Mapping (when integrating external services / 3rd party APIs):',
    '  Scenario 1: 3rd party returns HTTP 200 and response code = "00" → Frontend 200, Success.',
    '  Scenario 2: 3rd party returns HTTP 200 but response code ≠ "00" with a handleable business case → Frontend 422, B (Business), error code B00xxxx (depends on case). Example: code "20" → handle per requirement.',
    '  Scenario 3: 3rd party returns HTTP 200 but response code ≠ "00" and not handled → Frontend 500, D (Downstream return error), error code D00xxxx.',
    '  Scenario 4: 3rd party down (timeout, connection refused, no response) → Frontend 500, E (Failure), error code E999999.',
    '  Note: All scenarios return HTTP 200 from 3rd party but response code ≠ "00".',
    '  Caution: map HTTP 503 → 500 when 3rd party is down; map HTTP 422, 503 → 500 when response code is not "00" and no handler exists.'
  ];

  const backendRules = [
    '- Backend content must explicitly align with Spring Boot Java, Redis, SQL Server, and GraphQL where relevant.'
  ];
  const frontendRules = [
    '- Frontend content must explicitly align with Preact Hooks, Zustand, and Tailwind CSS where relevant.',
    '- Focus on what frontend engineers need to implement pages/screens correctly, not only business flow.',
    '- If requirement is page-based, organize analysis by page/screen first, then states and interactions.',
    '- Cover UI states: idle, loading, success, empty, error, submitting, disabled, readonly, partial data (when relevant).',
    '- For each important state, specify trigger, visible UI, allowed/disallowed user actions, and UI response.',
    '- Include both "State Diagram" and "UX Behavior" in architectureSections titles.',
    '- Map "State Diagram" section to explicit state transitions in bullet items.',
    '- Provide `stateDiagramMermaid` using Mermaid syntax when transitions are clear (prefer `flowchart TD`).',
    '- Mermaid nodes/edges in `stateDiagramMermaid` must stay consistent with state transition bullets.',
    '- Map "UX Behavior" section to button/form/validation/loading/empty/error/message/navigation/refresh/optimistic update behaviors when relevant.',
    '- If requirement details are missing, do not invent silently. Put follow-up questions into missingPoints prefixed with "Clarifying Question:".',
    '- Populate "uiCopy" with the actual user-facing text shown on screen, not behavior descriptions.',
    '- Each uiCopy entry must fill both "textTh" (Thai) and "textEn" (English).',
    '- Cover uiCopy contexts such as Empty State, Error Message, Success Toast, Button Label, and Validation when relevant.',
    '- Never invent uiCopy wording that contradicts the requirement; if wording is unspecified, ask via missingPoints instead.',
    '- For technical labels in bullet content, use format "**English Term:** คำอธิบายภาษาไทย".'
  ];
  const clarifyingAnswerLines = Array.isArray(clarifyingAnswers) && clarifyingAnswers.length > 0
    ? [
        '',
        'Clarifying answers from user (treat these as latest confirmed requirement):',
        ...clarifyingAnswers.map((item, idx) => {
          const q = sanitizeText(item?.question, `Question ${idx + 1}`);
          const a = sanitizeText(item?.answer, '-');
          return `- Q: ${q}\n  A: ${a}`;
        })
      ]
    : [];

  const parentKey = sanitizeText(issue?.parentKey);
  const parentContextLines = parentKey
    ? [
        '',
        'Parent Issue Context (supporting background only, NOT the implementation scope):',
        `- Parent Key: ${parentKey}`,
        `- Parent Title: ${sanitizeText(issue?.parentTitle, '-')}`,
        '- Parent Description:',
        sanitizeText(issue?.parentDescription, '-')
      ]
    : [];

  const parentContextRules = parentKey
    ? [
        '- Use Parent Issue Context only to understand business background, domain terms, and surrounding scope.',
        '- Implement scope must stay limited to the child issue, not the whole parent scope.',
        '- Do NOT raise Clarifying Questions about anything already answered in Parent Issue Context.'
      ]
    : [];

  const apiContractRules = isBackend
    ? [
        '- Populate "apiContract" with every endpoint this issue needs (create, read, update, webhook, internal API).',
        '- "method" must be a valid HTTP verb in uppercase.',
        '- "endpoint" must be a concrete path, not a placeholder description.',
        '- "requestBody" and "responseBody" must be valid JSON strings; use empty string when not applicable.',
        '- "errorCodes" must list realistic exception mappings with exception class name, HTTP status code, and trigger condition.',
        '- Use `exceptionClass` values like `ApplicationNotFoundException` (not enum-like APP_NOT_FOUND).',
        '- Provide `httpCode` as HTTP status code (for example 204, 400, 404, 409, 500).',
        '- If the issue truly has no API surface, return "apiContract": [].'
      ]
    : ['- This is frontend style, so "apiContract" MUST be an empty array [].'];

  return [
    ...personaLines,
    'You are a software analyst for Dev and QA planning.',
    `Generate implementation spec in ${outputStyle} style from this Jira issue.`,
    'Return JSON only, no markdown, no explanations.',
    'Use this exact JSON schema:',
    '{',
    '  "storyPoints": number,',
    '  "summary": string,',
    '  "missingPoints": string[],',
    '  "architectureSections": [{ "title": string, "badge": string, "items": string[] }],',
    '  "stateDiagramMermaid": string,',
    '  "uiCopy": [{ "context": string, "element": string, "textTh": string, "textEn": string }],',
    '  "apiContract": [{ "method": string, "endpoint": string, "description": string, "authRequired": boolean, "requestBody": string, "responseBody": string, "errorCodes": [{ "exceptionClass": string, "httpCode": string|number, "condition": string }] }],',
    '  "subtasks": [{ "id": string, "title": string, "detail": string, "estimate": string, "tag": string, "done": false }],',
    '  "codeSnippet": string,',
    '  "acceptanceCriteria": [{ "scenario": string, "given": string, "when": string, "then": string }],',
    '  "testCases": [{ "id": string, "type": "Positive|Negative|Edge Case", "title": string, "steps": string, "expected": string, "status": "PENDING" }]',
    '}',
    'Rules:',
    ...commonRules,
    ...thirdPartyErrorRules,
    ...parentContextRules,
    ...apiContractRules,
    ...(isBackend
      ? [
          ...backendRules,
          '- Follow backend output structure semantics equivalent to these markdown sections: "## 🧾 Overview", "## 🔄 Step-by-Step Flow", "## 🧠 Business Logic", "## ⚠️ Edge Cases".',
          '- Map "## 🧾 Overview" to summary as concise backend scope.',
          '- Map "## 🔄 Step-by-Step Flow" to architectureSections item with title "Step-by-Step Flow" and actionable backend sequence.',
          '- Map "## 🧠 Business Logic" to architectureSections item with title "Business Logic" covering rules, conditions, validations, backend responsibilities.',
          '- Map "## ⚠️ Edge Cases" to architectureSections item with title "Edge Cases" covering backend risks and failure scenarios.',
          '- Keep content backend-only and practical for implementation handoff.',
          '- For backend style, set "stateDiagramMermaid" to an empty string unless explicitly useful.',
          '- For backend style, "uiCopy" MUST be an empty array [].',
          '- For technical labels in bullets, use format "**English Term:** คำอธิบายภาษาไทย".',
          '- If Jira details are ambiguous or incomplete, add minimum follow-up questions in missingPoints prefixed with "Clarifying Question:".'
        ]
      : frontendRules),
    'Important output contract rule:',
    '- Even if internal reasoning uses markdown section thinking, final answer must still be valid JSON matching schema exactly.',
    '',
    `Issue Key: ${sanitizeText(issue?.key, 'N/A')}`,
    `Title: ${sanitizeText(issue?.title, '-')}`,
    `Type: ${sanitizeText(issue?.type, '-')}`,
    `Priority: ${sanitizeText(issue?.priority, '-')}`,
    `Reporter: ${sanitizeText(issue?.reporter, '-')}`,
    `Sprint: ${sanitizeText(issue?.sprint, '-')}`,
    'Description:',
    sanitizeText(issue?.rawDescription, '-'),
    ...parentContextLines,
    ...clarifyingAnswerLines
  ].join('\n');
}

async function callGeminiAnalyze({ issue, style, model, clarifyingAnswers = [] }) {
  const geminiModel = getGeminiModel(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: buildGeminiPrompt({ issue, style, clarifyingAnswers }) }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map(part => sanitizeText(part?.text))
    .filter(Boolean)
    .join('\n');
  const parsed = extractJsonObject(text);
  const spec = normalizeAiSpec(parsed, sanitizeText(issue?.key, 'CUSTOM-101'), style);
  return { modelUsed: geminiModel, spec };
}

async function callOpenRouterAnalyze({ issue, style, model, clarifyingAnswers = [] }) {
  const openRouterModel = resolveOpenRouterModel(model);
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`
    },
    body: JSON.stringify({
      model: openRouterModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: buildGeminiPrompt({ issue, style, clarifyingAnswers })
        }
      ]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `OpenRouter request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const rawContent = payload?.choices?.[0]?.message?.content;
  const text = Array.isArray(rawContent)
    ? rawContent.map(part => sanitizeText(part?.text)).filter(Boolean).join('\n')
    : sanitizeText(rawContent);
  const parsed = extractJsonObject(text);
  const spec = normalizeAiSpec(parsed, sanitizeText(issue?.key, 'CUSTOM-101'), style);
  return { modelUsed: openRouterModel, spec };
}

async function jiraRequestIssue(issueKey) {
  const jiraUrl = `${JIRA_BASE_URL}/rest/api/3/issue/${encodeURIComponent(issueKey)}`;

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  const response = await fetch(jiraUrl, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json'
    }
  });

  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, payload };
}

function getParentKeyFromIssue(issue) {
  const fields = issue?.fields || {};
  const parentKey = fields.parent?.key;
  if (typeof parentKey === 'string' && parentKey.trim()) {
    return parentKey.trim();
  }
  return '';
}

// Jira v3 returns only a summary stub in fields.parent, so description needs a second request.
async function fetchParentIssue(parentKey) {
  if (!parentKey) return null;
  try {
    const parentRes = await jiraRequestIssue(parentKey);
    if (!parentRes.ok) return null;
    const fields = parentRes.payload?.fields || {};
    return {
      key: parentRes.payload?.key || parentKey,
      summary: fields.summary || '',
      issueType: fields.issuetype?.name || '',
      description: fields.description || null
    };
  } catch (_error) {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    return sendJson(res, 400, { ok: false, message: 'Missing request URL' });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    if (!isConfigured()) {
      return sendJson(res, 200, {
        ok: true,
        jiraConfigured: false,
        aiConfigured: isAiConfigured(),
        message: 'Proxy is running but JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN are missing'
      });
    }
    return sendJson(res, 200, {
      ok: true,
      jiraConfigured: true,
      aiConfigured: isAiConfigured(),
      message: 'Proxy is running and Jira credentials are configured'
    });
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/ai/analyze') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        message: error.message || 'Invalid JSON request body'
      });
    }

    const issue = body?.issue || {};
    const style = body?.style === 'backend' ? 'backend' : 'frontend';
    const model = getGeminiModel(body?.model);
    const useOpenRouter = isOpenRouterModel(model);

    if (useOpenRouter && !OPENROUTER_API_KEY) {
      return sendJson(res, 500, {
        ok: false,
        message: 'OPENROUTER_API_KEY is not configured on proxy server'
      });
    }

    if (!useOpenRouter && !GEMINI_API_KEY) {
      return sendJson(res, 500, {
        ok: false,
        message: 'Gemini API key is not configured on proxy server'
      });
    }

    const clarifyingAnswers = Array.isArray(body?.clarifyingAnswers)
      ? body.clarifyingAnswers.map(item => ({
          question: sanitizeText(item?.question),
          answer: sanitizeText(item?.answer)
        })).filter(item => item.question && item.answer)
      : [];
    const issueKey = sanitizeText(issue?.key);
    const title = sanitizeText(issue?.title);
    const rawDescription = sanitizeText(issue?.rawDescription);

    if (!issueKey || !title || !rawDescription) {
      return sendJson(res, 400, {
        ok: false,
        message: 'issue.key, issue.title, and issue.rawDescription are required'
      });
    }

    try {
      const aiRes = useOpenRouter
        ? await callOpenRouterAnalyze({ issue, style, model, clarifyingAnswers })
        : await callGeminiAnalyze({ issue, style, model, clarifyingAnswers });
      return sendJson(res, 200, {
        ok: true,
        style,
        modelUsed: aiRes.modelUsed,
        spec: aiRes.spec
      });
    } catch (error) {
      return sendJson(res, 502, {
        ok: false,
        message: error.message || (useOpenRouter ? 'Failed to analyze with OpenRouter' : 'Failed to analyze with Gemini')
      });
    }
  }

  if (req.method === 'GET') {
    const issueKey = getIssueKeyFromPath(requestUrl.pathname);
    if (issueKey) {
      if (!isConfigured()) {
        return sendJson(res, 500, {
          ok: false,
          message: 'Jira credentials are not configured on proxy server'
        });
      }
      try {
        const jiraRes = await jiraRequestIssue(issueKey);
        if (!jiraRes.ok) {
          const jiraMessage =
            jiraRes.payload?.errorMessages?.join(', ') ||
            jiraRes.payload?.message ||
            `Jira request failed with HTTP ${jiraRes.status}`;
          return sendJson(res, jiraRes.status, { ok: false, message: jiraMessage });
        }
        const parent = await fetchParentIssue(getParentKeyFromIssue(jiraRes.payload));
        return sendJson(res, 200, { ok: true, issue: jiraRes.payload, parent });
      } catch (error) {
        return sendJson(res, 502, {
          ok: false,
          message: error.message || 'Failed to connect to Jira API'
        });
      }
    }
  }

  return sendJson(res, 404, { ok: false, message: 'Endpoint not found' });
});

server.listen(PORT, () => {
  process.stdout.write(`Jira proxy running on http://localhost:${PORT}\n`);
});

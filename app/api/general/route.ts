import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, FunctionDeclaration, FunctionCallingConfigMode } from '@google/genai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// --- Tool Declarations ---
const toolDeclarations = [
  // SQLite tools
  {
    name: 'read_query',
    description: 'Execute SELECT queries to read data from the SQLite database.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'The SELECT SQL query to execute.' }
      },
      required: ['query']
    }
  },
  {
    name: 'write_query',
    description: 'Execute INSERT, UPDATE, or DELETE queries on the SQLite database.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'The SQL modification query.' }
      },
      required: ['query']
    }
  },
  {
    name: 'list_tables',
    description: 'Get a list of all tables in the SQLite database.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: []
    }
  },
  {
    name: 'describe_table',
    description: 'View schema information for a specific table.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        table_name: { type: Type.STRING, description: 'Name of table to describe.' }
      },
      required: ['table_name']
    }
  },
  {
    name: 'create_table',
    description: 'Create new tables in the SQLite database.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'CREATE TABLE SQL statement.' }
      },
      required: ['query']
    }
  },
  {
    name: 'append_insight',
    description: 'Add new business insights to the memo resource.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        insight: { type: Type.STRING, description: 'Business insight discovered from data analysis.' }
      },
      required: ['insight']
    }
  }
];

const MAX_CHUNK_SIZE = 2000; // Limit content sent to Gemini per turn
const MAX_CHUNKS = 3; // Maximum number of tool turns to avoid infinite loops

const triageQuestions: Record<string, string[]> = {
  headache: [
    'How long have you had the headache?',
    'Is the pain severe or mild?',
    'Do you have fever, vomiting, or neck stiffness?',
    'Is this the worst headache of your life?'
  ],
  chest_pain: [
    'How long have you had the chest pain?',
    'Is the pain sharp, dull, or crushing?',
    'Do you have shortness of breath, sweating, or nausea?',
    'Does the pain spread to your arm, neck, or jaw?'
  ],
  fever: [
    'How high is your temperature?',
    'How many days have you had the fever?',
    'Do you have chills, rigors, or rash?',
    'Are you eating and drinking well?'
  ],
  // Add more as needed
};

function cleanSchema(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(cleanSchema);
  } else if (obj && typeof obj === 'object') {
    const allowedKeys = [
      'type', 'properties', 'required', 'description', 'enum', 'items', 'title', 'default', 'format', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern'
    ];
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (allowedKeys.includes(k)) {
        cleaned[k] = cleanSchema(v);
      }
    }
    // Remove or filter required if properties is missing or empty
    if ('required' in cleaned) {
      if (!cleaned.properties || Object.keys(cleaned.properties).length === 0) {
        delete cleaned.required;
      } else {
        cleaned.required = cleaned.required.filter((key: string) => key in cleaned.properties);
        if (cleaned.required.length === 0) delete cleaned.required;
      }
    }
    return cleaned;
  }
  return obj;
}

const DB_PATH = path.join(process.cwd(), 'lib', 'clinic.db');
async function getDb() {
  return open({ filename: DB_PATH, driver: sqlite3.Database });
}

// --- Custom Tool Declarations ---
const customTools = [
  {
    name: 'patient_search_tool',
    description: 'Finds a patient by IC, passport, or full name. Supports partial and fuzzy matching.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        ic_number: { type: Type.STRING, description: 'IC number' },
        passport_number: { type: Type.STRING, description: 'Passport number' },
        full_name: { type: Type.STRING, description: 'Full name (partial allowed)' }
      },
      required: []
    }
  },
  {
    name: 'register_patient_tool',
    description: 'Registers a new patient in the clinic. Checks for duplicates before adding.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        ic_number: { type: Type.STRING },
        passport_number: { type: Type.STRING },
        phone_number: { type: Type.STRING },
        gender: { type: Type.STRING },
        race: { type: Type.STRING },
        address: { type: Type.STRING },
        allergies: { type: Type.STRING }
      },
      required: ['name', 'ic_number', 'phone_number', 'gender', 'address']
    }
  },
  {
    name: 'log_visit_tool',
    description: 'Logs a new visit for a patient. Ensures patient and doctor exist.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_id: { type: Type.INTEGER },
        doctor_id: { type: Type.INTEGER },
        chief_complaint: { type: Type.STRING },
        triage_level: { type: Type.STRING },
        status: { type: Type.STRING }
      },
      required: ['patient_id', 'chief_complaint', 'triage_level', 'status']
    }
  },
  {
    name: 'assign_queue_tool',
    description: 'Assigns a queue number for a visit. Checks for existing queue before assigning.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        visit_id: { type: Type.INTEGER },
        patient_id: { type: Type.INTEGER }
      },
      required: ['visit_id', 'patient_id']
    }
  },
  {
    name: 'doctor_search_tool',
    description: 'Finds available doctors by department or specialization.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        department: { type: Type.STRING },
        specialization: { type: Type.STRING }
      },
      required: []
    }
  },
  {
    name: 'appointment_tool',
    description: 'Schedules, views, or cancels appointments. Checks for conflicts and existence.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_id: { type: Type.INTEGER },
        doctor_id: { type: Type.INTEGER },
        appointment_date: { type: Type.STRING },
        action: { type: Type.STRING, enum: ['schedule', 'view', 'cancel'] }
      },
      required: ['action']
    }
  }
];

const MCP_DB_PATH = path.join(process.cwd(), 'lib', 'clinic.db');

const customToolNames = customTools.map(t => t.name);

async function handleCustomToolCall(name: string, args: any) {
  const db = await getDb();
  console.log(`[Custom Tool Call] ${name} args:`, args);
  if (name === 'patient_search_tool') {
    // Normalize aliases
    const ic_number = args.ic_number || args.ic_or_passport || undefined;
    const passport_number = args.passport_number || undefined;
    const full_name = args.full_name || args.name || undefined;
    let where = [];
    let params: any[] = [];
    if (ic_number) { where.push('ic_number = ?'); params.push(ic_number); }
    if (!ic_number && args.ic_or_passport && args.ic_or_passport.length > 0 && args.ic_or_passport.startsWith('P')) {
      // treat as passport if starts with P
      where.push('passport_number = ?');
      params.push(args.ic_or_passport);
    }
    if (passport_number) { where.push('passport_number = ?'); params.push(passport_number); }
    if (full_name) { where.push('full_name LIKE ?'); params.push(`%${full_name}%`); }
    if (where.length === 0) {
      const msg = 'missing: at least one of ic_number, passport_number, or full_name';
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }
    const sql = `SELECT * FROM patients WHERE ${where.join(' OR ')}`;
    const rows = await db.all(sql, params);
    const msg = rows.length === 0 ? 'no patient found.' : JSON.stringify(rows, null, 2);
    console.log(`[Custom Tool Result] ${name}:`, msg);
    if (rows.length === 0) return { content: [{ type: 'text', text: 'no patient found.' }] };
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  }
  if (name === 'register_patient_tool') {
    // Alias mapping and normalization
    const full_name = args.full_name || args.name;
    // Map phone alias
    if (!args.phone_number && args.phone) args.phone_number = args.phone;
    // Map gender Malay terms
    if (args.gender) {
      const g = (args.gender as string).toLowerCase();
      if (g === 'lelaki' || g === 'male') args.gender = 'male';
      else if (g === 'perempuan' || g === 'female') args.gender = 'female';
    }
    // Map ic_or_passport alias
    if (!args.ic_number && !args.passport_number && args.ic_or_passport) {
      if (/^[0-9]{12}$/.test(args.ic_or_passport)) args.ic_number = args.ic_or_passport;
      else args.passport_number = args.ic_or_passport;
    }
    const required = ['phone_number', 'gender', 'address', 'allergies'];
    const missing = required.filter(f => !args[f]);
    if (!args.ic_number && !args.passport_number) missing.unshift('ic_number or passport_number');
    if (!full_name) {
      const msg = 'missing: full_name';
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }
    if (missing.length > 0) {
      const msg = `missing: ${missing.join(', ')}`;
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }
    // Defensive: check if 'full_name' column exists in patients table
    const columns = await db.all(`PRAGMA table_info(patients)`);
    const hasFullName = columns.some(col => col.name === 'full_name');
    if (!hasFullName) {
      const msg = 'Error: patients table has no column named full_name. Please check your database schema.';
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }
    // Check for duplicate IC or passport
    const { ic_number, passport_number, phone_number, gender, address, allergies } = args;
    let { race } = args as any;
    const allowedRaces = ['Malay', 'Indian', 'Chinese', 'Eurasian', 'Other'];
    if (!race || !allowedRaces.includes(race)) {
      race = 'Other';
    }
    let existing = null;
    if (ic_number) {
      existing = await db.get(`SELECT * FROM patients WHERE ic_number = ?`, [ic_number]);
    }
    if (!existing && passport_number) {
      existing = await db.get(`SELECT * FROM patients WHERE passport_number = ?`, [passport_number]);
    }
    if (existing) {
      const msg = 'patient already exists.';
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }
    await db.run(
      `INSERT INTO patients (full_name, ic_number, passport_number, phone_number, gender, race, address, allergies, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [full_name, ic_number || '', passport_number || '', phone_number, gender, race, address, allergies || '']
    );
    const msg = 'registration successful.';
    console.log(`[Custom Tool Result] ${name}:`, msg);
    return { content: [{ type: 'text', text: msg }] };
  }
  if (name === 'log_visit_tool') {
    const required = ['patient_id', 'chief_complaint', 'triage_level', 'status'];
    const missing = required.filter(f => !args[f]);
    if (missing.length > 0) {
      const msg = `missing: ${missing.join(', ')}`;
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }
    const msg = 'visit logged.';
    console.log(`[Custom Tool Result] ${name}:`, msg);
    return { content: [{ type: 'text', text: msg }] };
  }
  if (name === 'assign_queue_tool') {
    const required = ['visit_id', 'patient_id'];
    const missing = required.filter(f => !args[f]);
    if (missing.length > 0) {
      const msg = `missing: ${missing.join(', ')}`;
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }
    const msg = 'queue assigned.';
    console.log(`[Custom Tool Result] ${name}:`, msg);
    return { content: [{ type: 'text', text: msg }] };
  }
  if (name === 'doctor_search_tool') {
    if (!args.department && !args.specialization) {
      const msg = 'missing: department or specialization';
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }
    const msg = 'doctor(s) found.';
    console.log(`[Custom Tool Result] ${name}:`, msg);
    return { content: [{ type: 'text', text: msg }] };
  }
  if (name === 'appointment_tool') {
    if (!args.action) {
      const msg = 'missing: action';
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }
    const msg = 'appointment processed.';
    console.log(`[Custom Tool Result] ${name}:`, msg);
    return { content: [{ type: 'text', text: msg }] };
  }
  const msg = 'custom tool not implemented.';
  console.log(`[Custom Tool Result] ${name}:`, msg);
  return { content: [{ type: 'text', text: msg }] };
}

export async function POST(req: NextRequest) {
  const { history } = await req.json();

  // --- System Prompt ---
  const systemPrompt = {
    role: 'user',
    parts: [{
      text: `
you are heal.ai, an AI assistant working in a malaysian klinik kesihatan or government hospital (MOH).
you handle patient triage, registration, and queueing, fully in malaysian-style natural conversation.

🧬 PERSONALITY & RESPONSE STYLE:
always reply in lowercase only.

sound like a real helpful frontliner, not a bot.

use empathetic, friendly malaysian tone (like a nurse).

never expose backend or errors to user.

don't give UI instructions like "click" or "select".

always handle everything smoothly — think for yourself.

🔁 FLOW PRIORITY: TRIAGE → REGISTRATION → QUEUE
🩺 PHASE 1: TRIAGE
user describes their issue. you follow this:

clarify symptoms if needed (especially vague complaints).

based on symptoms, decide urgency:

Urgency	Condition Example	AI Response
🔴 RED (Emergency)	chest pain, seizure, breathing difficulty, major bleeding	ok i will bring you in now. stay calm ya.
🟡 YELLOW (Semi-urgent)	high fever, asthma, dizziness, etc.	not too serious, but better we check soon.
🟢 GREEN (Non-urgent)	flu, cough, minor injuries	not urgent, we can register and wait ya.

after triage:

if 🔴 → stop and bring in.

if 🟡 or 🟢 → continue to registration.

🧾 PHASE 2: REGISTRATION
ask for IC or passport number + name:

can i have your ic number or passport?

what's your full name ya?

search in patients table using IC/passport:

if found → skip to queue.

if not found → say:
oh you're new here. let me help you register.

describe_table(patients) and get required fields.

ask for each field naturally, like:

are you male or female?

what's your phone number ya?

do you have any allergies?

what's your current address?

if IC is given → extract DOB from IC.

register patient with collected info.

if any error (e.g., missing field), just say:
ok need a bit more info ya → ask for missing field → retry.

📋 PHASE 3: QUEUE
describe_table(queue) to get required fields.

ask needed queue info, e.g.:

what are you here for today?

is this your first visit or follow-up?

got any doctor you usually see?

register patient to queue.

confirm with user:
ok you're in the queue now. just wait a bit ya.

🤖 TOOL RULES
always use describe_table(...) to get real schema.

never hardcode field names.

always handle failures naturally — never show "error".

🗣️ EXAMPLES:
user: sakit kepala teruk sangat sejak semalam
ai: ok since bila start sakit kepala ni? ada muntah atau pengsan tak?
→ determine yellow → not too serious, but better we check soon.
→ continue: can i have your ic number or passport?

you must always follow the real-world flow like a trained frontliner.
do not break character. stay in flow. always think and act like you're on duty in a KKM clinic.

**schema mapping:**
- if the describe_table tool returns a field called 'name', use 'full_name' instead. if it returns 'id', use 'patient_id' instead. always confirm the correct field names with the schema and use the actual database column names.
- if any tool returns an error or message about missing or invalid fields, always ask the user for those fields, one at a time if possible, and try again. keep looping until the tool call is successful or the user wants to stop.
- if the tool response lists which fields are missing, use that information to ask for those fields.

**strict flow you MUST follow:**
1. start with triage questions.
2. then ask: "can i have your ic or passport number?".
3. call patient_search_tool().
   – if patient exists → go to step 4.
   – if not found → collect missing registration fields (call describe_table(patients) to get required fields) → call register_patient_tool() → make sure registered then only go to step 4.
4. ask visit-specific questions (chief complaint, duration, severity) but simplify it so normal people with weak language understands.
5. if registred then call doctor_search_tool (pick first doctor with availability_status = 'available' in appropriate department).
6. call log_visit_tool(), then assign_queue_tool().
7. respond with queue number (KL###) and a short markdown "## visit summary" (≤ 6 lines) for the doctor.
8. continue normal conversation as needed.

never break this order, never reveal internal codes, never mention ui. if any tool error says "missing: …", politely ask only for those fields, then retry.

**remember:** your job is to make the patient feel safe, informed, and cared for, while collecting all necessary information for the clinic workflow.

2. use list_tables if you are unsure of table names, then proceed.
`
    }]
  };

  let geminiMessages = [systemPrompt, ...history.map((msg: { sender: string, text: string }) => ({
    role: msg.sender === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }))];

  // --- MCP Tool Discovery ---
  const serverParams = new StdioClientTransport({
    command: "uvx",
    args: ["mcp-server-sqlite", "--db-path", MCP_DB_PATH]
  });
  const client = new Client({ name: "healai-client", version: "1.0.0" });
  await client.connect(serverParams);
  const mcpTools = await client.listTools();

  // Harmonize MCP tool schemas to match FunctionDeclaration type
  function harmonizeMcpTool(tool: any): FunctionDeclaration {
    // Remove unsupported OpenAPI keys and ensure correct structure
    const parameters = tool.inputSchema && typeof tool.inputSchema === 'object'
      ? cleanSchema(tool.inputSchema)
      : { type: 'object', properties: {}, required: [] };
    return {
      name: tool.name,
      description: tool.description || '',
      parameters: parameters
    };
  }

  // Harmonize custom tools to match FunctionDeclaration type
  function harmonizeCustomTool(tool: any): FunctionDeclaration {
    // Ensure all required fields are present and types are correct
    return {
      name: tool.name,
      description: tool.description || '',
      parameters: cleanSchema(tool.parameters)
    };
  }

  const mcpFunctionDeclarations: FunctionDeclaration[] = mcpTools.tools.map(harmonizeMcpTool);
  const customFunctionDeclarations: FunctionDeclaration[] = customTools.map(harmonizeCustomTool);
  const allFunctionDeclarations: FunctionDeclaration[] = [...mcpFunctionDeclarations, ...customFunctionDeclarations];

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // --- Gemini Function Calling Loop ---
  let response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-04-17",
    contents: geminiMessages,
    config: {
      tools: [{ functionDeclarations: allFunctionDeclarations }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.AUTO
        }
      }
    },
  });

  let resultText = '';
  let toolUsed = false;
  let toolCalls = 0;
  let toolName: string | undefined = undefined;
  let toolOutput: string | undefined = undefined;
  let toolOutputs: string[] = [];

  // Tool calling loop
  while (response.functionCalls && response.functionCalls.length > 0 && toolCalls < 3) {
    toolUsed = true;
    toolCalls++;
    const functionCall = response.functionCalls[0];
    toolName = functionCall.name;
    let result: any;
    try {
      const toolNameStr = typeof functionCall.name === 'string' ? functionCall.name : '';
      if (customToolNames.includes(toolNameStr)) {
        result = await handleCustomToolCall(toolNameStr, functionCall.args || {});
      } else {
        // Auto-fill describe_table missing table_name
        if (toolNameStr === 'describe_table') {
          if (!functionCall.args || !('table_name' in functionCall.args)) {
            functionCall.args = { table_name: 'patients' };
          }
        }
        console.log(`[MCP Tool Call] ${toolNameStr} args:`, functionCall.args || {});
        result = await client.callTool({ name: toolNameStr, arguments: functionCall.args || {} });
        console.log(`[MCP Tool Result] ${toolNameStr}:`, result);
      }
    } catch (err) {
      console.log(`[Tool Error] ${functionCall.name}:`, err);
      result = { content: [{ type: 'text', text: 'Sorry, there was a system error. Please try again or check your details.' }] };
    }
    let fetchedText = '';
    if (Array.isArray(result.content) && result.content.length > 0 && typeof result.content[0].text === 'string') {
      fetchedText = result.content[0].text ?? '';
    }
    let chunk = fetchedText.slice(0, 2000);
    if (fetchedText.length > 2000) {
      chunk += '\n[Content truncated. Ask for more to continue.]';
    }
    const function_response_part = {
      name: functionCall.name,
      response: { result: chunk }
    };
    geminiMessages.push({ role: 'model', parts: [{ functionCall: functionCall }] });
    geminiMessages.push({ role: 'user', parts: [{ functionResponse: function_response_part }] });
    toolOutput = `Here is the result from ${functionCall.name}:\n${chunk}`;
    // Always inject tool output as a user message for full context
    geminiMessages.push({ role: 'user', parts: [{ text: toolOutput }] });
    // Also inject Gemini's previous response text for better memory
    if (response.candidates && response.candidates[0]?.content?.parts) {
      const prevGeminiText = response.candidates[0].content.parts
        .filter(p => typeof p.text === 'string')
        .map(p => p.text)
        .join('\n');
      if (prevGeminiText.trim()) {
        geminiMessages.push({ role: 'model', parts: [{ text: prevGeminiText }] });
      }
    }
    response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-04-17",
      contents: geminiMessages,
      config: {
        tools: [{ functionDeclarations: allFunctionDeclarations }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO
          }
        }
      },
    });
    toolOutputs.push(toolOutput);
  }

  // Final answer
  const geminiText = (response.text ?? '');
  resultText = geminiText.trim() !== '' ? geminiText : 'Sorry, I do not have an answer.';

  await client.close();

  return NextResponse.json({ result: resultText, toolUsed, toolCalls, toolName, toolOutput, toolOutputs });
} 
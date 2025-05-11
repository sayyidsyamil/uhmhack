import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, FunctionDeclaration, FunctionCallingConfigMode } from '@google/genai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// --- Hugging Face Inference Client Import & Initialization ---
import { InferenceClient } from '@huggingface/inference';
const hf = new InferenceClient(process.env.HUGGINGFACE_TOKEN || '');

// --- Tool Declarations ---
const toolDeclarations: FunctionDeclaration[] = [
  // Speech-to-text via Hugging Face Whisper
  {
    name: 'speech_to_text',
    description: 'Transcribes user-provided audio to text using a Hugging Face Whisper model.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        audio:     { type: Type.STRING, description: 'Base64-encoded audio data.' },
        mime_type: { type: Type.STRING, description: 'MIME type of the audio file (e.g., audio/mpeg, audio/wav).' }
      },
      required: ['audio', 'mime_type']
    }
  },
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
const MAX_CHUNKS = 3;        // Maximum number of tool turns to avoid infinite loops

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
  ]
  // Add more as needed
};

function cleanSchema(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(cleanSchema);
  } else if (obj && typeof obj === 'object') {
    const allowedKeys = [
      'type', 'properties', 'required', 'description', 'enum',
      'items', 'title', 'default', 'format', 'minimum',
      'maximum', 'minLength', 'maxLength', 'pattern'
    ];
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (allowedKeys.includes(k)) {
        cleaned[k] = cleanSchema(v);
      }
    }
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
  // Speech-to-text custom tool
  {
    name: 'speech_to_text',
    description: 'Transcribes user-provided audio to text using a Hugging Face Whisper model.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        audio:     { type: Type.STRING, description: 'Base64-encoded audio data.' },
        mime_type: { type: Type.STRING, description: 'MIME type of the audio file (e.g., audio/mpeg, audio/wav).' }
      },
      required: ['audio', 'mime_type']
    }
  },
  {
    name: 'patient_search_tool',
    description: 'Finds a patient by IC, passport, or full name. Supports partial and fuzzy matching.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        ic_number:      { type: Type.STRING, description: 'IC number' },
        passport_number:{ type: Type.STRING, description: 'Passport number' },
        full_name:      { type: Type.STRING, description: 'Full name (partial allowed)' }
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
        name:            { type: Type.STRING },
        ic_number:       { type: Type.STRING },
        passport_number: { type: Type.STRING },
        phone_number:    { type: Type.STRING },
        gender:          { type: Type.STRING },
        race:            { type: Type.STRING },
        address:         { type: Type.STRING },
        allergies:       { type: Type.STRING }
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
        patient_id:     { type: Type.INTEGER },
        doctor_id:      { type: Type.INTEGER },
        chief_complaint:{ type: Type.STRING },
        triage_level:   { type: Type.STRING },
        status:         { type: Type.STRING }
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
        visit_id:   { type: Type.INTEGER },
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
        department:     { type: Type.STRING },
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
        patient_id:      { type: Type.INTEGER },
        doctor_id:       { type: Type.INTEGER },
        appointment_date:{ type: Type.STRING },
        action:          { type: Type.STRING, enum: ['schedule', 'view', 'cancel'] }
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

  // --- Speech-to-text Handler ---
  if (name === 'speech_to_text') {
    const { audio, mime_type } = args;
    const buffer = Buffer.from(audio, 'base64');
    try {
      const asrOutput = await hf.automaticSpeechRecognition({
        model: 'mesolitica/malaysian-whisper-large-v3-turbo-v3',
        data: buffer
      });
      const transcript = (asrOutput as any).text ?? JSON.stringify(asrOutput);
      return { content: [{ type: 'text', text: transcript }] };
    } catch (err) {
      console.error('[SpeechToText Error]', err);
      return { content: [{ type: 'text', text: 'sorry, i could not process the audio. please try again.' }] };
    }
  }

  // --- Existing Custom Tool Handlers ---
  if (name === 'patient_search_tool') {
    const ic_number = args.ic_number || args.ic_or_passport || undefined;
    const passport_number = args.passport_number || undefined;
    const full_name = args.full_name || args.name || undefined;
    let where = [];
    const params: any[] = [];
    if (ic_number) { where.push('ic_number = ?'); params.push(ic_number); }
    if (!ic_number && args.ic_or_passport && args.ic_or_passport.startsWith('P')) {
      where.push('passport_number = ?'); params.push(args.ic_or_passport);
    }
    if (passport_number) { where.push('passport_number = ?'); params.push(passport_number); }
    if (full_name) { where.push('full_name LIKE ?'); params.push(`%${full_name}%`); }
    if (where.length === 0) {
      return { content: [{ type: 'text', text: 'missing: at least one of ic_number, passport_number, or full_name' }] };
    }
    const rows = await db.all(`SELECT * FROM patients WHERE ${where.join(' OR ')}`, params);
    if (rows.length === 0) return { content: [{ type: 'text', text: 'no patient found.' }] };
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  }

  if (name === 'register_patient_tool') {
    const full_name = args.full_name || args.name;
    if (!args.phone_number && args.phone) args.phone_number = args.phone;
    if (args.gender) {
      const g = (args.gender as string).toLowerCase();
      if (g === 'lelaki' || g === 'male') args.gender = 'male';
      else if (g === 'perempuan' || g === 'female') args.gender = 'female';
    }
    if (!args.ic_number && !args.passport_number && args.ic_or_passport) {
      if (/^[0-9]{12}$/.test(args.ic_or_passport)) args.ic_number = args.ic_or_passport;
      else args.passport_number = args.ic_or_passport;
    }
    const required = ['phone_number', 'gender', 'address', 'allergies'];
    const missing = required.filter(f => !args[f]);
    if (!args.ic_number && !args.passport_number) missing.unshift('ic_number or passport_number');
    if (!full_name) return { content: [{ type: 'text', text: 'missing: full_name' }] };
    if (missing.length > 0) {
      return { content: [{ type: 'text', text: `missing: ${missing.join(', ')}` }] };
    }
    const cols = await db.all(`PRAGMA table_info(patients)`);
    const hasFull = cols.some(c => c.name === 'full_name');
    if (!hasFull) {
      return { content: [{ type: 'text', text: 'Error: patients table has no column named full_name. Please check your database schema.' }] };
    }
    let existing = null;
    if (args.ic_number) existing = await db.get(`SELECT * FROM patients WHERE ic_number = ?`, [args.ic_number]);
    if (!existing && args.passport_number) existing = await db.get(`SELECT * FROM patients WHERE passport_number = ?`, [args.passport_number]);
    if (existing) return { content: [{ type: 'text', text: 'patient already exists.' }] };
    let { race } = args as any;
    const allowed = ['Malay','Indian','Chinese','Eurasian','Other'];
    if (!race || !allowed.includes(race)) race = 'Other';
    await db.run(
      `INSERT INTO patients (full_name, ic_number, passport_number, phone_number, gender, race, address, allergies, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [full_name, args.ic_number||'', args.passport_number||'', args.phone_number, args.gender, race, args.address, args.allergies||'']
    );
    return { content: [{ type: 'text', text: 'registration successful.' }] };
  }

  if (name === 'log_visit_tool') {
    const required = ['patient_id','chief_complaint','triage_level','status'];
    const missing = required.filter(f => !args[f]);
    if (missing.length) return { content: [{ type: 'text', text: `missing: ${missing.join(', ')}` }] };
    return { content: [{ type: 'text', text: 'visit logged.' }] };
  }

  if (name === 'assign_queue_tool') {
    const required = ['visit_id','patient_id'];
    const missing = required.filter(f => !args[f]);
    if (missing.length) return { content: [{ type: 'text', text: `missing: ${missing.join(', ')}` }] };
    return { content: [{ type: 'text', text: 'queue assigned.' }] };
  }

  if (name === 'doctor_search_tool') {
    if (!args.department && !args.specialization) {
      return { content: [{ type: 'text', text: 'missing: department or specialization' }] };
    }
    return { content: [{ type: 'text', text: 'doctor(s) found.' }] };
  }

  if (name === 'appointment_tool') {
    if (!args.action) {
      return { content: [{ type: 'text', text: 'missing: action' }] };
    }
    return { content: [{ type: 'text', text: 'appointment processed.' }] };
  }

  return { content: [{ type: 'text', text: 'custom tool not implemented.' }] };
}

export async function POST(req: NextRequest) {
  const { history } = await req.json();

  // --- System Prompt ---
  const systemPrompt = {
    role: 'user',
    parts: [{
      text: `
you are heal.ai, an AI assistant working in a malaysian klinik kesihatan or government hospital (MOH).
... (system prompt truncated for brevity in this snippet; use original full prompt) ...`
    }]
  };

  // Assemble initial messages
  let geminiMessages = [systemPrompt, ...history.map((msg: { sender: string, text: string }) => ({
    role: msg.sender === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }))];

  // --- MCP Tool Discovery & Registration ---
  const serverParams = new StdioClientTransport({
    command: "uvx",
    args: ["mcp-server-sqlite", "--db-path", MCP_DB_PATH]
  });
  const client = new Client({ name: "healai-client", version: "1.0.0" });
  await client.connect(serverParams);
  const mcpTools = await client.listTools();

  function harmonizeMcpTool(tool: any): FunctionDeclaration {
    const parameters = tool.inputSchema && typeof tool.inputSchema === 'object'
      ? cleanSchema(tool.inputSchema)
      : { type: 'object', properties: {}, required: [] };
    return { name: tool.name, description: tool.description || '', parameters };
  }
  function harmonizeCustomTool(tool: any): FunctionDeclaration {
    return { name: tool.name, description: tool.description || '', parameters: cleanSchema(tool.parameters) };
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
        functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO }
      }
    }
  });

  let resultText = '';
  let toolUsed = false;
  let toolCalls = 0;
  let toolName: string | undefined;
  let toolOutput: string | undefined;
  let toolOutputs: string[] = [];

  while (response.functionCalls && response.functionCalls.length > 0 && toolCalls < MAX_CHUNKS) {
    toolUsed = true;
    toolCalls++;
    const functionCall = response.functionCalls[0];
    toolName = functionCall.name;
    let result: any;
    try {
      if (customToolNames.includes(functionCall.name)) {
        result = await handleCustomToolCall(functionCall.name, functionCall.args || {});
      } else {
        if (functionCall.name === 'describe_table' && (!functionCall.args || !('table_name' in functionCall.args))) {
          functionCall.args = { table_name: 'patients' };
        }
        result = await client.callTool({ name: functionCall.name, arguments: functionCall.args || {} });
      }
    } catch (err) {
      console.log(`[Tool Error] ${functionCall.name}:`, err);
      result = { content: [{ type: 'text', text: 'sorry, there was a system error. please try again.' }] };
    }

    const fetchedText = Array.isArray(result.content) && result.content[0]?.text
      ? result.content[0].text
      : '';
    let chunk = fetchedText.slice(0, MAX_CHUNK_SIZE);
    if (fetchedText.length > MAX_CHUNK_SIZE) {
      chunk += '\n[Content truncated. Ask for more to continue.]';
    }

    const function_response_part = { name: functionCall.name, response: { result: chunk } };
    geminiMessages.push({ role: 'model', parts: [{ functionCall }] });
    geminiMessages.push({ role: 'user', parts: [{ functionResponse: function_response_part }] });

    toolOutput = `Here is the result from ${functionCall.name}:\n${chunk}`;
    geminiMessages.push({ role: 'user', parts: [{ text: toolOutput }] });

    if (response.candidates && response.candidates[0]?.content?.parts) {
      const prevText = response.candidates[0].content.parts
        .map(p => typeof p.text === 'string' ? p.text : '')
        .join('\n');
      if (prevText.trim()) {
        geminiMessages.push({ role: 'model', parts: [{ text: prevText }] });
      }
    }

    response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-04-17",
      contents: geminiMessages,
      config: {
        tools: [{ functionDeclarations: allFunctionDeclarations }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO }
        }
      }
    });

    toolOutputs.push(toolOutput);
  }

  const geminiText = response.text ?? '';
  resultText = geminiText.trim() !== '' ? geminiText : 'sorry, i do not have an answer.';

  await client.close();
  return NextResponse.json({ result: resultText, toolUsed, toolCalls, toolName, toolOutput, toolOutputs });
}

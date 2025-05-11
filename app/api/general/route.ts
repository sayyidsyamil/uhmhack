import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, FunctionDeclaration, FunctionCallingConfigMode, createUserContent, createPartFromUri, Part } from '@google/genai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from 'path';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import fs from 'fs/promises';
import os from 'os';
import { v4 as uuidv4 } from 'uuid'; // For unique filenames




const MAX_CHUNK_SIZE = 5000; // Limit content sent to Gemini per turn
const MAX_CHUNKS = 5; // Maximum number of tool turns to avoid infinite loops


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
    description: 'Registers a new patient in the clinic. Checks for duplicates before adding. Requires full_name, (ic_number OR passport_number), phone_number, gender, address. Race and allergies are optional.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        full_name: { type: Type.STRING, description: 'Full name of the patient.' },
        ic_number: { type: Type.STRING, description: 'Malaysian IC number (e.g., 900101011234).' },
        passport_number: { type: Type.STRING, description: 'Passport number for non-Malaysians.' },
        phone_number: { type: Type.STRING, description: 'Patient\'s phone number.' },
        gender: { type: Type.STRING, description: 'Patient\'s gender (male/female/other or lelaki/perempuan). English will be stored.' },
        race: { type: Type.STRING, description: 'Patient\'s race (Malay, Chinese, Indian, Eurasian, Other). Defaults to Other if not specified or invalid.' },
        address: { type: Type.STRING, description: 'Patient\'s current residential address.' },
        allergies: { type: Type.STRING, description: 'Known allergies (e.g., Penicillin, Dust). Defaults to "None" if not specified.' }
      },
      required: ['full_name', 'phone_number', 'gender', 'address'] // IC or Passport will be handled by logic
    }
  },
  {
    name: 'log_visit_and_assign_queue_tool',
    description: 'Logs a new patient visit and assigns a queue number. Requires patient_id, chief_complaint, triage_level. It will create a visit record and then a queue record, returning the queue number.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_id: { type: Type.INTEGER, description: 'The ID of the patient from the patients table.' },
        doctor_id: { type: Type.INTEGER, description: 'The ID of the doctor assigned for the visit. Can be determined by doctor_search_tool.' },
        chief_complaint: { type: Type.STRING, description: 'The main reason for the patient\'s visit (e.g., "sakit kepala", "demam").' },
        triage_level: { type: Type.STRING, description: 'The urgency level determined by triage (red, yellow, or green).' },
        // status for visit can be defaulted to 'pending'
        // patient_id for queue is same as visit
      },
      required: ['patient_id', 'doctor_id', 'chief_complaint', 'triage_level']
    }
  },
  {
    name: 'doctor_search_tool',
    description: 'Finds available doctors. Can filter by department or specialization. If no filters, returns first available doctor.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        department: { type: Type.STRING, description: 'Department to search for a doctor in (e.g., "General Medicine", "Pediatrics").' },
        specialization: { type: Type.STRING, description: 'Specialization of the doctor (e.g., "Cardiologist", "Pediatrician").' }
      },
      required: [] // Both optional
    }
  },
  {
    name: 'triage_tool',
    description: 'Determines triage urgency level (red, yellow, green) based on symptoms. Returns structured triage_level, reason, and recommended action.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        symptoms: { type: Type.STRING, description: 'Patient symptoms or complaint, in plain language.' }
      },
      required: ['symptoms']
    }
  }
];

const MCP_DB_PATH = path.join(process.cwd(), 'lib', 'clinic.db');

const customToolNames = customTools.map(t => t.name);

async function handleCustomToolCall(name: string, args: any, history?: any[]) {
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
    if (rows.length === 0) return { content: [{ type: 'text', text: 'no patient found. advise to register.' }] };
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
      [full_name, ic_number || null, passport_number || null, phone_number, gender, race, address, allergies || 'None']
    );
    const newPatient = await db.get('SELECT * FROM patients WHERE rowid = last_insert_rowid()');
    const msg = `registration successful. patient details: ${JSON.stringify(newPatient, null, 2)}`;
    console.log(`[Custom Tool Result] ${name}:`, msg);
    return { content: [{ type: 'text', text: msg }] };
  }

  if (name === 'log_visit_and_assign_queue_tool') {
    const { patient_id, doctor_id, chief_complaint, triage_level } = args;
    const required = ['patient_id', 'doctor_id', 'chief_complaint', 'triage_level'];
    const missing = required.filter(f => !(f in args) || args[f] === null || args[f] === undefined);

    if (missing.length > 0) {
      const msg = `missing required fields for log_visit_and_assign_queue_tool: ${missing.join(', ')}`;
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }

    try {
      // Log the visit
      const visitStatus = 'pending'; // Default status for new visits
      const visitResult = await db.run(
        `INSERT INTO visits (patient_id, doctor_id, chief_complaint, triage_level, status, visit_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
        [patient_id, doctor_id, chief_complaint, triage_level, visitStatus]
      );
      const visit_id = visitResult.lastID;

      if (!visit_id) {
        const msg = "failed to log visit, could not get visit_id.";
        console.error(`[Custom Tool Error] ${name}: ${msg}`);
        return { content: [{ type: 'text', text: msg }] };
      }

      // Assign queue number
      // Simple queue number generation: KL + 3 random digits
      const queue_number = `KL${Math.floor(100 + Math.random() * 900)}`;
      const queueStatus = 'waiting';
      await db.run(
        `INSERT INTO queue (visit_id, patient_id, queue_number, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [visit_id, patient_id, queue_number, queueStatus]
      );

      const msg = `visit logged (ID: ${visit_id}) and queue number ${queue_number} assigned to patient ID ${patient_id}.`;
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: `ok, visit logged. your queue number is ${queue_number}.` }] };

    } catch (error: any) {
      console.error(`[Custom Tool Error] ${name}:`, error);
      return { content: [{ type: 'text', text: `error processing visit and queue: ${error.message}` }] };
    }
  }

  if (name === 'doctor_search_tool') {
    let sql = `SELECT staff_id, full_name, specialization, department FROM doctors_staff WHERE role = 'doctor' AND availability_status = 'available'`;
    const params: any[] = [];
    if (args.department) {
      sql += ' AND department = ?';
      params.push(args.department);
    }
    if (args.specialization) {
      sql += ' AND specialization = ?';
      params.push(args.specialization);
    }
    sql += ' LIMIT 5'; // Return a few available doctors

    const doctors = await db.all(sql, params);
    if (doctors.length === 0) {
      // If no specific match, try finding any available doctor
      const anyDoctor = await db.all(`SELECT staff_id, full_name, specialization, department FROM doctors_staff WHERE role = 'doctor' AND availability_status = 'available' LIMIT 1`);
      if (anyDoctor.length > 0) {
        const msg = `no doctor found for specified criteria. found an available doctor: ${JSON.stringify(anyDoctor, null, 2)}`;
        console.log(`[Custom Tool Result] ${name}:`, msg);
        return { content: [{ type: 'text', text: msg }] };
      }
      const msg = 'no doctors available at the moment.';
      console.log(`[Custom Tool Result] ${name}:`, msg);
      return { content: [{ type: 'text', text: msg }] };
    }
    const msg = `available doctor(s): ${JSON.stringify(doctors, null, 2)}`;
    console.log(`[Custom Tool Result] ${name}:`, msg);
    return { content: [{ type: 'text', text: msg }] };
  }

  if (name === 'triage_tool') {
    const symptoms = (args.symptoms || '').toLowerCase();
    let triage_level: 'red' | 'yellow' | 'green' = 'green';
    let reason = '';
    let description = '';
    if (/chest pain|seizure|breath|susah nafas|major bleeding|pengsan|collapse|fit|convulsion/.test(symptoms)) {
      triage_level = 'red';
      reason = 'emergency symptom detected';
      description = `Symptoms: ${symptoms}. Emergency detected.`;
    } else if (/high fever|asthma|dizziness|demam tinggi|sesak nafas|pening|muntah|vomit|asthma|suspect dengue|severe/.test(symptoms)) {
      triage_level = 'yellow';
      reason = 'semi-urgent symptom detected';
      description = `Symptoms: ${symptoms}. Semi-urgent detected.`;
    } else if (/flu|cough|batuk|selsema|minor injury|sakit ringan|sakit kepala ringan|mild/.test(symptoms)) {
      triage_level = 'green';
      reason = 'non-urgent symptom detected';
      description = `Symptoms: ${symptoms}. Non-urgent.`;
    } else if (!symptoms || symptoms.length < 5 || /sakit|pain|demam|fever|pening|dizzy|tak sihat|unwell|not feeling well|unwell|bad|sick|headache|mild|general|kurang sihat/.test(symptoms)) {
      triage_level = 'green';
      reason = 'not enough detail, defaulted to non-urgent';
      description = `Symptoms: ${symptoms || 'not clear'}. Not enough info, defaulted to non-urgent.`;
    } else {
      triage_level = 'green';
      reason = 'uncertain, defaulted to non-urgent';
      description = `Symptoms: ${symptoms}. Not a clear match, defaulted to non-urgent.`;
    }
    return { content: [{ type: 'text', text: JSON.stringify({ triage_level, description, reason }) }] };
  }

  const msg = `custom tool '${name}' not found or not implemented.`;
  console.log(`[Custom Tool Result] ${name}:`, msg);
  return { content: [{ type: 'text', text: msg }] };
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  let history: any[];
  let userInputText: string | null = null;
  let audioFile: File | null = null;

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    history = JSON.parse(formData.get('history') as string || '[]');
    userInputText = formData.get('input') as string | null; // Text input might still be there
    audioFile = formData.get('audio') as File | null;
  } else if (contentType.includes('application/json')) {
    const body = await req.json();
    history = body.history;
    // Ensure history is an array and not empty before accessing its last element
    userInputText = (Array.isArray(body.history) && body.history.length > 0) ? body.history[body.history.length - 1].text : null;
  } else {
    return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set in environment variables.");
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  let currentMessageText = userInputText;

  if (audioFile) {
    try {
      const tempDir = os.tmpdir();
      const tempFilePath = path.join(tempDir, `${uuidv4()}-${audioFile.name}`);
      const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
      await fs.writeFile(tempFilePath, audioBuffer);

      // Read as base64
      const base64Audio = (await fs.readFile(tempFilePath)).toString("base64");

      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-04-17",
        contents: [
          { text: "Please transcribe this audio into text. Provide only the transcription." },
          {
            inlineData: {
              mimeType: audioFile.type || "audio/webm",
              data: base64Audio,
            },
          },
        ],
      });

      currentMessageText = result.text || "Could not transcribe audio.";
      await fs.unlink(tempFilePath);
    } catch (error) {
      console.error("Error processing audio file:", error);
      currentMessageText = "Error processing audio. Please try speaking again or type your message.";
    }
  }
  
  if (!currentMessageText && history.length > 0) {
    // Fallback if audio processing failed and no text was initially provided with audio
    // Or if it was a pure history send (e.g. initial load)
    const lastUserMessageInHistory = history.slice().reverse().find((m: any) => m.sender === 'user');
    if (lastUserMessageInHistory) {
        currentMessageText = lastUserMessageInHistory.text;
    }
  }
  
  if (!currentMessageText && !audioFile) { // No input at all
     console.log("No user input text or audio file provided.");
     // Return a default message or error, depending on how you want to handle empty sends
     // For now, let Gemini handle it, it might respond based on history only
  }


  // --- System Prompt ---
  let geminiMessages = [
    { text: `you are heal.ai, an ai assistant working in a malaysian klinik kesihatan or government hospital (moh). you handle patient triage, registration, and queueing, fully in malaysian-style natural conversation.

🧬 personality & response style

always reply in lowercase only

sound like a real helpful frontliner, not a bot

use empathetic, friendly malaysian tone (like a nurse)

never expose backend or errors to user

don't give ui instructions like "click" or "select"

always handle everything smoothly — think for yourself

match user's language: if user uses english, reply in english; if bahasa sarawak, reply in bahasa sarawak; and so on

🔁 flow priority: triage → registration → queue

🩺 phase 1: use 
user describes their issue. your job:

clarify symptoms if needed (especially vague ones)

based on symptoms, assign urgency:

call triage_tool()

urgency	condition example	ai response
🔴 red (emergency)	chest pain, seizure, breathing difficulty, major bleeding	a nurse will be manually seeing you soon.
🟡 yellow (semi-urgent)	high fever, asthma, dizziness	not too serious, but better we check soon.
🟢 green (non-urgent)	flu, cough, minor injuries	not urgent, we can register and wait ya.

if 🔴 → stop and bring in

if 🟡 or 🟢 → continue to registration

🧾 phase 2: registration
ask: "can i have your ic number or passport?"

call describe_table(patients) to confirm schema

search with patient_search_tool()

if found → skip to queue

if not found → say: "oh you're new here. let me help you register."

collect required fields naturally:

examples:
are you male or female?
what's your phone number ya?
do you have any allergies?
what's your current address?
if ic is given → extract dob from ic

call register_patient_tool()

if any missing field → say: "ok need a bit more info ya" → ask → retry

📋 phase 3: queue

call describe_table(queue) to confirm schema

ask for queue info:
what are you here for today?
is this your first visit or follow-up?

call doctor_search_tool()

match complaint to field specialization if possible
if no match, just pick first available doctor

call log_visit_tool()

call assign_queue_tool()

respond: "ok you're in the queue now. just wait a bit ya."

show:
visit summary
name: …
ic/passport: …
complaint: …
urgency: …
doctor: …
queue no: KL###

🤖 tool rules

always use describe_table(...) to get real schema
never hardcode field names
always handle failures naturally — never show "error"

📌 examples
user: sakit kepala teruk sangat sejak semalam
ai: ok since bila start sakit kepala ni? ada muntah atau pengsan tak?
→ determine yellow
→ response: not too serious, but better we check soon.
→ continue: can i have your ic number or passport?

🧠 strict workflow (must follow exactly):

start with triage USE TRIAGE TOOL
ask: can i have your ic or passport number?
confirm table names: list_tables() if unsure
confirm schema: describe_table(<table>)
search patient
if found → go to step 6
if not found → collect required fields from schema → register → go to step 6
ask complaint questions in simple language
find suitable doctor
log visit
assign to queue
give queue number and summary

📌 schema mapping rules
if describe_table shows field name → treat as full_name
if it shows id → treat as patient_id
if tool says "missing: …" → ask only for those fields politely and retry
keep retrying until success or user wants to stop

💡 your job:
act like a trained frontliner in a kkm clinic.
make patients feel safe, cared for, and informed while completing the clinic workflow.
never break character. never mention system stuff. stay in flow.

always use list_tables() and describe_table(queue) before answering any query.` },
    ...history.map((msg: { sender: string, text: string }) => ({ text: msg.text })),
  ];
  if (currentMessageText && typeof currentMessageText === 'string') {
    geminiMessages.push({ text: currentMessageText });
  }

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

  // Before every ai.models.generateContent call, filter out any null/undefined text
  const filteredGeminiMessages = geminiMessages.filter(m => typeof m.text === 'string' && m.text !== null && m.text !== undefined);
  let response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-04-17",
    contents: filteredGeminiMessages,
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
  let triageLevel: string | undefined = undefined;

  // Tool calling loop
  while (response.functionCalls && response.functionCalls.length > 0 && toolCalls < MAX_CHUNKS) {
    toolUsed = true;
    toolCalls++;
    const functionCall = response.functionCalls[0];
    toolName = functionCall.name;
    let result: any;
    try {
      const toolNameStr = typeof functionCall.name === 'string' ? functionCall.name : '';
      if (customToolNames.includes(toolNameStr)) {
        result = await handleCustomToolCall(toolNameStr, functionCall.args || {}, geminiMessages);
      } else {
        if (toolNameStr === 'describe_table') {
          if (!functionCall.args || !('table_name' in functionCall.args)) {
            functionCall.args = { table_name: 'patients' };
          }
        }
        result = await client.callTool({ name: toolNameStr, arguments: functionCall.args || {} });
      }
    } catch (err) {
      result = { content: [{ type: 'text', text: 'Sorry, there was a system error. Please try again or check your details.' }] };
    }
    let fetchedText = '';
    if (Array.isArray(result.content) && result.content.length > 0 && typeof result.content[0].text === 'string') {
      fetchedText = result.content[0].text ?? '';
    } else if (typeof result.content === 'string') {
      fetchedText = result.content;
    } else if (result.content && result.content[0] && typeof result.content[0] === 'string') {
      fetchedText = result.content[0];
    }
    let chunk = fetchedText.slice(0, MAX_CHUNK_SIZE);
    if (fetchedText.length > MAX_CHUNK_SIZE) {
      chunk += '\n[Content truncated. Ask for more to continue.]';
    }
    toolOutput = `Tool used: ${functionCall.name}. Output:\n${chunk}`;
    toolOutputs.push(toolOutput);
    // If triage_tool, parse triage_level
    if (functionCall.name === 'triage_tool') {
      try {
        const triageObj = JSON.parse(fetchedText);
        if (triageObj && triageObj.triage_level) {
          triageLevel = triageObj.triage_level;
        }
      } catch {}
    }
    geminiMessages.push({ text: `Tool response for ${functionCall.name}: ${chunk}` });
    const filteredGeminiMessagesLoop = geminiMessages.filter(m => typeof m.text === 'string' && m.text !== null && m.text !== undefined);
    response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-04-17",
      contents: filteredGeminiMessagesLoop,
      config: {
        tools: [{ functionDeclarations: allFunctionDeclarations }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO
          }
        }
      },
    });
  }

  const geminiText = (response.text ?? '');
  resultText = geminiText.trim() !== '' ? geminiText : 'Sorry, I do not have an answer for that right now.';

  if (client) {
    try {
      await client.close();
    } catch (e) {
      console.warn("Attempted to close MCP client, but an error occurred (possibly already closed or undefined):", e);
    }
  }

  return NextResponse.json({ 
    result: resultText, 
    toolUsed, 
    toolCalls, 
    toolName: toolCalls > 0 ? toolName : undefined, 
    toolOutput: toolOutputs.length > 0 ? toolOutputs[toolOutputs.length -1] : undefined, 
    toolOutputs,
    triageLevel
  });
} 
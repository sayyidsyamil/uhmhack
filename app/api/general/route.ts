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
import { triage_tool, search_tool, register_tool, queue_tool, summary_tool, feedback_tool } from '@/lib/tools';




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

// --- Tool Declarations ---
const tools = [
  {
    name: 'triage_tool',
    description: 'Determines triage urgency level (red, yellow, green, or blue) based on symptoms. Returns structured triage level, clinical reasoning, key factors, and recommendations.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        symptoms: { type: Type.STRING, description: 'Patient symptoms or complaint, in plain language. May be in a simple format with symptoms separated by + or other separators.' }
      },
      required: ['symptoms']
    }
  },
  {
    name: 'search_tool',
    description: 'Searches for a patient by IC number or passport number.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        ic_number: { type: Type.STRING, description: 'IC number' },
        passport_number: { type: Type.STRING, description: 'Passport number' }
      },
      required: []
    }
  },
  {
    name: 'register_tool',
    description: 'Registers a new patient in the clinic.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        ic_number: { type: Type.STRING, description: 'IC number' },
        passport_number: { type: Type.STRING, description: 'Passport number' },
        full_name: { type: Type.STRING, description: 'Full name' },
        age: { type: Type.NUMBER, description: 'Age' },
        gender: { type: Type.STRING, description: 'Gender (male/female)' },
        race: { type: Type.STRING, description: 'Race' },
        phone: { type: Type.STRING, description: 'Phone number' }
      },
      required: ['full_name', 'age', 'gender', 'phone']
    }
  },
  {
    name: 'queue_tool',
    description: 'Adds a patient to the queue.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_id: { type: Type.NUMBER, description: 'Patient ID' },
        triage: { type: Type.STRING, description: 'Triage level' },
        symptoms: { type: Type.STRING, description: 'Patient symptoms' },
        triage_logic: { type: Type.STRING, description: 'Clinical reasoning for triage level' }
      },
      required: ['patient_id', 'triage', 'symptoms', 'triage_logic']
    }
  },
  {
    name: 'summary_tool',
    description: 'Generates a summary of the patient visit.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        conversation: { type: Type.STRING, description: 'Conversation text' },
        triage: { type: Type.STRING, description: 'Triage level' },
        symptoms: { type: Type.STRING, description: 'Patient symptoms' },
        queue_id: { type: Type.NUMBER, description: 'Queue ID to link the summary to' }
      },
      required: ['conversation', 'triage', 'symptoms', 'queue_id']
    }
  },
  {
    name: 'feedback_tool',
    description: 'Records patient feedback.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_id: { type: Type.NUMBER, description: 'Patient ID' },
        feedback: { type: Type.STRING, description: 'Feedback text' }
      },
      required: ['patient_id', 'feedback']
    }
  }
];

const MCP_DB_PATH = path.join(process.cwd(), 'lib', 'clinic.db');

const toolNames = tools.map(t => t.name);

async function handleToolCall(name: string, args: any) {
  console.log(`[Tool Call] ${name} args:`, args);

  try {
    switch (name) {
      case 'triage_tool':
        return { content: [{ type: 'text', text: JSON.stringify(await triage_tool(args)) }] };
      case 'search_tool':
        return { content: [{ type: 'text', text: JSON.stringify(await search_tool(args)) }] };
      case 'register_tool':
        return { content: [{ type: 'text', text: JSON.stringify(await register_tool(args)) }] };
      case 'queue_tool':
        return { content: [{ type: 'text', text: JSON.stringify(await queue_tool(args)) }] };
      case 'summary_tool':
        return { content: [{ type: 'text', text: JSON.stringify(await summary_tool(args)) }] };
      case 'feedback_tool':
        return { content: [{ type: 'text', text: JSON.stringify(await feedback_tool(args)) }] };
      default:
        const msg = `Tool '${name}' not found or not implemented.`;
        console.log(`[Tool Result] ${name}:`, msg);
        return { content: [{ type: 'text', text: msg }] };
    }
  } catch (error) {
    console.error(`[Tool Error] ${name}:`, error);
    return { content: [{ type: 'text', text: 'Sorry, there was a system error. Please try again.' }] };
  }
}

interface RequestBody {
  history: Array<{ sender: string; text: string }>;
}

// --- Conversation History Logging ---
function logConversationHistory({ history }: { history: Array<{ sender: string, text: string }> }) {
  console.log('--- Conversation History ---');
  for (const msg of history) {
    if (msg.sender === 'system') continue; // Don't print system prompt in logs
    console.log(`${msg.sender}: ${msg.text}`);
  }
  console.log('---------------------------');
}

// Helper to generate AI thought/analysis after tool output
function generateAIThought(toolName, toolOutput) {
  if (toolName === 'triage_tool') {
    try {
      const triageObj = JSON.parse(toolOutput);
      if (triageObj && triageObj.triage) {
        const color = triageObj.triage.toLowerCase();
        if (color === 'red') {
          return 'Triage result is RED (emergency). I will now trigger emergency protocol and alert the nurse.';
        } else if (color === 'yellow' || color === 'green') {
          return `Triage result is ${color.toUpperCase()}. I will now proceed to patient search and registration as per workflow.`;
        } else if (color === 'blue') {
          return 'Triage result is BLUE (routine). I will now proceed with routine workflow, starting with patient search.';
        }
      }
    } catch (e) {
      // fallback
    }
    return 'Triage completed. I will now proceed to the next workflow step based on the triage result.';
  }
  // For other tools, generic message
  return `Based on the output of ${toolName}, I will now proceed to the next step in the workflow.`;
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  let history: any[];
  let userInputText: string | null = null;
  let audioFile: File | null = null;

  // Log incoming request headers
  console.log('--- Incoming Request ---');
  console.log('Headers:', req.headers);

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    history = JSON.parse(formData.get('history') as string || '[]');
    userInputText = formData.get('input') as string | null;
    audioFile = formData.get('audio') as File | null;
    console.log('Parsed multipart/form-data:', { history, userInputText, audioFile: !!audioFile });
  } else if (contentType.includes('application/json')) {
    const body = await req.json() as RequestBody;
    history = body.history;
    userInputText = (Array.isArray(body.history) && body.history.length > 0) ? body.history[body.history.length - 1].text : null;
    console.log('Parsed application/json:', { history, userInputText });
  } else {
    console.log('Unsupported content type:', contentType);
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
      console.log('Audio transcription result:', currentMessageText);
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
  const systemPrompt = `You are heal.ai, an AI assistant working in a Malaysian government hospital (KKM). You handle patient triage, registration, and queueing.

🧬 Personality & Response Style

ALWAYS match user's language style exactly:
- If user uses English → use English
- If user uses Malay → use Malay
- If user uses Chinese → use Chinese
- If user uses Tamil → use Tamil
- If user uses mixed language → use mixed language
- If user uses short form → use short form

Sound like a real helpful frontliner, not a bot
Use empathetic, friendly Malaysian tone (like a nurse)
Never expose backend or errors to user
Don't give UI instructions like "click" or "select"
Always handle everything smoothly — think for yourself

🔧 Available Tools (MUST call these exact functions):
1. triage_tool(symptoms: string) - classifies severity (red, yellow, green, blue) based on symptoms
2. search_tool(ic_number?: string, passport_number?: string) - finds patient by IC/passport, updates last_attended if found
3. register_tool(full_name: string, age: number, gender: 'male'|'female', race: string, phone: string, ic_number?: string, passport_number?: string) - registers new patient
4. queue_tool(patient_id: number, triage: string, symptoms: string, triage_logic: string) - assigns queue number & doctor based on triage and availability
5. summary_tool(conversation: string, triage: string, symptoms: string) - stores summary of patient's full visit
6. feedback_tool(patient_id: number, feedback: string) - collects optional feedback (blue case only)
7. list_tables() - shows available database tables
8. describe_table(table_name: string) - shows table structure

⚙️ Workflow for Each Case:

🔴 Red (Emergency):
1. ALWAYS clarify symptoms first:
   - Ask about severity, duration, other symptoms
   - Get complete picture before triage
2. MUST call triage_tool(symptoms) to check severity
3. Analyze triage output:
   - If red → trigger emergency (siren + alert)
   - If not red → handle as appropriate level
4. If red → nurse takes over
5. Stop here - no other tools needed

🟡 Yellow (Semi-urgent) / 🟢 Green (Non-urgent):
1. ALWAYS clarify symptoms first:
   - Ask about severity, duration, other symptoms
   - Get complete picture before triage
2. MUST call triage_tool(symptoms) to check severity
3. Analyze triage output:
   - If yellow/green → continue
   - If red → handle as emergency
   - If blue → handle as routine
4. Ask for IC/passport
5. MUST call describe_table("patients") to verify patient attributes
6. MUST call search_tool(ic_number or passport_number)
7. Analyze search output:
   - If found → get patient_id and continue
   - If not found → MUST go through registration process:
     a. Collect ALL required registration details
     b. MUST call describe_table("patients") to verify registration fields
     c. MUST call register_tool() with ALL details
     d. MUST call search_tool() again to get patient_id
     e. Verify patient_id exists before continuing
8. Ask more questions about symptoms
9. MUST call describe_table("queues") to verify queue attributes
10. MUST call queue_tool(patient_id, triage, symptoms, triage_logic) with ALL parameters:
    - patient_id: from search_tool result
    - triage: from triage_tool result
    - symptoms: patient's reported symptoms
    - triage_logic: clinical reasoning from triage_tool
11. Analyze queue output:
    - If success → tell patient queue number & doctor
    - If error → handle error and retry if needed
12. MUST call describe_table("summaries") to verify summary attributes
13. MUST call summary_tool(conversation, triage, symptoms)
14. Done

🔵 Blue (Routine):
1. ALWAYS clarify symptoms first:
   - Ask about severity, duration, other symptoms
   - Get complete picture before triage
2. MUST call triage_tool(symptoms) to check severity
3. Analyze triage output:
   - If blue → continue
   - If yellow/green → handle as semi-urgent
   - If red → handle as emergency
4. Ask for IC/passport
5. MUST call describe_table("patients") to verify patient attributes
6. MUST call search_tool(ic_number or passport_number)
7. Analyze search output:
   - If found → get patient_id and continue
   - If not found → MUST go through registration process:
     a. Collect ALL required registration details
     b. MUST call describe_table("patients") to verify registration fields
     c. MUST call register_tool() with ALL details
     d. MUST call search_tool() again to get patient_id
     e. Verify patient_id exists before continuing
8. Ask more questions about symptoms
9. MUST call describe_table("queues") to verify queue attributes
10. MUST call queue_tool(patient_id, triage, symptoms, triage_logic) with ALL parameters:
    - patient_id: from search_tool result
    - triage: from triage_tool result
    - symptoms: patient's reported symptoms
    - triage_logic: clinical reasoning from triage_tool
11. Analyze queue output:
    - If success → tell patient queue number & doctor
    - If error → handle error and retry if needed
12. MUST call describe_table("summaries") to verify summary attributes
13. MUST call summary_tool(conversation, triage, symptoms)
14. Ask for feedback:
    - "How was our service today?"
    - "Anything we can improve?"
15. Analyze feedback:
    - If given → MUST call describe_table("feedbacks") to verify feedback attributes
    - If given → MUST call feedback_tool(patient_id, feedback)
    - If not given → skip to done
16. Done

📌 Registration Details (MUST collect ALL these):
1. Full name (required)
2. Age (required)
3. Gender (required, must be 'male' or 'female')
4. Race (required, must be one of: 'malay', 'chinese', 'indian', 'other', 'foreigner')
5. Phone number (required)
6. IC number (optional)
7. Passport number (optional)

📌 Example Responses (use your own words!):

🔴 Red:
User: chest pain
AI: How is your chest pain? Do you feel any difficulty breathing? Any pain in other areas? (use language that patient is using)
User: yes, difficulty breathing + chest pain
→ MUST call triage_tool("chest pain + difficulty breathing")
→ Analyze output: triage level is red, trigger emergency
AI: This is an emergency. Nurse will come now. Please stay calm and seated. (use language that patient is using)

🟡 Yellow:
User: headache
AI: How is your headache? Do you feel dizzy? Any nausea? (use language that patient is using)
User: yes, dizzy + nausea
→ MUST call triage_tool("headache + dizzy + nausea")
→ Analyze output: triage level is yellow, continue with registration
AI: I've noted your symptoms of headache, dizziness, and slight nausea. Looks like yellow level, not too serious but better we check soon. Can I get your IC or passport number? (use language that patient is using)
User: have IC 1234567890
→ MUST call describe_table("patients") to verify patient attributes
→ MUST call search_tool({ ic_number: "1234567890" })
→ Analyze output: patient found, get patient_id
AI: Found your information. Before I get your queue number, let me ask a few more questions. How long have you had this headache? And is it getting better or worse? (use language that patient is using)
User: since morning, seems to be getting worse
→ MUST call describe_table("queues") to verify queue attributes
→ MUST call queue_tool({
  patient_id: 123,
  triage: "yellow",
  symptoms: "headache since morning, getting worse, with dizziness and nausea",
  triage_logic: "moderate symptoms requiring prompt attention but not immediately life-threatening"
})
→ Analyze output: queue number assigned successfully
AI: Your queue number is Q1234. Please wait in the waiting area. (use language that patient is using)
→ MUST call describe_table("summaries") to verify summary attributes
→ MUST call summary_tool({
  conversation: "patient came with worsening headache since morning, with dizziness and nausea",
  triage: "yellow",
  symptoms: "headache, dizziness, nausea"
})
AI: Doctor will see you soon. (use language that patient is using)

🟢 Green:
User: slight fever
AI: How long have you had the fever? Do you have any other symptoms? (use language that patient is using)
User: 2 days, slight cough
→ MUST call triage_tool("fever 2 days + cough")
→ Analyze output: triage level is green, continue with registration
AI: I understand you have fever for 2 days and slight cough. This seems non-urgent. Can I get your IC or passport number? (use language that patient is using)
User: have IC 1234567890
→ MUST call describe_table("patients") to verify patient attributes
→ MUST call search_tool({ ic_number: "1234567890" })
→ Analyze output: patient found, get patient_id
AI: Found your information. Before I get your queue number, let me ask a few more questions. Is your fever high? And do you have any other symptoms like sore throat or runny nose? (use language that patient is using)
User: not very high, slight sore throat
→ MUST call describe_table("queues") to verify queue attributes
→ MUST call queue_tool({
  patient_id: 123,
  triage: "green",
  symptoms: "low grade fever for 2 days, slight cough, mild sore throat",
  triage_logic: "mild symptoms, non-urgent case"
})
→ Analyze output: queue number assigned successfully
AI: Your queue number is Q1234. Please wait in the waiting area. (use language that patient is using)
→ MUST call describe_table("summaries") to verify summary attributes
→ MUST call summary_tool({
  conversation: "patient came with low grade fever for 2 days, slight cough, and mild sore throat",
  triage: "green",
  symptoms: "fever, cough, sore throat"
})
AI: Doctor will see you soon. (use language that patient is using)

🔵 Blue:
User: want check up
AI: Is this a routine check-up? Any specific symptoms? (use language that patient is using)
User: no, just routine check
→ MUST call triage_tool("routine check up")
→ Analyze output: triage level is blue, continue with routine process
AI: For routine check-up we can help. Can I get your IC or passport number? (use language that patient is using)
User: have IC 1234567890
→ MUST call describe_table("patients") to verify patient attributes
→ MUST call search_tool({ ic_number: "1234567890" })
→ Analyze output: patient found, get patient_id
AI: Found your information. Before I get your queue number, let me ask a few more questions. When was your last check-up? And is there anything specific you want to check? (use language that patient is using)
User: 6 months ago, want check blood pressure
→ MUST call describe_table("queues") to verify queue attributes
→ MUST call queue_tool({
  patient_id: 123,
  triage: "blue",
  symptoms: "routine check-up, blood pressure check",
  triage_logic: "routine check-up, no specific symptoms"
})
→ Analyze output: queue number assigned successfully
AI: Your queue number is Q1234. Please wait in the waiting area. (use language that patient is using)
→ MUST call describe_table("summaries") to verify summary attributes
→ MUST call summary_tool({
  conversation: "patient came for routine check-up, specifically for blood pressure check",
  triage: "blue",
  symptoms: "routine check-up"
})
AI: Before you go, may I ask how was our service today? (use language that patient is using)
User: good, staff very friendly
→ Analyze feedback: feedback given, record it
→ MUST call describe_table("feedbacks") to verify feedback attributes
→ MUST call feedback_tool({
  patient_id: 123,
  feedback: "good, staff very friendly"
})
AI: Thank you for your feedback. See you again! (use language that patient is using)

📌 Registration Example:
AI: For registration I need some information: (use language that patient is using)
1. Full name?
2. Age?
3. Gender (male/female)?
4. Race (malay/chinese/indian/other/foreigner)?
5. Phone number?
6. Do you have IC or passport?

User: name is ali, age 25, male, malay, 0123456789, have IC 1234567890
→ MUST call describe_table("patients") to verify registration fields
→ MUST call register_tool({
  full_name: "ali",
  age: 25,
  gender: "male",
  race: "malay",
  phone: "0123456789",
  ic_number: "1234567890"
})
→ Analyze output: registration successful
→ MUST call search_tool({ ic_number: "1234567890" })
→ Analyze output: patient found, get patient_id
AI: Thank you Mr Ali. Your information has been registered successfully. (use language that patient is using)

🤖 Tool Rules

Always use describe_table(...) to get real schema
Never hardcode field names
Always handle failures naturally — never show "error"
NEVER output tool code or <tool_code> tags
ALWAYS use the tools directly via the tool API
NEVER show the backend implementation or code
NEVER output any code or technical details to the user
NEVER show tool function calls or parameters to the user
NEVER show any system messages or technical information
NEVER show any error messages or technical details
NEVER show any backend implementation details
NEVER show any API calls or technical information
NEVER show any tool usage or technical details
NEVER show any system information or technical details
NEVER show any implementation details or technical information
NEVER show any backend code or technical details
NEVER show any API implementation or technical details
NEVER show any tool implementation or technical details
NEVER show any system implementation or technical details
NEVER show any implementation details or technical information
NEVER show any backend details or technical information
NEVER show any API details or technical information
NEVER show any tool details or technical information
NEVER show any system details or technical information

---

IMPORTANT: 
- ALWAYS be proactive. Do not wait for the user to say 'ok', 'proceed', or give permission to continue. If you have all the information you need, immediately proceed to the next step in the workflow and call the required tool. Only ask for information if it is missing.
- ALWAYS follow the workflow steps in order, without skipping or reordering. After each tool call, immediately proceed to the next required tool or question, unless you are missing required information.
- NEVER ask the user to confirm or say 'ok' before proceeding, unless you are missing required information.
- After triage_tool has been called once, do not call it again for the same visit.
- After every tool call, always explain your next step or reasoning in a short, clear message before continuing.
`;

  // Add system prompt to history only if not present
  if (!history.length || history[0].sender !== 'system') {
    history.unshift({ sender: 'system', text: systemPrompt });
  }

  let geminiMessages = [
    ...history.map((msg: { sender: string, text: string }) => ({ text: msg.text })),
  ];

  // Only add currentMessageText if it's not already the last message in history
  if (
    currentMessageText &&
    typeof currentMessageText === 'string' &&
    (history.length === 0 || history[history.length - 1].text !== currentMessageText)
  ) {
    geminiMessages.push({ text: currentMessageText });
  }

  // Log conversation history in a structured way (excluding system prompt)
  logConversationHistory({ history });

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
  const customFunctionDeclarations: FunctionDeclaration[] = tools.map(harmonizeCustomTool);
  const allFunctionDeclarations: FunctionDeclaration[] = [...mcpFunctionDeclarations, ...customFunctionDeclarations];

  // Before every ai.models.generateContent call, filter out any null/undefined text
  const filteredGeminiMessages = geminiMessages.filter(m => typeof m.text === 'string' && m.text !== null && m.text !== undefined);
  let response;
  try {
    console.log('--- Sending request to Gemini API ---');
    response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-04-17",
    contents: filteredGeminiMessages,
    config: {
      tools: [{ functionDeclarations: allFunctionDeclarations }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.AUTO
        }
      }
      }
    });
    console.log('--- Received response from Gemini API ---');
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return NextResponse.json({ 
      result: 'sorry, i am having trouble processing your request right now. please try again in a moment.',
      error: 'Gemini API error'
    }, { status: 500 });
  }

  let resultText = '';
  let toolUsed = false;
  let toolCalls = 0;
  let toolName: string | undefined = undefined;
  let toolOutput: string | undefined = undefined;
  let toolOutputs: string[] = [];
  let triageLevel: string | undefined = undefined;

  // After Gemini response, append AI message to history
  if (response.text && response.text.trim() !== '') {
    history.push({ sender: 'ai', text: response.text.trim() });
  }

  // Tool calling loop
  while (response.functionCalls && response.functionCalls.length > 0 && toolCalls < MAX_CHUNKS) {
    toolUsed = true;
    toolCalls++;
    const functionCall = response.functionCalls[0];
    toolName = functionCall.name;
    let result: any;
    try {
      const toolNameStr = typeof functionCall.name === 'string' ? functionCall.name : '';
      // Append tool used to history
      history.push({ sender: 'tool used', text: `${toolNameStr} ${JSON.stringify(functionCall.args || {})}`, meta: { toolName: toolNameStr, args: functionCall.args || {} } });
      if (toolNames.includes(toolNameStr)) {
        result = await handleToolCall(toolNameStr, functionCall.args || {});
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
    toolOutput = chunk;
    toolOutputs.push(toolOutput);
    // If triage_tool, parse triage_level
    if (functionCall.name === 'triage_tool') {
      try {
        const triageObj = JSON.parse(fetchedText);
        if (triageObj && triageObj.triage) {
          triageLevel = triageObj.triage;
        }
      } catch {}
    }
    geminiMessages.push({ text: `Tool response for ${functionCall.name}: ${chunk}` });
    // Append tool output to history
    history.push({ sender: 'tool output', text: toolOutput, meta: { toolName: functionCall.name, output: toolOutput } });
    // Only after tool output, generate and append AI thought/analysis
    let aiThought = generateAIThought(functionCall.name, toolOutput);
    history.push({ sender: 'ai thought', text: aiThought });
    // System message reminder
    history.push({ sender: 'system', text: 'You have completed the previous step. If you have all required information, immediately proceed to the next step in the workflow and call the next tool as per the system prompt. Do not wait for user permission.' });
    // Log messages sent back to Gemini after tool call (excluding system prompt)
    logConversationHistory({ history });
    const filteredGeminiMessagesLoop = geminiMessages.filter(m => typeof m.text === 'string' && m.text !== null && m.text !== undefined);
    try {
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
        }
      });
    } catch (error) {
      break; // Exit the loop if we get an error
    }
    // After Gemini response, append AI message to history
    if (response.text && response.text.trim() !== '') {
      history.push({ sender: 'ai', text: response.text.trim() });
    }
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

  // Log final result and all tool outputs
  console.log('--- Final AI Result ---');
  console.log('Result text:', resultText);
  console.log('Tool used:', toolUsed);
  console.log('Tool calls:', toolCalls);
  console.log('Tool name:', toolName);
  console.log('Tool output:', toolOutput);
  console.log('All tool outputs:', toolOutputs);
  console.log('Triage level:', triageLevel);

  return NextResponse.json({ 
    result: resultText, 
    toolUsed, 
    toolCalls, 
    toolName: toolCalls > 0 ? toolName : undefined, 
    toolOutput: toolOutputs.length > 0 ? toolOutputs[toolOutputs.length -1] : undefined, 
    toolOutputs,
    triageLevel,
    history // return the full chat history
  });
} 
import { getDb } from './data';
import { GoogleGenAI } from '@google/genai';

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Triage Tool
export async function triage_tool(input: { symptoms: string }) {
  try {
    const result = await genAI.models.generateContent({
      model: 'gemini-2.5-flash-preview-05-20',
      contents: [{
        text: `You are a medical triage expert in a Malaysian government hospital. Analyze these symptoms and determine the appropriate triage level (red, yellow, green, or blue) and provide clinical reasoning.

Symptoms: ${input.symptoms}

ONLY output the following JSON object in english, and nothing else:
{
  "triage": "red/yellow/green/blue",
  "logic": "detailed clinical reasoning"
}

Triage Levels:

🔴 RED (Immediate - Life Threatening):
- Respiratory:
  * Severe difficulty breathing
  * Respiratory rate > 30/min
  * Oxygen saturation < 90%
  * Severe chest pain with breathing difficulty
  * Choking or airway obstruction
- Cardiovascular:
  * Severe chest pain radiating to arm/jaw
  * Heart rate > 150 or < 40
  * Systolic BP < 90 or > 200
  * Sudden severe weakness/numbness (stroke symptoms)
- Neurological:
  * Sudden severe weakness/numbness
  * Sudden severe speech problems
  * Sudden severe vision problems
  * Seizures with post-ictal state
  * Severe head injury with loss of consciousness
- Other:
  * Severe bleeding (uncontrolled)
  * Severe burns (>20% body surface)
  * Severe trauma
  * Severe allergic reaction with breathing difficulty
  * Severe dehydration with altered consciousness

🟡 YELLOW (Urgent - Within 30 minutes):
- Respiratory:
  * Moderate difficulty breathing
  * Respiratory rate 20-30/min
  * Oxygen saturation 90-95%
  * Moderate chest pain
- Cardiovascular:
  * Moderate chest pain
  * Heart rate 120-150 or 40-50
  * Systolic BP 90-100 or 160-200
- Neurological:
  * Moderate head injury (no loss of consciousness)
  * Severe headache with vomiting
  * Severe dizziness with inability to stand
  * Altered mental status
- Other:
  * Moderate bleeding (controlled)
  * Moderate burns (10-20% body surface)
  * High fever (>39°C) with other symptoms
  * Severe pain (7-8/10)
  * Severe dehydration
  * Severe vomiting/diarrhea
  * Recent head injury with vomiting

🟢 GREEN (Non-urgent - Within 2 hours):
- Respiratory:
  * Mild difficulty breathing
  * Respiratory rate < 20/min
  * Oxygen saturation > 95%
  * Mild chest pain
- Cardiovascular:
  * Mild chest pain
  * Heart rate 50-120
  * Systolic BP 100-160
- Neurological:
  * Mild to moderate headache
  * Mild dizziness
  * Mild head injury (no vomiting)
- Other:
  * Mild bleeding
  * Mild burns (<10% body surface)
  * Mild to moderate pain (4-6/10)
  * Mild fever (<39°C)
  * Mild dehydration
  * Mild vomiting/diarrhea

🔵 BLUE (Routine - Within 4 hours):
- Regular check-ups
- Medication refills
- Minor injuries
- Stable chronic conditions
- No acute symptoms

Special Considerations:
1. Age Factors:
   - Children < 2 years: Upgrade one level
   - Elderly > 65 years: Upgrade one level
   - Pregnant women: Upgrade one level

2. Vital Signs:
   - Temperature > 39°C: Consider yellow
   - Heart Rate > 120 or < 50: Consider yellow
   - Blood Pressure < 100/60 or > 160/100: Consider yellow
   - Respiratory Rate > 20: Consider yellow
   - Oxygen Saturation < 95%: Consider yellow

3. Pain Scale:
   - 7-10/10: Consider yellow
   - 4-6/10: Consider green
   - 1-3/10: Consider blue

4. NEVER classify as red:
   - Headache alone (even severe)
   - Dizziness alone
   - Fever alone
   - Vomiting/diarrhea alone
   - Pain alone (unless severe chest pain)

5. Always upgrade one level if:
   - Multiple symptoms present
   - Symptoms worsening
   - Patient appears very distressed
   - Patient has difficulty communicating
   - Patient has mobility issues

Base your decision on:
1. Severity of symptoms
2. Vital signs (if mentioned)
3. Age and special conditions
4. Number and combination of symptoms
5. Patient's ability to wait
6. Available resources

Remember: 
- The input may be in a simple format with symptoms separated by + or other separators
- Analyze the combination of symptoms rather than individual symptoms
- Consider age, vital signs, and special conditions
- If unsure, classify as yellow for safety
- NEVER classify headache alone as red level
- If headache is present with other red-level symptoms, classify based on the other symptoms`
      }]
    });
    
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    
    console.log('Raw Gemini response:', text);
    
    // Extract JSON from the response using regex
    const match = text.match(/\{[\s\S]*\}/);
    let analysis;
    if (match) {
      try {
        analysis = JSON.parse(match[0]);
      } catch (parseError) {
        console.error('Failed to parse extracted JSON response:', parseError);
        throw new Error('Invalid response format from AI model');
      }
    } else {
      console.error('No JSON object found in Gemini response:', text);
      throw new Error('No JSON object found in AI model response');
    }

    // Validate required fields
    if (!analysis.triage || !analysis.logic) {
      console.error('Missing required fields in response:', analysis);
      throw new Error('Incomplete response from AI model');
    }

    // Ensure triage level is valid
    const validTriageLevels = ['red', 'yellow', 'green', 'blue'];
    if (!validTriageLevels.includes(analysis.triage.toLowerCase())) {
      console.error('Invalid triage level:', analysis.triage);
      throw new Error('Invalid triage level in response');
    }

    return {
      triage: analysis.triage.toLowerCase(),
      logic: analysis.logic
    };
  } catch (error) {
    console.error('Error in triage analysis:', error);
    // Return a more helpful error message
    return {
      triage: 'yellow',
      logic: 'Please provide more details about your symptoms for proper triage assessment.'
    };
  }
}

// Search Tool
export async function search_tool(input: { ic_number?: string; passport_number?: string }) {
  const db = await getDb();
  let patient = null;

  try {
    if (input.ic_number) {
      patient = await db.get('SELECT * FROM patients WHERE ic_number = ?', input.ic_number);
    } else if (input.passport_number) {
      patient = await db.get('SELECT * FROM patients WHERE passport_number = ?', input.passport_number);
    }

    if (patient) {
      // Update last_attended
      await db.run(
        'UPDATE patients SET last_attended = CURRENT_TIMESTAMP WHERE id = ?',
        patient.id
      );
      await db.close();
      return {
        status: 'found',
        patient: patient
      };
    } else {
      await db.close();
      return {
        status: 'not_found',
        message: 'No patient found with the provided details'
      };
    }
  } catch (error) {
    await db.close();
    throw error;
  }
}

// Register Tool
export async function register_tool(input: {
  ic_number?: string;
  passport_number?: string;
  full_name: string;
  age: number;
  gender: 'male' | 'female';
  race: 'malay' | 'chinese' | 'indian' | 'other' | 'foreigner';
  phone: string;
}) {
  const db = await getDb();
  
  try {
    const result = await db.run(
      `INSERT INTO patients (
        ic_number, passport_number, full_name, age, gender, race, phone
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.ic_number,
        input.passport_number,
        input.full_name,
        input.age,
        input.gender,
        input.race,
        input.phone
      ]
    );

    await db.close();
    return {
      status: 'registered',
      patient_id: result.lastID
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}

// Queue Tool
export async function queue_tool(input: { patient_id: number; triage: string; symptoms: string; triage_logic: string }) {
  const db = await getDb();
  
  try {
    // Get available doctors with their names
    const doctors = await db.all(
      'SELECT id, full_name FROM staff WHERE role = ? AND is_available = 1',
      ['doctor']
    );

    if (doctors.length === 0) {
      throw new Error('No available doctors');
    }

    // Simple round-robin assignment
    const doctor = doctors[Math.floor(Math.random() * doctors.length)];

    // Generate queue number (format: Q + timestamp)
    const queue_number = 'Q' + Date.now().toString().slice(-4);

    // Insert into queue with symptoms and triage_logic
    const result = await db.run(
      `INSERT INTO queues (
        patient_id, queue_number, triage_level, symptoms, triage_logic, assigned_doctor_id
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [input.patient_id, queue_number, input.triage, input.symptoms, input.triage_logic, doctor.id]
    );

    await db.close();
    return {
      queue_number,
      doctor_id: doctor.id,
      doctor_name: doctor.full_name,
      queue_id: result.lastID
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}

// Summary Tool
export async function summary_tool(input: {
  conversation: string;
  triage: string;
  symptoms: string;
  queue_id?: number;
}) {
  const db = await getDb();
  
  try {
    // Get the most recent queue_id if not provided
    let queue_id = input.queue_id;
    if (!queue_id) {
      const latestQueue = await db.get(
        'SELECT id FROM queues ORDER BY created_at DESC LIMIT 1'
      );
      if (!latestQueue) {
        throw new Error('No queue found to link summary');
      }
      queue_id = latestQueue.id;
    }

    // Verify the queue exists
    const queue = await db.get(
      'SELECT id FROM queues WHERE id = ?',
      [queue_id]
    );

    if (!queue) {
      throw new Error(`Queue with ID ${queue_id} not found`);
    }

    // Generate a structured summary
    const summary = `
Triage Level: ${input.triage}
Presenting Symptoms: ${input.symptoms}

Clinical Notes:
${input.conversation}

Assessment:
- Patient presented with ${input.symptoms}
- Triage level: ${input.triage}
- ${input.conversation}

Plan:
- Monitor patient condition
- Follow up as needed
`.trim();

    // Insert the summary into the database
    await db.run(
      'INSERT INTO summaries (queue_id, summary_text) VALUES (?, ?)',
      [queue_id, summary]
    );

    await db.close();
    return {
      status: 'recorded',
      summary: summary
    };
  } catch (error) {
    await db.close();
    console.error('Error in summary_tool:', error);
    throw error;
  }
}

// Feedback Tool
export async function feedback_tool(input: { patient_id: number; feedback: string }) {
  const db = await getDb();
  
  try {
    await db.run(
      'INSERT INTO feedbacks (patient_id, feedback_text) VALUES (?, ?)',
      [input.patient_id, input.feedback]
    );

    await db.close();
    return { status: 'recorded' };
  } catch (error) {
    await db.close();
    throw error;
  }
} 
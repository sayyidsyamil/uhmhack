import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'lib', 'clinic.db');

async function getDb() {
  return open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });
}

export async function initializeDatabase() {
  const db = await getDb();
  
  // Create patients table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ic_number TEXT UNIQUE,
      passport_number TEXT UNIQUE,
      full_name TEXT NOT NULL,
      age INTEGER,
      gender TEXT CHECK(gender IN ('male', 'female')),
      race TEXT CHECK(race IN ('malay', 'chinese', 'indian', 'other', 'foreigner')) NOT NULL,
      phone TEXT,
      last_attended DATETIME,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (ic_number IS NOT NULL AND passport_number IS NULL) OR
        (ic_number IS NULL AND passport_number IS NOT NULL)
      )
    )
  `);

  // Create staff table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      role TEXT CHECK(role IN ('nurse', 'doctor')) NOT NULL,
      is_available BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create queues table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS queues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      queue_number TEXT NOT NULL,
      triage_level TEXT CHECK(triage_level IN ('red', 'yellow', 'green', 'blue')) NOT NULL,
      symptoms TEXT NOT NULL,
      triage_logic TEXT,
      assigned_doctor_id INTEGER,
      status TEXT CHECK(status IN ('waiting', 'in_treatment', 'completed')) DEFAULT 'waiting',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (assigned_doctor_id) REFERENCES staff(id)
    )
  `);

  // Create summaries table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_id INTEGER NOT NULL,
      summary_text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (queue_id) REFERENCES queues(id)
    )
  `);

  // Create feedbacks table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      feedback_text TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )
  `);

  await db.close();
}

export async function populateSampleData() {
  const db = await getDb();

  // Clear all tables (respecting foreign key constraints)
  await db.exec('PRAGMA foreign_keys = OFF');
  await db.exec('DELETE FROM feedbacks');
  await db.exec('DELETE FROM summaries');
  await db.exec('DELETE FROM queues');
  await db.exec('DELETE FROM patients');
  await db.exec('DELETE FROM staff');
  await db.exec('PRAGMA foreign_keys = ON');
  
  // Insert staff members
  const staff = [
    { full_name: 'Dr. Ahmad bin Abdullah', role: 'doctor' },
    { full_name: 'Dr. Sarah Tan Mei Ling', role: 'doctor' },
    { full_name: 'Dr. Rajesh Kumar', role: 'doctor' },
    { full_name: 'Nurse Aisyah binti Ismail', role: 'nurse' },
    { full_name: 'Nurse Wong Li Wei', role: 'nurse' },
    { full_name: 'Nurse Priya Devi', role: 'nurse' }
  ];

  for (const member of staff) {
    await db.run(
      'INSERT INTO staff (full_name, role) VALUES (?, ?)',
      [member.full_name, member.role]
    );
  }

  // Insert patients
  const patients = [
    {
      ic_number: '900101-01-1234',
      passport_number: null,
      full_name: 'Mohammed bin Hassan',
      age: 45,
      gender: 'male',
      race: 'malay',
      phone: '012-3456789'
    },
    {
      ic_number: '880215-08-5678',
      passport_number: null,
      full_name: 'Lim Wei Chen',
      age: 35,
      gender: 'male',
      race: 'chinese',
      phone: '013-4567890'
    },
    {
      ic_number: null,
      passport_number: 'A12345678',
      full_name: 'John Smith',
      age: 28,
      gender: 'male',
      race: 'foreigner',
      phone: '014-5678901'
    },
    {
      ic_number: '950630-14-9012',
      passport_number: null,
      full_name: 'Aisha binti Abdullah',
      age: 27,
      gender: 'female',
      race: 'malay',
      phone: '015-6789012'
    },
    {
      ic_number: '920312-06-3456',
      passport_number: null,
      full_name: 'Priya Devi',
      age: 31,
      gender: 'female',
      race: 'indian',
      phone: '016-7890123'
    }
  ];

  for (const patient of patients) {
    await db.run(
      `INSERT INTO patients (
        ic_number, passport_number, full_name, age, gender, race, phone
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        patient.ic_number,
        patient.passport_number,
        patient.full_name,
        patient.age,
        patient.gender,
        patient.race,
        patient.phone
      ]
    );
  }

  // Get inserted IDs for relationships
  const doctors = await db.all('SELECT id FROM staff WHERE role = ?', ['doctor']);
  const patientsData = await db.all('SELECT id FROM patients');

  // Insert queue entries with different triage levels
  const queues = [
    {
      patient_id: patientsData[0].id,
      queue_number: 'Q001',
      triage_level: 'red',
      symptoms: 'Severe chest pain, difficulty breathing',
      triage_logic: 'Immediate attention required due to cardiac symptoms',
      assigned_doctor_id: doctors[0].id,
      status: 'completed'
    },
    {
      patient_id: patientsData[1].id,
      queue_number: 'Q002',
      triage_level: 'yellow',
      symptoms: 'High fever (39°C), severe headache',
      triage_logic: 'Urgent but not life-threatening',
      assigned_doctor_id: doctors[1].id,
      status: 'in_treatment'
    },
    {
      patient_id: patientsData[2].id,
      queue_number: 'Q003',
      triage_level: 'green',
      symptoms: 'Mild fever, sore throat',
      triage_logic: 'Non-urgent case',
      assigned_doctor_id: doctors[2].id,
      status: 'waiting'
    },
    {
      patient_id: patientsData[3].id,
      queue_number: 'Q004',
      triage_level: 'blue',
      symptoms: 'Routine check-up',
      triage_logic: 'Non-urgent case',
      assigned_doctor_id: doctors[0].id,
      status: 'waiting'
    }
  ];

  for (const queue of queues) {
    await db.run(
      `INSERT INTO queues (
        patient_id, queue_number, triage_level, symptoms, triage_logic,
        assigned_doctor_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        queue.patient_id,
        queue.queue_number,
        queue.triage_level,
        queue.symptoms,
        queue.triage_logic,
        queue.assigned_doctor_id,
        queue.status
      ]
    );
  }

  // Get queue IDs for summaries
  const queueData = await db.all('SELECT id FROM queues');

  // Insert summaries for completed cases
  const summaries = [
    {
      queue_id: queueData[0].id,
      summary_text: 'Patient presented with severe chest pain. ECG showed ST elevation. Administered aspirin and nitroglycerin. Transferred to cardiac unit for further management.'
    },
    {
      queue_id: queueData[1].id,
      summary_text: 'Patient with high fever and headache. Blood tests ordered. Started on antipyretics and IV fluids. Monitoring for signs of meningitis.'
    }
  ];

  for (const summary of summaries) {
    await db.run(
      'INSERT INTO summaries (queue_id, summary_text) VALUES (?, ?)',
      [summary.queue_id, summary.summary_text]
    );
  }

  // Insert feedback for completed cases
  const feedbacks = [
    {
      patient_id: patientsData[0].id,
      feedback_text: 'Very professional and quick response to my emergency. The staff was very caring and efficient.'
    },
    {
      patient_id: patientsData[1].id,
      feedback_text: 'Good service but waiting time could be improved. Doctor was very thorough in explaining my condition.'
    }
  ];

  for (const feedback of feedbacks) {
    await db.run(
      'INSERT INTO feedbacks (patient_id, feedback_text) VALUES (?, ?)',
      [feedback.patient_id, feedback.feedback_text]
    );
  }

  await db.close();
}

// Export the database connection function for use in other files
export { getDb }; 
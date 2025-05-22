import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/data';

export async function GET() {
  try {
    const db = await getDb();

    // Fetch total patients (assuming 'patients' table exists)
    const patientCountResult = await db.get("SELECT COUNT(*) as count FROM patients");
    const totalPatients = patientCountResult ? patientCountResult.count : 0;

    // Fetch total appointments (assuming 'appointments' table exists)
    const appointmentCountResult = await db.get("SELECT COUNT(*) as count FROM appointments");
    const totalAppointments = appointmentCountResult ? appointmentCountResult.count : 0;

    return NextResponse.json({
      totalPatients,
      totalAppointments,
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
  }
}
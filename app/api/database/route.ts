import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/data';

export async function GET() {
  try {
    const db = await getDb();
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table';");
    return NextResponse.json(tables);
  } catch (error) {
    console.error('Error fetching tables:', error);
    return NextResponse.json({ error: 'Failed to fetch tables' }, { status: 500 });
  }
}
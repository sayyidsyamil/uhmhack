import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/data';

export async function GET(request: Request, { params }: { params: { tableName: string } }) {
  const { tableName } = params;
  try {
    const db = await getDb();
    const data = await db.all(`SELECT * FROM ${tableName}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error(`Error fetching data for table ${tableName}:`, error);
    return NextResponse.json({ error: `Failed to fetch data for table ${tableName}` }, { status: 500 });
  }
}
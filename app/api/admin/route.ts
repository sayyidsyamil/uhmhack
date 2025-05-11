import { NextRequest, NextResponse } from 'next/server';
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

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get('table');
  try {
    const db = await getDb();
    if (!table) {
      // List all tables and their columns
      const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
      const result = [];
      for (const t of tables) {
        const columnsInfo = await db.all(`PRAGMA table_info(${t.name})`);
        result.push({
          table: t.name,
          columns: columnsInfo.map((c: any) => c.name)
        });
      }
      await db.close();
      return NextResponse.json({ tables: result });
    } else {
      // Return data and columns for the specified table
      const data = await db.all(`SELECT * FROM ${table}`);
      const columnsInfo = await db.all(`PRAGMA table_info(${table})`);
      const columns = columnsInfo.map((c: any) => c.name);
      await db.close();
      return NextResponse.json({ data, columns });
    }
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const table = req.nextUrl.searchParams.get('table');
  if (!table) return NextResponse.json({ error: 'Missing table' }, { status: 400 });
  const { row } = await req.json();
  try {
    const db = await getDb();
    const keys = Object.keys(row);
    const placeholders = keys.map(() => '?').join(',');
    await db.run(
      `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`,
      ...keys.map(k => row[k])
    );
    await db.close();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to add row' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const table = req.nextUrl.searchParams.get('table');
  if (!table) return NextResponse.json({ error: 'Missing table' }, { status: 400 });
  const { row } = await req.json();
  try {
    const db = await getDb();
    const columnsInfo = await db.all(`PRAGMA table_info(${table})`);
    const pkCol = columnsInfo.find((c: any) => c.pk === 1);
    if (!pkCol) return NextResponse.json({ error: 'No primary key' }, { status: 400 });
    const pk = pkCol.name;
    const keys = Object.keys(row).filter(k => k !== pk);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    await db.run(
      `UPDATE ${table} SET ${setClause} WHERE ${pk} = ?`,
      ...keys.map(k => row[k]), row[pk]
    );
    await db.close();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to update row' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const table = req.nextUrl.searchParams.get('table');
  if (!table) return NextResponse.json({ error: 'Missing table' }, { status: 400 });
  const { row } = await req.json();
  try {
    const db = await getDb();
    const columnsInfo = await db.all(`PRAGMA table_info(${table})`);
    // Find unique columns (pk or unique constraint)
    let uniqueCols = columnsInfo.filter((c: any) => c.pk === 1 || c.unique === 1).map((c: any) => c.name);
    // Fallback: try common unique columns
    if (!uniqueCols.includes('id') && columnsInfo.some((c: any) => c.name === 'id')) uniqueCols.push('id');
    if (!uniqueCols.includes('ic') && columnsInfo.some((c: any) => c.name === 'ic')) uniqueCols.push('ic');
    // Find the first unique column present in the row
    let colToUse = uniqueCols.find(col => row[col] !== undefined && row[col] !== null);
    if (!colToUse) {
      // Try any column with a value in the row
      colToUse = columnsInfo.map((c: any) => c.name).find(col => row[col] !== undefined && row[col] !== null);
    }
    if (!colToUse) {
      await db.close();
      return NextResponse.json({ error: 'No suitable column value found for deletion' }, { status: 400 });
    }
    await db.run(
      `DELETE FROM ${table} WHERE ${colToUse} = ?`,
      row[colToUse]
    );
    await db.close();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to delete row' }, { status: 500 });
  }
} 
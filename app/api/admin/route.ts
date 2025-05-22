import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { triage_tool, search_tool, register_tool, queue_tool, summary_tool, feedback_tool } from '@/lib/tools';

// Type definitions for request bodies
type TriageInput = { symptoms: string };
type SearchInput = { ic_number?: string; passport_number?: string };
type RegisterInput = {
  ic_number?: string;
  passport_number?: string;
  full_name: string;
  age: number;
  gender: 'male' | 'female';
  race: 'malay' | 'chinese' | 'indian' | 'other' | 'foreigner';
  phone: string;
};
type QueueInput = { patient_id: number; triage: string };
type SummaryInput = { 
  conversation: string; 
  triage: string; 
  symptoms: string;
  queue_id: number;
};
type FeedbackInput = { patient_id: number; feedback: string };

// Custom tools mapping
const customTools = {
  triage_tool,
  search_tool,
  register_tool,
  queue_tool,
  summary_tool,
  feedback_tool
};

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
    } else if (table === 'queues_with_patient') {
      // Return joined data for queues and patients
      const data = await db.all(`
        SELECT
          q.id,
          q.patient_id,
          q.queue_number,
          q.triage_level,
          q.symptoms,
          q.triage_logic,
          q.assigned_doctor_id,
          q.status,
          q.created_at,
          p.full_name
        FROM queues q
        JOIN patients p ON q.patient_id = p.id
      `);
      // Determine columns from the joined data structure
      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      await db.close();
      return NextResponse.json({ data, columns });
    }
    else {
      // Return data and columns for the specified table
      const data = await db.all(`SELECT * FROM ${table}`);
      const columnsInfo = await db.all(`PRAGMA table_info(${table})`);
      const columns = columnsInfo.map((c: any) => c.name);
      await db.close();
      return NextResponse.json({ data, columns });
    }
  } catch (e) {
    console.error('Error fetching data:', e);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action');
  if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 });

  try {
    const body = await req.json();
    const tool = customTools[action as keyof typeof customTools];
    
    if (!tool) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Type checking based on action
    let typedBody;
    switch (action) {
      case 'triage':
        typedBody = body as TriageInput;
        break;
      case 'search':
        typedBody = body as SearchInput;
        break;
      case 'register':
        typedBody = body as RegisterInput;
        break;
      case 'queue':
        typedBody = body as QueueInput;
        break;
      case 'summary':
        typedBody = body as SummaryInput;
        break;
      case 'feedback':
        typedBody = body as FeedbackInput;
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Type assertion for the tool function
    const typedTool = tool as (input: any) => Promise<any>;
    return NextResponse.json(await typedTool(typedBody));
  } catch (e) {
    console.error('Error in POST:', e);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const table = req.nextUrl.searchParams.get('table');
  if (!table) return NextResponse.json({ error: 'Missing table' }, { status: 400 });
  try {
    const db = await getDb();

    if (table === 'queues') {
      const { id, status } = await req.json() as { id: number; status: string };
      if (id === undefined || status === undefined) {
        await db.close();
        return NextResponse.json({ error: 'Missing id or status for queues update' }, { status: 400 });
      }
      await db.run(
        `UPDATE queues SET status = ? WHERE id = ?`,
        status, id
      );
    } else {
      // Existing generic update logic for other tables
      const { row } = await req.json() as { row: Record<string, any> };
      const columnsInfo = await db.all(`PRAGMA table_info(${table})`);
      const pkCol = columnsInfo.find((c: any) => c.pk === 1);
      if (!pkCol) {
        await db.close();
        return NextResponse.json({ error: 'No primary key' }, { status: 400 });
      }
      const pk = pkCol.name;
      const keys = Object.keys(row).filter(k => k !== pk);
      const setClause = keys.map(k => `${k} = ?`).join(', ');
      await db.run(
        `UPDATE ${table} SET ${setClause} WHERE ${pk} = ?`,
        ...keys.map(k => row[k]), row[pk]
      );
    }

    await db.close();
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('Error updating data:', e.message, e.stack);
    return NextResponse.json({ error: 'Failed to update row' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const table = req.nextUrl.searchParams.get('table');
  if (!table) return NextResponse.json({ error: 'Missing table' }, { status: 400 });

  let idToDelete: string | number | null = null;

  // Check for ID in query parameter first, especially for queues table
  if (table === 'queues') {
    const queryId = req.nextUrl.searchParams.get('id');
    if (queryId) {
      idToDelete = parseInt(queryId, 10); // Assuming ID is integer for queues
    }
  }

  let row: Record<string, any> = {};
  // If ID not found in query, try reading from body (for other tables)
  if (idToDelete === null) {
     try {
        row = await req.json() as { row: Record<string, any> };
     } catch (e) {
        // If parsing body fails and no query ID, then we can't proceed
        return NextResponse.json({ error: 'Missing row data or ID for deletion' }, { status: 400 });
     }
  }


  try {
    const db = await getDb();
    const columnsInfo = await db.all(`PRAGMA table_info(${table})`);

    let colToUse: string | undefined;
    let valueToUse: any;

    if (idToDelete !== null) {
        // Use the ID from the query parameter for queues
        colToUse = 'id';
        valueToUse = idToDelete;
    } else {
        // Find unique columns (pk or unique constraint) from body
        let uniqueCols = columnsInfo.filter((c: any) => c.pk === 1 || c.unique === 1).map((c: any) => c.name);
        // Fallback: try common unique columns
        if (!uniqueCols.includes('id') && columnsInfo.some((c: any) => c.name === 'id')) uniqueCols.push('id');
        if (!uniqueCols.includes('ic') && columnsInfo.some((c: any) => c.name === 'ic')) uniqueCols.push('ic');
        // Find the first unique column present in the row
        colToUse = uniqueCols.find(col => row[col] !== undefined && row[col] !== null);
        if (!colToUse) {
          // Try any column with a value in the row
          colToUse = columnsInfo.map((c: any) => c.name).find(col => row[col] !== undefined && row[col] !== null);
        }

        // Assign valueToUse only if colToUse is found
        if (colToUse) {
            valueToUse = row[colToUse];
        }
    }


    if (!colToUse || valueToUse === undefined || valueToUse === null) {
      await db.close();
      return NextResponse.json({ error: 'No suitable column value found for deletion' }, { status: 400 });
    }

    await db.run(
      `DELETE FROM ${table} WHERE ${colToUse} = ?`,
      valueToUse
    );
    await db.close();
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Error deleting data:', e);
    return NextResponse.json({ error: 'Failed to delete row' }, { status: 500 });
  }
}
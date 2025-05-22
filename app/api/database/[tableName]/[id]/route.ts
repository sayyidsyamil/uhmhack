import { NextResponse } from 'next/server';
import { getDb } from '../../../../../lib/data';

export async function DELETE(request: Request, { params }: { params: { tableName: string, id: string } }) {
  const { tableName, id } = params;
  try {
    const db = await getDb();
    // It's crucial to sanitize tableName and id to prevent SQL injection.
    // For simplicity, assuming id is a number and tableName is safe from previous checks.
    // In a real application, use prepared statements or a ORM.
    const result = await db.run(`DELETE FROM ${tableName} WHERE id = ?`, id);

    if (result.changes === 0) {
      return NextResponse.json({ error: `Record with ID ${id} not found in table ${tableName}` }, { status: 404 });
    }

    return NextResponse.json({ message: `Record with ID ${id} deleted successfully from table ${tableName}` });
  } catch (error) {
    console.error(`Error deleting record from table ${tableName} with ID ${id}:`, error);
    return NextResponse.json({ error: `Failed to delete record from table ${tableName}` }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { tableName: string, id: string } }) {
  const { tableName, id } = params;
  try {
    const db = await getDb();
    const body = await request.json();

    // Construct the SET part of the SQL query
    const columns = Object.keys(body);
    const setClause = columns.map(col => `${col} = ?`).join(', ');
    const values = Object.values(body);

    // Add the ID to the values for the WHERE clause
    values.push(id);

    const sql = `UPDATE ${tableName} SET ${setClause} WHERE id = ?`;
    const result = await db.run(sql, ...values);

    if (result.changes === 0) {
      return NextResponse.json({ error: `Record with ID ${id} not found in table ${tableName} or no changes were made` }, { status: 404 });
    }

    return NextResponse.json({ message: `Record with ID ${id} updated successfully in table ${tableName}` });
  } catch (error) {
    console.error(`Error updating record in table ${tableName} with ID ${id}:`, error);
    return NextResponse.json({ error: `Failed to update record in table ${tableName}` }, { status: 500 });
  }
}
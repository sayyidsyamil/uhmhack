"use client";
import React from 'react';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TableInfo {
  name: string;
}

const DatabasePage = () => {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});

  useEffect(() => {
    const fetchTables = async () => {
      try {
        const response = await fetch('/api/database');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setTables(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchTables();
  }, []);

  const fetchTableData = async (tableName: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/database/${tableName}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setTableData(data);
      setSelectedTable(tableName);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (tableName: string | null, row: any) => {
    if (!tableName) return;
    // Assuming the first key in the row is the ID
    const idKey = Object.keys(row)[0];
    const id = row[idKey];

    if (!confirm(`Are you sure you want to delete this record from ${tableName} with ID: ${id}?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/database/${tableName}/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Refresh table data after deletion
      fetchTableData(tableName);
      alert('Record deleted successfully!');
    } catch (err) {
      setError((err as Error).message);
      alert(`Failed to delete record: ${(err as Error).message}`);
    }
  };

  const handleEdit = async (tableName: string | null, row: any) => {
    if (!tableName) return;
    setEditingRow(row);
    setEditFormData(row); // Initialize form data with current row data
    setShowEditModal(true);
  };

  const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTable || !editingRow) return;

    const idKey = Object.keys(editingRow)[0]; // Assuming the first key is the ID
    const id = editingRow[idKey];

    try {
      const response = await fetch(`/api/database/${selectedTable}/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editFormData),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      alert('Record updated successfully!');
      setShowEditModal(false);
      fetchTableData(selectedTable); // Refresh data
    } catch (err) {
      setError((err as Error).message);
      alert(`Failed to update record: ${(err as Error).message}`);
    }
  };

  if (loading) return <div>Loading database information...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Database Overview</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Tables</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {tables.map((table: TableInfo) => (
                <li key={table.name} className="cursor-pointer hover:text-blue-500" onClick={() => fetchTableData(table.name)}>
                  {table.name}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{selectedTable ? `Data for ${selectedTable}` : 'Select a table to view data'}</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedTable && tableData.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.keys(tableData[0]).map((key) => (
                      <TableHead key={key}>{key}</TableHead>
                    ))}
                    <TableHead>Actions</TableHead> {/* New column for actions */}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableData.map((row, index) => (
                    <TableRow key={index}>
                      {Object.values(row).map((value, i) => (
                        <TableCell key={i}>{String(value)}</TableCell>
                      ))}
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(selectedTable, row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(selectedTable, row)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : selectedTable ? (
              <p>No data available for {selectedTable}.</p>
            ) : (
              <p>Click on a table name to display its contents.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Row in {selectedTable}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="grid gap-4 py-4">
            {editingRow && Object.keys(editingRow).map((key) => (
              <div key={key} className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor={key} className="text-right">
                  {key}
                </Label>
                <Input
                  id={key}
                  name={key}
                  value={editFormData[key] || ''}
                  onChange={handleEditFormChange}
                  className="col-span-3"
                  disabled={key === Object.keys(editingRow)[0]} // Disable editing the ID field
                />
              </div>
            ))}
            <DialogFooter>
              <Button type="submit">Save changes</Button>
              <Button variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DatabasePage;
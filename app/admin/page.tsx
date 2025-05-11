"use client";
import * as React from "react";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

export default function AdminDashboard() {
  const [tables, setTables] = useState<{ table: string; columns: string[] }[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editRow, setEditRow] = useState<any | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteRow, setDeleteRow] = useState<any | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addRow, setAddRow] = useState<any>({});
  const [refreshFlag, setRefreshFlag] = useState(0);

  // Fetch all tables and columns on mount
  useEffect(() => {
    fetch('/api/admin')
      .then(res => res.json())
      .then(res => {
        setTables(res.tables || []);
        if (res.tables && res.tables.length > 0) {
          setSelectedTable(res.tables[0].table);
        }
      });
  }, []);

  // Fetch table data when selectedTable changes
  useEffect(() => {
    if (!selectedTable) return;
    setLoading(true);
    setError(null);
    fetch(`/api/admin?table=${selectedTable}`)
      .then(res => res.json())
      .then(res => {
        setData(res.data || []);
        setColumns(res.columns || []);
      })
      .catch(() => setError("Failed to load data."))
      .finally(() => setLoading(false));
  }, [selectedTable, refreshFlag]);

  // Handlers
  const handleEdit = (row: any) => {
    setEditRow(row);
    setShowEdit(true);
  };
  const handleDelete = (row: any) => {
    setDeleteRow(row);
    setShowDelete(true);
  };
  const handleAdd = () => {
    setAddRow({});
    setShowAdd(true);
  };
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    await fetch(`/api/admin?table=${selectedTable}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: editRow })
    });
    setShowEdit(false);
    setRefreshFlag(f => f + 1);
  };
  const handleDeleteConfirm = async () => {
    setLoading(true);
    setError(null);
    await fetch(`/api/admin?table=${selectedTable}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: deleteRow })
    });
    setShowDelete(false);
    setRefreshFlag(f => f + 1);
  };
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    await fetch(`/api/admin?table=${selectedTable}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: addRow })
    });
    setShowAdd(false);
    setRefreshFlag(f => f + 1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-white p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-green-700">Healthcare Admin Dashboard</h1>
        <div className="flex gap-4 mb-6 flex-wrap">
          {tables.map(t => (
            <Button key={t.table} variant={selectedTable === t.table ? "default" : "secondary"} onClick={() => setSelectedTable(t.table)}>{t.table.replace(/_/g, ' ').toUpperCase()}</Button>
          ))}
        </div>
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>{selectedTable.replace(/_/g, ' ').toUpperCase()}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <div>Loading...</div>}
            {error && <Alert variant="destructive">{error}</Alert>}
            {!loading && !error && (
              <div className="overflow-x-auto">
                <table className="min-w-full border text-sm">
                  <thead>
                    <tr>
                      {columns.map(col => (
                        <th key={col} className="px-3 py-2 border-b bg-green-100 text-green-800 font-semibold">{col}</th>
                      ))}
                      <th className="px-3 py-2 border-b"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, i) => (
                      <tr key={i} className="hover:bg-green-50">
                        {columns.map(col => (
                          <td key={col} className="px-3 py-2 border-b">{row[col]}</td>
                        ))}
                        <td className="px-3 py-2 border-b flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleEdit(row)}>Edit</Button>
                          <Button size="sm" variant="destructive" onClick={() => handleDelete(row)}>Delete</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button onClick={handleAdd}>Add New</Button>
          </CardFooter>
        </Card>

        {/* Edit Dialog */}
        <Dialog open={showEdit} onOpenChange={setShowEdit}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit {selectedTable.replace(/_/g, ' ')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
              {columns.map(col => (
                <div key={col}>
                  <Label htmlFor={`edit-${col}`}>{col}</Label>
                  <Input id={`edit-${col}`} value={editRow?.[col] ?? ''} onChange={e => setEditRow((r: any) => ({ ...r, [col]: e.target.value }))} />
                </div>
              ))}
              <DialogFooter className="flex gap-2 mt-2">
                <Button type="submit">Save</Button>
                <Button type="button" variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Add Dialog */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add to {selectedTable.replace(/_/g, ' ')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
              {columns.map(col => (
                <div key={col}>
                  <Label htmlFor={`add-${col}`}>{col}</Label>
                  <Input id={`add-${col}`} value={addRow?.[col] ?? ''} onChange={e => setAddRow((r: any) => ({ ...r, [col]: e.target.value }))} />
                </div>
              ))}
              <DialogFooter className="flex gap-2 mt-2">
                <Button type="submit">Add</Button>
                <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog open={showDelete} onOpenChange={setShowDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete from {selectedTable.replace(/_/g, ' ')}</DialogTitle>
            </DialogHeader>
            <div className="mb-4">Are you sure you want to delete this record?</div>
            <pre className="bg-gray-100 rounded p-2 text-xs overflow-x-auto mb-2">{JSON.stringify(deleteRow, null, 2)}</pre>
            <DialogFooter className="flex gap-2 mt-2">
              <Button variant="destructive" onClick={handleDeleteConfirm}>Delete</Button>
              <Button variant="secondary" onClick={() => setShowDelete(false)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
} 
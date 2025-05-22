"use client";

// Trigger recompile
import * as React from "react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion, AnimatePresence } from "framer-motion";

interface QueueItem {
  id: UniqueIdentifier;
  patient_id: number;
  queue_number: string;
  triage_level: string;
  symptoms: string;
  triage_logic: string | null;
  assigned_doctor_id: number | null;
  status: "waiting" | "in_treatment" | "completed";
  created_at: string;
  full_name: string; // Assuming patient name is joined
}

interface Column {
  id: "waiting" | "in_treatment" | "completed";
  title: string;
  items: QueueItem[];
}

function SortableItem({ item, onDelete }: { item: QueueItem; onDelete: (item: QueueItem) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault(); // Prevent default browser context menu
    onDelete(item);
  };

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="mb-3 cursor-grab active:cursor-grabbing"
      layoutId={`queue-card-${item.id}`}
      onContextMenu={handleContextMenu} // Add right-click handler
    >
      <Card className="bg-white shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="p-3 border-b">
          <CardTitle className="text-sm font-semibold">{item.queue_number} - {item.full_name}</CardTitle>
        </CardHeader>
        <CardContent className="p-3 text-xs text-gray-600">
          <p>Triage: <span className={`font-medium ${item.triage_level === 'red' ? 'text-red-600' : item.triage_level === 'yellow' ? 'text-yellow-600' : item.triage_level === 'green' ? 'text-green-600' : 'text-blue-600'}`}>{item.triage_level.toUpperCase()}</span></p>
          <p className="mt-1">{item.symptoms}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ColumnContainer({ id, title, items, onDelete }: Column & { onDelete: (item: QueueItem) => void }) {
  return (
    <div className="w-full md:w-1/3 lg:w-1/4 px-2 flex flex-col">
      <h2 className={`text-lg font-semibold mb-4 text-green-700`}>{title}</h2>
      <div className={`flex-grow p-3 rounded-md bg-green-50`}>
        <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
          <AnimatePresence>
            {items.map(item => (
              <SortableItem key={item.id} item={item} onDelete={onDelete} />
            ))}
          </AnimatePresence>
        </SortableContext>
      </div>
    </div>
  );
}

export default function AdminKanban() {
  const [columns, setColumns] = useState<Column[]>([]);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<QueueItem | null>(null);


  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    fetchQueueData();
  }, []);

  const fetchQueueData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin?table=queues_with_patient'); // Assuming a new endpoint or modification to fetch joined data
      if (!res.ok) throw new Error('Failed to fetch queue data');
      const data = await res.json();

      const queues: QueueItem[] = data.data.map((item: any) => ({
        ...item,
        id: item.id, // Ensure id is UniqueIdentifier
      }));

      setColumns([
        { id: "waiting", title: "Waiting", items: queues.filter(item => item.status === "waiting") },
        { id: "in_treatment", title: "In Treatment", items: queues.filter(item => item.status === "in_treatment") },
        { id: "completed", title: "Completed", items: queues.filter(item => item.status === "completed") },
      ]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (item: QueueItem) => {
    setItemToDelete(item);
    setShowDeleteConfirm(true);
  };

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      setActiveId(null);
      return;
    }

    const activeColumnId = findColumnForItemId(active.id);
    const overColumnId = findColumnForItemId(over.id);

    if (!activeColumnId || !overColumnId) {
      setActiveId(null);
      return;
    }

    const activeColumn = columns.find(col => col.id === activeColumnId);
    const overColumn = columns.find(col => col.id === overColumnId);

    if (!activeColumn || !overColumn) {
      setActiveId(null);
      return;
    }

    const activeIndex = activeColumn.items.findIndex(item => item.id === active.id);
    const overIndex = overColumn.items.findIndex(item => item.id === over.id);

    // Handle movement within the same column
    if (activeColumnId === overColumnId) {
      const newItems = arrayMove(activeColumn.items, activeIndex, overIndex);
      const newColumns = columns.map(col =>
        col.id === activeColumnId ? { ...col, items: newItems } : col
      );
      setColumns(newColumns);
    } else {
      // Handle movement between columns
      const itemToMove = activeColumn.items[activeIndex];

      const newColumns = columns.map(col => {
        if (col.id === activeColumnId) {
          return { ...col, items: col.items.filter(item => item.id !== active.id) };
        } else if (col.id === overColumnId) {
          const updatedItem = { ...itemToMove, status: overColumnId as "waiting" | "in_treatment" | "completed" };
          const itemsInOverColumn = [...col.items];
          itemsInOverColumn.splice(overIndex, 0, updatedItem);
          return { ...col, items: itemsInOverColumn };
        }
        return col;
      });
      setColumns(newColumns);

      // Call API to update status
      try {
        await fetch(`/api/admin?table=queues`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: itemToMove.id, status: overColumnId }),
        });
      } catch (err) {
        console.error("Failed to update status:", err);
        // Optionally revert the UI change if update fails
        fetchQueueData(); // Re-fetch data to sync state
      }
    }

    setActiveId(null);
  };

  const findColumnForItemId = (id: UniqueIdentifier) => {
    for (const column of columns) {
      if (column.items.find(item => item.id === id)) {
        return column.id;
      }
    }
    return null;
  };

  const handleConfirmDelete = async () => {
    if (!itemToDelete) return;

    try {
      const res = await fetch(`/api/admin?table=queues&id=${itemToDelete.id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error('Failed to delete item');

      // Remove item from the frontend state
      setColumns(prevColumns =>
        prevColumns.map(col => ({
          ...col,
          items: col.items.filter(item => item.id !== itemToDelete.id),
        }))
      );

    } catch (err) {
      console.error("Failed to delete item:", err);
      setError("Failed to delete item.");
      fetchQueueData(); // Re-fetch data to sync state
    } finally {
      setShowDeleteConfirm(false);
      setItemToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setItemToDelete(null);
    // No need to fetchQueueData here, as item wasn't removed from UI on right-click
  };


  const activeItem = activeId ? columns.flatMap(col => col.items).find(item => item.id === activeId) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-white p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-green-700">Queue Management Kanban Board</h1>
        {loading && <div>Loading...</div>}
        {error && <div className="text-red-600">Error: {error}</div>}
        {!loading && !error && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex flex-col md:flex-row gap-4">
              {columns.map(column => (
                <ColumnContainer key={column.id} id={column.id} title={column.title} items={column.items} onDelete={handleDelete} />
              ))}
            </div>
            <DragOverlay>
              {activeId && activeItem ? (
                <Card className="bg-white shadow-lg">
                   <CardHeader className="p-3 border-b">
                      <CardTitle className="text-sm font-semibold">{activeItem.queue_number} - {activeItem.full_name}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 text-xs text-gray-600">
                      <p>Triage: <span className={`font-medium ${activeItem.triage_level === 'red' ? 'text-red-600' : activeItem.triage_level === 'yellow' ? 'text-yellow-600' : activeItem.triage_level === 'green' ? 'text-green-600' : 'text-blue-600'}`}>{activeItem.triage_level.toUpperCase()}</span></p>
                      <p className="mt-1">{activeItem.symptoms}</p>
                    </CardContent>
                </Card>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
            </DialogHeader>
            <div className="mb-4">Are you sure you want to delete this queue item?</div>
            {itemToDelete && (
              <Card className="mb-4">
                 <CardHeader className="p-3 border-b">
                    <CardTitle className="text-sm font-semibold">{itemToDelete.queue_number} - {itemToDelete.full_name}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 text-xs text-gray-600">
                    <p>Triage: <span className={`font-medium ${itemToDelete.triage_level === 'red' ? 'text-red-600' : itemToDelete.triage_level === 'yellow' ? 'text-yellow-600' : itemToDelete.triage_level === 'green' ? 'text-green-600' : 'text-blue-600'}`}>{itemToDelete.triage_level.toUpperCase()}</span></p>
                    <p className="mt-1">{itemToDelete.symptoms}</p>
                  </CardContent>
              </Card>
            )}
            <DialogFooter className="flex gap-2 mt-2">
              <Button variant="destructive" onClick={handleConfirmDelete}>Delete</Button>
              <Button variant="secondary" onClick={handleCancelDelete}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
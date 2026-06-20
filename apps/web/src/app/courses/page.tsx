"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus, BookOpen } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function CoursesPage() {
  const { data, mutate, isLoading } = useSWR("courses", () => api.listCourses());
  const courses = data?.courses ?? [];
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await api.createCourse({ title, summary: summary || undefined });
      await mutate();
      setTitle(""); setSummary("");
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Courses"
        description="All your content — uploaded material, modules, lessons, beats."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4" />New course</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a course</DialogTitle>
                <DialogDescription>You'll be able to upload material right after.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="title">Title</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Intro to game theory" />
                </div>
                <div>
                  <Label htmlFor="summary">Summary (optional)</Label>
                  <Textarea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={create} disabled={creating || !title.trim()}>
                    {creating ? "Creating…" : "Create"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        }
      />
      <PageBody>
        {isLoading ? (
          <p className="text-sm text-[var(--color-muted)]">Loading…</p>
        ) : courses.length === 0 ? (
          <Card className="p-12 text-center">
            <BookOpen className="w-10 h-10 mx-auto mb-3 text-[var(--color-muted)]" />
            <p className="font-semibold mb-1">No courses yet</p>
            <p className="text-sm text-[var(--color-muted)] mb-6">Create one to start uploading material.</p>
            <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4" />New course</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.map((c) => (
              <Link key={c.id} href={`/courses/${c.id}`}>
                <Card className="p-6 hover:border-[var(--color-ink)] transition-colors cursor-pointer">
                  <h3 className="font-semibold mb-2 line-clamp-2">{c.title}</h3>
                  {c.summary && <p className="text-sm text-[var(--color-muted)] line-clamp-3">{c.summary}</p>}
                  <p className="text-xs text-[var(--color-muted)] mt-4">
                    updated {new Date(c.updatedAt).toLocaleDateString()}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PageBody>
    </AppShell>
  );
}

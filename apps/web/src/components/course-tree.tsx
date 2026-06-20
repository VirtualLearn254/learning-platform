"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen, BookOpen, FileText } from "lucide-react";
import Link from "next/link";
import type { CourseTreeResponse } from "@/lib/api";
import { cn } from "@/lib/cn";
import { StageBadge } from "@/components/stage-badge";

export function CourseTree({ tree }: { tree: CourseTreeResponse }) {
  return (
    <div className="space-y-1">
      {tree.sections.length === 0 && (
        <p className="text-sm text-[var(--color-muted)] py-12 text-center">
          No content yet. Upload course material to start.
        </p>
      )}
      {tree.sections.map((section) => (
        <TreeNode
          key={section.id}
          icon={Folder}
          openIcon={FolderOpen}
          label={section.title}
          subtitle={`${section.modules.length} module${section.modules.length !== 1 ? "s" : ""}`}
          defaultOpen
        >
          {section.modules.map((moduleRow) => (
            <TreeNode
              key={moduleRow.id}
              icon={Folder}
              openIcon={FolderOpen}
              label={moduleRow.title}
              subtitle={`${moduleRow.lessons.length} lesson${moduleRow.lessons.length !== 1 ? "s" : ""}`}
              defaultOpen
              depth={1}
            >
              {moduleRow.lessons.map((lesson) => (
                <TreeNode
                  key={lesson.id}
                  icon={BookOpen}
                  label={lesson.title}
                  subtitle={`${lesson.beats.length} beat${lesson.beats.length !== 1 ? "s" : ""}`}
                  depth={2}
                  href={`/lessons/${lesson.id}`}
                >
                  {lesson.beats.map((beat) => (
                    <Link
                      key={beat.id}
                      href={`/beats/${beat.id}`}
                      className="flex items-center gap-3 px-3 py-1.5 ml-12 rounded hover:bg-[var(--color-bg)] transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 text-[var(--color-muted)]" />
                      <span className="font-mono text-xs text-[var(--color-muted)]">{beat.beatKey}</span>
                      <span className="text-sm flex-1 truncate">{beat.script.slice(0, 60)}…</span>
                      <StageBadge stage={beat.stage} />
                    </Link>
                  ))}
                </TreeNode>
              ))}
            </TreeNode>
          ))}
        </TreeNode>
      ))}
    </div>
  );
}

interface TreeNodeProps {
  label: string;
  subtitle?: string;
  icon: typeof Folder;
  openIcon?: typeof FolderOpen;
  defaultOpen?: boolean;
  depth?: number;
  href?: string;
  children?: React.ReactNode;
}

function TreeNode({ label, subtitle, icon: Icon, openIcon: OpenIcon, defaultOpen = false, depth = 0, href, children }: TreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  const RowIcon = open && OpenIcon ? OpenIcon : Icon;
  const indent = depth * 24;

  return (
    <div>
      <div
        className={cn("flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--color-bg)] transition-colors", href ? "cursor-pointer" : "")}
        style={{ paddingLeft: indent }}
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron className="w-3.5 h-3.5 text-[var(--color-muted)] cursor-pointer" />
        <RowIcon className="w-4 h-4 text-[var(--color-accent)]" />
        {href ? (
          <Link href={href} onClick={(e) => e.stopPropagation()} className="flex-1 text-sm font-medium hover:text-[var(--color-accent)] transition-colors">
            {label}
          </Link>
        ) : (
          <span className="flex-1 text-sm font-medium">{label}</span>
        )}
        {subtitle && <span className="text-xs text-[var(--color-muted)]">{subtitle}</span>}
      </div>
      {open && children}
    </div>
  );
}

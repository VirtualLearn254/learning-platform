"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

interface ToastInput {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
  durationMs?: number;
}

interface ToastEntry extends ToastInput { id: string }

interface ToastContextValue {
  notify: (input: ToastInput) => void;
}

const ToastCtx = createContext<ToastContextValue | null>(null);

export function ToastShell({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const notify = useCallback((input: ToastInput) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((all) => [...all, { id, ...input }]);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastCtx.Provider value={value}>
      <ToastProvider>
        {children}
        {toasts.map((t) => (
          <Toast
            key={t.id}
            variant={t.variant}
            duration={t.durationMs ?? 4000}
            onOpenChange={(open) => { if (!open) setToasts((all) => all.filter((x) => x.id !== t.id)); }}
          >
            <div className="flex-1">
              <ToastTitle>{t.title}</ToastTitle>
              {t.description && <ToastDescription>{t.description}</ToastDescription>}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastShell />");
  return ctx;
}

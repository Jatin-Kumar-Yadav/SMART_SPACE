import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'
export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface UiState {
  toasts: Toast[]
  toast: (text: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
}

let n = 1
export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  toast: (text, kind = 'info') => {
    const id = n++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }))
    setTimeout(() => get().dismiss(id), kind === 'error' || kind === 'warning' ? 5000 : 3000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = (text: string, kind: ToastKind = 'info') => useUi.getState().toast(text, kind)

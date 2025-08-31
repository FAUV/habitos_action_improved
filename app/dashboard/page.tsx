"use client";
import { motion } from "framer-motion";
import { LayoutDashboard, CalendarCheck, ListTodo, NotebookPen, Target, Activity, Link } from "lucide-react";

const tiles = [
  { href: "/guide", title: "Guía paso a paso", icon: LayoutDashboard, desc: "Recorre los 7 hábitos asistido." },
  { href: "/tasks", title: "Tareas (Kanban)", icon: ListTodo, desc: "Estado, prioridad, energía, contexto." },
  { href: "/review-week", title: "Plan semanal", icon: CalendarCheck, desc: "Big Rocks, objetivos y evaluación." },
  { href: "/projects", title: "Proyectos / Roles", icon: Target, desc: "Alinea roles, objetivos y referencias." },
  { href: "/tasks?view=habits", title: "Hábitos", icon: Activity, desc: "Tracker diario de los 7 hábitos." },
  { href: "/projects?view=references", title: "Referencias", icon: Link, desc: "Centraliza enlaces y notas." },
  { href: "/onboarding", title: "Onboarding / Misión", icon: NotebookPen, desc: "Declara misión y setup inicial." },
];

export default function Dashboard() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-3xl font-semibold">Panel principal</h1>
        <p className="text-gray-600 mt-1">Accesos rápidos y flujo recomendado.</p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {tiles.map((t, idx) => (
            <motion.a
              key={t.href}
              href={t.href}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05, duration: .25 }}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition"
            >
              <div className="flex items-center gap-3">
                <t.icon className="h-6 w-6 text-indigo-600" />
                <h2 className="text-lg font-medium">{t.title}</h2>
              </div>
              <p className="text-gray-600 mt-2">{t.desc}</p>
            </motion.a>
          ))}
        </div>
      </div>
    </main>
  );
}

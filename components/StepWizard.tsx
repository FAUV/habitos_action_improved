"use client";
import { useState, useMemo, useCallback } from "react";
import { steps } from "@/lib/steps";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, CheckCircle2, Sparkles } from "lucide-react";

export default function StepWizard() {
  const [i, setI] = useState(0);
  const current = steps[i];
  const progress = useMemo(() => Math.round(((i+1)/steps.length)*100), [i]);

  const next = useCallback(() => setI(v => Math.min(v+1, steps.length-1)), []);
  const prev = useCallback(() => setI(v => Math.max(v-1, 0)), []);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Sparkles className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Guía paso a paso (7 Hábitos)</h1>
      </div>

      <div className="h-2 w-full rounded bg-gray-200 overflow-hidden mb-4">
        <div className="h-full bg-indigo-500 transition-all" style={{width: `${progress}%`}} />
      </div>
      <p className="text-sm text-gray-600 mb-6">{progress}% completado</p>

      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 16, scale: .98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: .98 }}
          transition={{ duration: .25 }}
          className="rounded-2xl border border-gray-200 p-6 shadow-sm bg-white"
        >
          <h2 className="text-xl font-bold">{current.title}</h2>
          <p className="mt-1 text-gray-600">{current.subtitle}</p>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {steps.map((s, idx) => (
              <span
                key={s.id}
                className={`px-2.5 py-1 rounded-full border ${idx<=i ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-gray-50 border-gray-200 text-gray-500"}`}
              >
                {idx+1}
              </span>
            ))}
          </div>

          {current.tip && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
              <strong>Tip:</strong> {current.tip}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={prev}
              disabled={i===0}
              aria-label="Atrás"
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" /> Atrás
            </button>

            <div className="flex items-center gap-3">
              <a
                href={current.href}
                aria-label="Ir ahora"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2 shadow hover:bg-indigo-700"
              >
                Ir ahora <ArrowRight className="h-4 w-4" />
              </a>
              <button
                onClick={next}
                disabled={i===steps.length-1}
                aria-label="Siguiente"
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>

          {i===steps.length-1 && (
            <div className="mt-6 flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              <span>¡Listo! Ya recorriste toda la metodología. Repite semanalmente.</span>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

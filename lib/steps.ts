export type Step = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  cta: string;
  tip?: string;
};

export const steps: Step[] = [
  {
    id: "habit1",
    title: "Hábito 1 — Sé proactivo",
    subtitle: "Decide qué controlas y aterrízalo en acciones.",
    href: "/tasks?preset=proactivo",
    cta: "Ir a Tareas (proactividad)",
    tip: "Empieza por una acción pequeña hoy."
  },
  {
    id: "habit2",
    title: "Hábito 2 — Fin en mente",
    subtitle: "Declara tu misión y objetivos de alto nivel.",
    href: "/onboarding?step=mission",
    cta: "Definir misión",
    tip: "Una frase clara es mejor que perfecta."
  },
  {
    id: "habit3",
    title: "Hábito 3 — Primero lo primero",
    subtitle: "Planifica la semana, big rocks y prioridades.",
    href: "/review-week?tab=plan",
    cta: "Plan semanal",
    tip: "Reserva bloques para lo importante."
  },
  {
    id: "habit4",
    title: "Hábito 4 — Ganar/Ganar",
    subtitle: "Alinea objetivos por roles y acuerdos claros.",
    href: "/projects?view=roles",
    cta: "Roles y objetivos",
  },
  {
    id: "habit5",
    title: "Hábito 5 — Comprender…",
    subtitle: "Centraliza referencias y notas útiles.",
    href: "/projects?view=references",
    cta: "Referencias",
  },
  {
    id: "habit6",
    title: "Hábito 6 — Sinergizar",
    subtitle: "Coordina proyectos y dependencias.",
    href: "/projects?view=kanban",
    cta: "Proyectos",
  },
  {
    id: "habit7",
    title: "Hábito 7 — Afilar la sierra",
    subtitle: "Rutinas y seguimiento diario.",
    href: "/tasks?view=habits",
    cta: "Tracker de hábitos",
  },
];

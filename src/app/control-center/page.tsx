export default function ControlCenterPage() {
  return (
    <section className="rounded-xl border bg-white p-6 shadow-sm dark:bg-slate-950">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
        <h2 className="text-lg font-semibold">Frontera administrativa activa</h2>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
        Esta área está aislada de los roles de cada organización. Las funciones operativas se
        incorporarán progresivamente y permanecerán cerradas hasta contar con autorización y
        auditoría específicas.
      </p>
    </section>
  )
}

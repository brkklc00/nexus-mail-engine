export function PageHeader({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 rounded-2xl border border-border bg-gradient-to-r from-card via-zinc-900 to-card p-5 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-xl font-semibold text-white md:text-2xl">{title}</h2>
        <p className="mt-1 text-sm text-zinc-400">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

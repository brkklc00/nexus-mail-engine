type MetricCardProps = {
  title: string;
  value: string | number;
  delta?: string;
};

export function MetricCard({ title, value, delta }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-400">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {delta ? <p className="mt-1 text-xs text-zinc-400">{delta}</p> : null}
    </div>
  );
}

export default function LoadingSkeleton({ className = "" }: { className?: string }) {
  return <div aria-label="Loading" className={`animate-pulse rounded-lg bg-slate-200/80 ${className}`} role="status" />;
}

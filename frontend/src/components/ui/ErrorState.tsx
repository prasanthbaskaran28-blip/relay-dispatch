import { AlertCircle, RefreshCw } from "lucide-react";

export default function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-3 rounded-full bg-rose-50 p-3 text-rose-700"><AlertCircle size={20} /></span>
      <h3 className="text-sm font-semibold text-ink">We couldn’t load this data</h3>
      <p className="mt-1 max-w-lg text-sm text-muted">{message}</p>
      <button className="button-secondary mt-4" onClick={onRetry}><RefreshCw size={15} /> Try again</button>
    </div>
  );
}

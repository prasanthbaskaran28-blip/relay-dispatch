import { useState } from "react";
import type { FormEvent } from "react";
import apiClient, { getApiError } from "../../services/apiClient";

type DispatcherLoginProps = {
  onAuthorized: (token: string) => void;
};

export default function DispatcherLogin({
  onAuthorized,
}: DispatcherLoginProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = token.trim();
    if (!candidate) return;

    setError(null);
    setSubmitting(true);
    try {
      await apiClient.get("/dashboard/overview", {
        headers: { Authorization: `Bearer ${candidate}` },
      });
      sessionStorage.setItem("relay-dispatcher-token", candidate);
      onAuthorized(candidate);
    } catch (requestError) {
      const apiError = getApiError(requestError);
      setError(
        apiError.status === 401
          ? "That dispatcher access token was not accepted."
          : apiError.message,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-ink">
      <section className="w-full max-w-md rounded-xl border border-line bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6">
          <p className="text-sm font-semibold text-brand">RELAY Dispatch Desk</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            Dispatcher sign in
          </h1>
          <p className="mt-2 text-sm text-muted">
            Enter the access token configured for the dispatch API.
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium" htmlFor="dispatcher-token">
            Access token
          </label>
          <input
            id="dispatcher-token"
            autoComplete="current-password"
            className="w-full rounded-md border border-line px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-emerald-100"
            onChange={(event) => setToken(event.target.value)}
            required
            type="password"
            value={token}
          />
          {error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {error}
            </p>
          )}
          <button
            className="w-full rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            {submitting ? "Verifying..." : "Continue"}
          </button>
        </form>
      </section>
    </main>
  );
}

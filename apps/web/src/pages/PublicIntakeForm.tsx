import { useParams, Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Button, Spinner, inputCls } from "../components/ui";

interface FormDef {
  name: string;
  slug: string;
  fields: Array<{ key: string; label: string; required: boolean; type: string }>;
}

/** Public founder-facing pitch form (Roulette "Automate Your Pitch Form"). */
export default function PublicIntakeForm() {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState<FormDef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!slug || started.current) return;
    started.current = true;
    fetch(`/api/v1/public/forms/${slug}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Form not found");
        setForm(await res.json());
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load form"));
  }, [slug]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-white p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">c</span>
          <span className="font-semibold tracking-tight text-slate-900">Copyr Pitch</span>
        </div>

        {error ? (
          <>
            <p className="text-sm text-red-600">{error}</p>
            <p className="mt-2 text-xs text-slate-500">Check the form URL with the firm you're pitching.</p>
          </>
        ) : done ? (
          <div className="py-6 text-center">
            <p className="text-3xl">🎯</p>
            <h1 className="mt-3 text-lg font-semibold text-slate-900">Pitch received</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Your company is now in the firm's intake pipeline. If you included a deck link,
              it's being converted and analyzed already.
            </p>
          </div>
        ) : !form ? (
          <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{form.name}</h1>
            <p className="mt-1 mb-5 text-sm text-slate-500">
              Tell us what you're building. We review every submission.
            </p>
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setSubmitting(true);
                setError(null);
                try {
                  const fd = new FormData(e.currentTarget as HTMLFormElement);
                  const payload: Record<string, string> = {};
                  fd.forEach((v, k) => {
                    const str = String(v).trim();
                    if (str) payload[k] = str;
                  });
                  const res = await fetch(`/api/v1/public/forms/${slug}`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  if (!res.ok) {
                    const body = await res.json().catch(() => ({ error: "Submission failed" }));
                    throw new Error(body.error ?? `HTTP ${res.status}`);
                  }
                  setDone(true);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Submission failed");
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {(form.fields ?? []).map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    {f.label}
                    {f.required && <span className="text-red-500"> *</span>}
                  </span>
                  <input
                    name={f.key}
                    required={f.required}
                    type={f.type === "url" ? "url" : f.type === "number" ? "number" : "text"}
                    placeholder={
                      f.key === "deck_url"
                        ? "https://docsend.com/view/…"
                        : f.key === "one_liner"
                          ? "We build … for …"
                          : ""
                    }
                    className={inputCls}
                  />
                </label>
              ))}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? <Spinner /> : null} Submit pitch
              </Button>
            </form>
          </>
        )}

        <p className="mt-6 border-t border-slate-100 pt-4 text-center text-[11px] text-slate-400">
          Powered by{" "}
          <Link to="/" className="font-medium text-brand-600 hover:underline">
            Copyr
          </Link>{" "}
          — your pitch goes directly into the firm's review pipeline.
        </p>
      </div>
    </div>
  );
}

interface SharedDoc {
  id: string;
  name: string;
  downloadUrl: string;
}

/** /share/:token → password-gated public company viewer. */
export function ShareRedirect() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const started = useRef(false);

  const load = (pw?: string) => {
    setLoading(true);
    fetch(`/api/v1/public/share/${token}${pw ? `?password=${encodeURIComponent(pw)}` : ""}`)
      .then(async (res) => {
        const body = await res.json();
        if (res.ok) {
          setData(body);
          setLocked(false);
        } else if (body.locked) {
          setLocked(true);
        } else {
          setError(body.error ?? "Link unavailable");
        }
      })
      .catch(() => setError("Link unavailable"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    load();
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {loading ? (
          <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
        ) : locked ? (
          <>
            <h1 className="text-lg font-semibold text-slate-900">🔒 This link is password protected</h1>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                load(password);
              }}
            >
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className={inputCls}
              />
              <Button type="submit">Unlock</Button>
            </form>
          </>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : data ? (
          <SharedRecord data={data} />
        ) : null}
      </div>
    </div>
  );
}

function SharedRecord({ data }: { data: Record<string, unknown> }) {
  const company = (data.company ?? {}) as Record<string, unknown>;
  const docs = (data.documents ?? []) as SharedDoc[];
  return (
    <>
      <p className="text-[11px] uppercase tracking-widest text-brand-600">{String(data.title ?? "Shared record")}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{String(company.name ?? "")}</h1>
      {typeof company.location === "string" && <p className="mt-1 text-sm text-slate-500">{company.location}</p>}
      {typeof company.description === "string" && (
        <p className="mt-4 text-sm leading-relaxed text-slate-700">{company.description}</p>
      )}
      <dl className="mt-6 grid grid-cols-2 gap-3">
        {Object.entries(company)
          .filter(([k]) => !["name", "description"].includes(k))
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs capitalize text-slate-400">{k.replace(/_/g, " ")}</dt>
              <dd className="text-sm font-medium text-slate-800">
                {Array.isArray(v) ? v.join(", ") : String(v)}
              </dd>
            </div>
          ))}
      </dl>
      {docs.length > 0 && (
        <div className="mt-6 border-t border-slate-100 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Documents</p>
          <ul className="space-y-1.5">
            {docs.map((d) => (
              <li key={d.id}>
                <a
                  href={d.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-brand-600 hover:underline"
                >
                  📄 {d.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-8 border-t border-slate-100 pt-4 text-center text-[11px] text-slate-400">
        Shared via{" "}
        <Link to="/" className="font-medium text-brand-600 hover:underline">Copyr</Link>
      </p>
    </>
  );
}

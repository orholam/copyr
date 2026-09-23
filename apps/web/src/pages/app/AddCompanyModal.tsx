import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Button, Field, Modal, Select, Spinner, inputCls, cx } from "../../components/ui";
import { IconLink, IconPen, IconUpload } from "../../components/icons";

export default function AddCompanyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [tab, setTab] = useState<"link" | "upload" | "manual">("link");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["deals"] });
    void qc.invalidateQueries({ queryKey: ["companies"] });
    void qc.invalidateQueries({ queryKey: ["documents"] });
    void qc.invalidateQueries({ queryKey: ["analytics"] });
    onCreated();
  };

  const fromLink = useMutation({
    mutationFn: (body: { url: string; companyName?: string }) =>
      api.post("/documents/from-link", body),
    onSuccess: invalidate,
  });

  const manual = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/deals", body),
    onSuccess: invalidate,
  });

  const upload = useMutation({
    mutationFn: async () => {
      const files = pickedFiles.length ? pickedFiles : Array.from(fileRef.current?.files ?? []);
      if (!files.length) throw new Error("choose at least one PDF");
      return api.upload("/documents/upload", files);
    },
    onSuccess: invalidate,
  });

  const busy = fromLink.isPending || manual.isPending || upload.isPending;
  const error = (fromLink.error ?? manual.error ?? upload.error) as Error | null;

  const TABS = [
    ["link", "Paste link", IconLink],
    ["upload", "Upload PDFs", IconUpload],
    ["manual", "Manual", IconPen],
  ] as const;

  return (
    <Modal open onClose={onClose} title="Add a company to your pipeline" subtitle="Three ways in — all end with AI-extracted fields on a fresh deal." wide>
      <div className="mb-4 grid grid-cols-3 gap-0.5 rounded-md border border-paper-900/[0.1] bg-paper-100 p-[3px]">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cx(
              "flex items-center justify-center gap-2 rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors",
              tab === key ? "bg-paper-200 text-paper-900 shadow-card" : "text-paper-600 hover:text-paper-800",
            )}
          >
            <Icon width={14} height={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === "link" && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget as HTMLFormElement);
            void fromLink.mutateAsync({
              url: String(fd.get("url")),
              companyName: (fd.get("companyName") as string) || undefined,
            });
          }}
        >
          <Field label="Deck or data room link">
            <input name="url" required placeholder="https://docsend.com/view/abc123" className={inputCls} />
          </Field>
          <Field label="Company name" hint="Optional — we infer it from the link when omitted.">
            <input name="companyName" placeholder="Acme Inc." className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy && <Spinner className="h-3.5 w-3.5" />} Convert & add</Button>
          </div>
        </form>
      )}

      {tab === "upload" && (
        <div className="space-y-4">
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              setPickedFiles(Array.from(e.dataTransfer.files));
            }}
            className={cx(
              "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed py-10 transition-colors",
              dragOver ? "border-brand-500/60 bg-brand-500/[0.06]" : "border-paper-900/[0.16] hover:border-brand-500/40 hover:bg-paper-100",
            )}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-paper-100 text-paper-600">
              <IconUpload width={20} height={20} />
            </span>
            <p className="mt-3 text-sm font-medium text-paper-900">
              {pickedFiles.length
                ? `${pickedFiles.length} file${pickedFiles.length > 1 ? "s" : ""} ready — ${pickedFiles.map((f) => f.name).join(", ").slice(0, 60)}`
                : "Drop pitch decks here or click to browse"}
            </p>
            <p className="mt-0.5 text-xs text-paper-500">PDF · multiple files supported</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(e) => setPickedFiles(Array.from(e.target.files ?? []))}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={busy || !pickedFiles.length} onClick={() => upload.mutate()}>
              {busy && <Spinner className="h-3.5 w-3.5" />} Upload & process
            </Button>
          </div>
        </div>
      )}

      {tab === "manual" && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget as HTMLFormElement);
            const askRaw = fd.get("askAmount") as string;
            void manual.mutateAsync({
              companyName: String(fd.get("companyName")),
              domain: (fd.get("website") as string)?.trim() || undefined,
              website: (fd.get("website") as string)?.trim() || undefined,
              roundStage: (fd.get("roundStage") as string) || undefined,
              askAmount: askRaw ? Number(askRaw) * 1_000_000 : undefined,
              description: (fd.get("description") as string) || undefined,
            });
          }}
        >
          <Field label="Company name">
            <input name="companyName" required className={inputCls} placeholder="Acme Inc." />
          </Field>
          <Field label="Website" hint="We enrich the company from its site before screening — helps the Thesis Screener avoid a thin-data pass.">
            <input name="website" type="url" placeholder="https://acme.com" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Round">
              <Select name="roundStage" defaultValue="">
                <option value="">—</option>
                {["Pre-seed", "Seed", "Series A", "Series B", "Series C"].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Field label="Ask ($M)">
              <input name="askAmount" type="number" step="0.5" min="0" className={inputCls} />
            </Field>
          </div>
          <Field label="One-liner">
            <input name="description" placeholder="One sentence on what they do" className={inputCls} />
          </Field>
          <p className="text-[11px] leading-5 text-paper-500">Tip: add the website — we’ll auto-enrich sector/description before the screener runs.</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy && <Spinner className="h-3.5 w-3.5" />} Create deal</Button>
          </div>
        </form>
      )}

      {error && (
        <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error.message}
        </p>
      )}
    </Modal>
  );
}

export interface CustomField {
  id: string;
  target: "deal" | "company";
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  isRequired: boolean;
  showInTable: boolean;
  aiExtractable: boolean;
  position: number;
}

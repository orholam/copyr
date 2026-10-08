import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, rememberWorkspaceSlug } from "../../../lib/api";
import { Badge, Button, inputCls } from "../../../components/ui";

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AccountHit {
  id: string;
  name: string;
  email: string;
}

export default function TeamTab({
  canManage,
  members,
  selfId,
}: {
  canManage: boolean;
  members: Member[];
  selfId: string | null;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const searchQ = useQuery({
    queryKey: ["org-accounts", debounced],
    queryFn: () => api.get<{ items: AccountHit[] }>(`/organizations/accounts?q=${encodeURIComponent(debounced)}`),
    enabled: canManage && debounced.length >= 2,
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["me"] });
  };

  const add = useMutation({
    mutationFn: (userId: string) => api.post("/organizations/members", { userId, role }),
    onSuccess: async () => {
      setQuery("");
      setError(null);
      await refresh();
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Could not add that person"),
  });

  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: string }) =>
      api.patch(`/organizations/members/${input.userId}`, { role: input.role }),
    onSuccess: () => void refresh(),
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Could not change role"),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`/organizations/members/${userId}`),
    onSuccess: () => void refresh(),
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Could not remove that person"),
  });

  const createOrg = useMutation({
    mutationFn: (name: string) => api.post<{ slug: string }>("/organizations", { name }),
    onSuccess: async (created) => {
      rememberWorkspaceSlug(created.slug);
      setOrgName("");
      setError(null);
      await qc.invalidateQueries();
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Could not create organization"),
  });

  const hits = (searchQ.data?.items ?? []).filter((hit) => !members.some((m) => m.id === hit.id));

  return (
    <div className="space-y-5">
      <section className="panel animate-fade-in p-5">
        <h3 className="mb-1 text-sm font-semibold text-paper-900">People</h3>
        <p className="mb-4 text-xs text-paper-600">
          Everyone here shares this organization's deals, from intake through close.
        </p>
        {error && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>
        )}
        <ul className="mb-5 space-y-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-paper-900/[0.09] bg-paper-100 px-2.5 py-2 text-[13px]"
            >
              <span>
                <span className="font-medium text-paper-900">{m.name}</span>
                <span className="ml-2 text-paper-500">{m.email}</span>
                {m.id === selfId && <Badge>you</Badge>}
              </span>
              {canManage ? (
                <span className="flex items-center gap-2">
                  <select
                    aria-label={`Role for ${m.name}`}
                    className={inputCls}
                    value={m.role}
                    onChange={(e) => changeRole.mutate({ userId: m.id, role: e.target.value })}
                  >
                    <option value="owner">owner</option>
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                  </select>
                  <Button size="xs" variant="ghost" onClick={() => remove.mutate(m.id)}>
                    Remove
                  </Button>
                </span>
              ) : (
                <Badge>{m.role}</Badge>
              )}
            </li>
          ))}
        </ul>

        {canManage && (
          <div>
            <label className="mb-1 block text-xs font-medium text-paper-700" htmlFor="add-person">
              Add someone who already has an account
            </label>
            <div className="flex gap-2">
              <input
                id="add-person"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name…"
                className={inputCls}
              />
              <select
                aria-label="Role for the person you add"
                className={inputCls}
                value={role}
                onChange={(e) => setRole(e.target.value as "admin" | "member")}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </div>
            {debounced.length >= 2 && (
              <ul className="mt-2 space-y-1">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-paper-900/[0.04]"
                      onClick={() => add.mutate(hit.id)}
                    >
                      <span>
                        <span className="font-medium text-paper-900">{hit.name}</span>
                        <span className="ml-2 text-paper-500">{hit.email}</span>
                      </span>
                      <span className="text-xs text-paper-600">Add</span>
                    </button>
                  </li>
                ))}
                {!searchQ.isFetching && hits.length === 0 && (
                  <li className="px-2 py-1 text-xs text-paper-500">No matching accounts.</li>
                )}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="panel animate-fade-in p-5">
        <h3 className="mb-1 text-sm font-semibold text-paper-900">New organization</h3>
        <p className="mb-4 text-xs text-paper-600">
          Creates an empty pipeline you own. Switch back to this one from the sidebar.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (orgName.trim()) createOrg.mutate(orgName.trim());
          }}
        >
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Organization name"
            className={inputCls}
            aria-label="Organization name"
          />
          <Button type="submit" disabled={createOrg.isPending || !orgName.trim()}>
            Create
          </Button>
        </form>
      </section>
    </div>
  );
}

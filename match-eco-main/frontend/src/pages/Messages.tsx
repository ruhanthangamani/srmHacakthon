// src/pages/Messages.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:5050/api";

type Participant = {
  factory_id: number;
  user_id: number;
  factory_name: string;
  industry_type: string;
  email: string;
};
type Thread = {
  conversation_id: number;
  created_at: string;
  participants: Participant[];
  last_message: { body: string; sender_user_id: number; created_at: string } | null;
};
type Conversation = {
  conversation_id: number;
  participants: Participant[];
  messages: { id: number; sender_user_id: number; body: string; created_at: string }[];
};

export default function Messages() {
  const navigate = useNavigate();
  const tokenFromStore = useAppStore((s) => s.token) as string | null;
  const token = tokenFromStore ?? (typeof window !== "undefined" ? localStorage.getItem("token") : null);

  const [me, setMe] = useState<{ id: number; email: string } | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const [activeId, setActiveId] = useState<number | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");

  // page 100 rows at a time
  const PAGE = 100;
  const [vis, setVis] = useState(PAGE);

  async function fetchMe() {
    try {
      const r = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401) throw new Error("Unauthorized");
      const data = await r.json();
      setMe({ id: Number(data.id), email: String(data.email) });
    } catch {
      // not fatal; you only lose "you vs them" highlighting
    }
  }

  async function fetchThreads() {
    if (!token) {
      toast.error("Please sign in");
      navigate("/auth/login");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/messages/threads`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setThreads(Array.isArray(j) ? j : []);
      setVis(PAGE);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to load messages");
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchConversation(cid: number) {
    if (!token) return;
    try {
      const r = await fetch(`${API_BASE}/messages/${cid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setConv(j);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to load conversation");
      setConv(null);
    }
  }

  useEffect(() => {
    if (!token) {
      toast.error("Please sign in");
      navigate("/auth/login");
      return;
    }
    fetchMe();
    fetchThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (activeId) fetchConversation(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const filtered = useMemo(() => {
    if (!q.trim()) return threads;
    const s = q.toLowerCase();
    return threads.filter((t) => {
      const part = (t.participants || [])
        .map((p) => `${p.factory_name} ${p.email} ${p.industry_type}`.toLowerCase())
        .join(" | ");
      const last = (t.last_message?.body || "").toLowerCase();
      return part.includes(s) || last.includes(s);
    });
  }, [threads, q]);

  async function send() {
    if (!token || !activeId) return;
    const text = body.trim();
    if (!text) return;

    setSending(true);
    try {
      const r = await fetch(`${API_BASE}/messages/${activeId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body: text }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setBody("");

      // refresh convo + threads last message
      await Promise.all([fetchConversation(activeId), fetchThreads()]);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Send failed");
    } finally {
      setSending(false);
    }
  }

  function otherPartyParts(parts: Participant[]): Participant[] {
    if (!me) return parts;
    return parts.filter((p) => p.user_id !== me.id);
  }

  return (
    <AppShell>
      <div className="space-y-6 overflow-x-hidden">
        <div>
          <h1 className="text-3xl font-bold">Messages</h1>
          <p className="text-muted-foreground">View conversations, see contact emails, and reply</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Threads list */}
          <Card className="p-4 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <Input
                placeholder="Search by factory / email / last message…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setVis(PAGE);
                }}
              />
              <Button variant="outline" onClick={() => fetchThreads()} disabled={loading}>
                Refresh
              </Button>
            </div>

            <div className="rounded-md border">
              <div className="relative w-full max-w-full overflow-x-auto">
                <div className="max-h-[70vh] overflow-y-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead className="sticky top-0 z-10 border-b bg-background">
                      <tr>
                        <th className="px-3 py-2 text-left">Conversation</th>
                        <th className="px-3 py-2 text-left">Contact (email)</th>
                        <th className="px-3 py-2 text-left">Last message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
                      ) : filtered.length === 0 ? (
                        <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No conversations.</td></tr>
                      ) : (
                        filtered.slice(0, vis).map((t) => {
                          const others = otherPartyParts(t.participants);
                          const name = others.map((p) => p.factory_name).join(", ");
                          const email = others.map((p) => p.email || "—").join(", ");
                          return (
                            <tr
                              key={t.conversation_id}
                              className={`border-b cursor-pointer hover:bg-muted/40 ${activeId === t.conversation_id ? "bg-muted/40" : ""}`}
                              onClick={() => setActiveId(t.conversation_id)}
                            >
                              <td className="px-3 py-2 whitespace-nowrap">{name || "—"}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{email || "—"}</td>
                              <td className="px-3 py-2">{t.last_message?.body ?? "—"}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {vis < filtered.length && (
              <div className="flex justify-center mt-3">
                <Button onClick={() => setVis((v) => v + PAGE)}>Load more</Button>
              </div>
            )}
          </Card>

          {/* Conversation panel */}
          <Card className="p-4 md:col-span-2">
            {activeId == null ? (
              <div className="text-muted-foreground">Select a conversation to view messages.</div>
            ) : !conv ? (
              <div className="text-muted-foreground">Loading conversation…</div>
            ) : (
              <>
                {/* Header with participants + emails */}
                <div className="mb-3">
                  <h2 className="text-lg font-semibold">Conversation #{conv.conversation_id}</h2>
                  <div className="text-sm text-muted-foreground">
                    {conv.participants.map((p, i) => (
                      <span key={p.factory_id}>
                        {i > 0 ? " • " : null}
                        <b>{p.factory_name}</b> ({p.industry_type}) — <span className="underline">{p.email || "—"}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Messages */}
                <div className="rounded-md border mb-3">
                  <div className="max-h-[60vh] overflow-y-auto p-3 space-y-3">
                    {conv.messages.length === 0 ? (
                      <p className="text-muted-foreground">No messages yet.</p>
                    ) : (
                      conv.messages.map((m) => {
                        const mine = me && m.sender_user_id === me.id;
                        return (
                          <div
                            key={m.id}
                            className={`max-w-[80%] p-2 rounded ${mine ? "ml-auto bg-primary/10" : "mr-auto bg-muted"}`}
                          >
                            <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                            <div className="text-xs text-muted-foreground mt-1">{new Date(m.created_at).toLocaleString()}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Composer */}
                <div className="space-y-2">
                  <Label htmlFor="body">Reply</Label>
                  <Textarea
                    id="body"
                    rows={3}
                    placeholder="Type your message…"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button onClick={send} disabled={sending || !body.trim()}>
                      {sending ? "Sending…" : "Send"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

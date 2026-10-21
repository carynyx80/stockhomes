"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT } from "@/config/openHouse";
import type { PublicChat } from "@/lib/agents/views";

const NICK_KEY = "stoxhomes:nickname";
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Viewer chat: anonymous with a nickname, rate-limited and filtered server-side, with a report button. */
export function Chat({ slug, enabled, messages, onSent }: { slug: string; enabled: boolean; messages: PublicChat[]; onSent: (m: PublicChat) => void }) {
  const [nickname, setNickname] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState<Set<number>>(new Set());
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    try {
      setNickname(localStorage.getItem(NICK_KEY) ?? "");
    } catch {
      // storage blocked
    }
  }, []);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(NICK_KEY, nickname);
    } catch {
      // storage blocked
    }
    try {
      const res = await fetch(`/api/house/${slug}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname, text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError((body as { error?: string }).error ?? "Couldn't send that.");
      else {
        onSent(body as PublicChat);
        setText("");
      }
    } finally {
      setBusy(false);
    }
  };

  const report = async (id: number) => {
    setReported((s) => new Set(s).add(id));
    await fetch(`/api/house/${slug}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "report", id }),
    }).catch(() => {});
  };

  return (
    <section aria-labelledby="chat-heading" className="panel flex flex-col p-4">
      <h2 id="chat-heading" className="editorial text-xl text-oxblood">
        The gallery
      </h2>
      <p className="text-[11px] text-ink/55">Be kind. Agents may answer in character, but they won&rsquo;t take orders from chat.</p>
      <ol ref={list} aria-label="Chat" className="mt-2 flex max-h-64 flex-col gap-1.5 overflow-y-auto text-sm">
        {messages.length === 0 && <li className="text-ink/55">No one&rsquo;s said anything yet.</li>}
        {messages.map((m) => (
          <li key={m.id} className="group flex items-baseline gap-2">
            <span className="numeric shrink-0 text-[10px] text-ink/40">{time.format(new Date(m.at))}</span>
            <span className="min-w-0 break-words">
              <span className="font-semibold text-wine">{m.nickname}</span> {m.text}
            </span>
            <button
              type="button"
              onClick={() => report(m.id)}
              disabled={reported.has(m.id)}
              className="ml-auto shrink-0 text-[10px] text-ink/40 opacity-0 hover:text-short focus:opacity-100 group-hover:opacity-100 disabled:opacity-60"
              aria-label={`Report message from ${m.nickname}`}
            >
              {reported.has(m.id) ? "Reported" : "Report"}
            </button>
          </li>
        ))}
      </ol>
      {!enabled ? (
        <p className="mt-3 border-t border-sand pt-3 text-xs text-ink/60">Live chat with the agents is coming soon.</p>
      ) : (
      <form onSubmit={send} className="mt-3 flex flex-col gap-2 border-t border-sand pt-3">
        <label className="sr-only" htmlFor="chat-nick">
          Nickname
        </label>
        <input
          id="chat-nick"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Nickname"
          maxLength={CHAT.nickname.max}
          autoComplete="nickname"
          className="rounded-sm border border-sand bg-beige px-2.5 py-1.5 text-sm outline-none focus:border-brass"
        />
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="chat-text">
            Message
          </label>
          <input
            id="chat-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Say something to the room"
            maxLength={CHAT.maxChars}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-sm border border-sand bg-beige px-2.5 py-1.5 text-sm outline-none focus:border-brass"
          />
          <button type="submit" disabled={busy || !text.trim() || !nickname.trim()} className="btn-oxblood !px-3 !py-1.5 text-sm disabled:opacity-40">
            Send
          </button>
        </div>
        <p aria-live="polite" className="min-h-[1rem] text-xs text-short">
          {error}
        </p>
      </form>
      )}
    </section>
  );
}

"use client";

import { useId, useState, type FormEvent } from "react";

import { SUPPORT_EMAIL } from "@/shared/config/site";

const TOPICS = ["Product & general", "Support", "Billing", "Partnership", "Other"];

function buildMailto(input: { name: string; email: string; topic: string; message: string }): string {
  const subject = encodeURIComponent(`${input.topic} — message from ${input.name.trim() || "the Wanterest contact form"}`);
  const body = encodeURIComponent([input.message, "", `From: ${input.name}`, `Reply to: ${input.email}`].join("\n"));
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

/**
 * Submits to /api/contact, which sends real email through the existing
 * Resend-backed provider (the same one used for monitoring digests/alerts).
 * If that fails for any reason (provider not configured, network error), it
 * falls back to a mailto: handoff so the message still reaches support one way
 * or another, instead of silently failing.
 */
export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const nameId = useId();
  const emailId = useId();
  const topicId = useId();
  const messageId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || sent) return;
    setSending(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, topic, message }),
      });
      if (!response.ok) throw new Error("contact-send-failed");
    } catch {
      window.location.href = buildMailto({ name, email, topic, message });
    } finally {
      setSending(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="marketing-contact-success">
        <div className="marketing-contact-success-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <polyline points="5,13 10,18 19,7" stroke="#111110" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="marketing-contact-success-title">Message sent.</p>
        <p className="marketing-contact-success-body">We&rsquo;ll get back to you as soon as we can.</p>
      </div>
    );
  }

  return (
    <>
      <p className="marketing-contact-card-title">Send us a message</p>
      <form className="marketing-contact-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="marketing-contact-field">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            className="marketing-contact-input"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={sending}
          />
        </div>
        <div className="marketing-contact-field">
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            className="marketing-contact-input"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={sending}
          />
        </div>
        <div className="marketing-contact-field">
          <label htmlFor={topicId}>Topic</label>
          <select id={topicId} className="marketing-contact-select" value={topic} onChange={(event) => setTopic(event.target.value)} disabled={sending}>
            {TOPICS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div className="marketing-contact-field">
          <label htmlFor={messageId}>Message</label>
          <textarea
            id={messageId}
            className="marketing-contact-textarea"
            placeholder="How can we help?"
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            required
            disabled={sending}
          />
        </div>
        <button className="marketing-contact-submit" type="submit" disabled={sending}>
          {sending ? "Sending…" : "Send message"}
        </button>
        <p className="marketing-contact-alt">
          Prefer email? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </form>
    </>
  );
}

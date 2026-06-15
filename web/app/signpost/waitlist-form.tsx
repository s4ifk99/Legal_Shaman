"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { joinSignpostWaitlist, type WaitlistState } from "./actions";

const initialState: WaitlistState = { status: "idle", message: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-6 py-3 font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Joining...
        </>
      ) : (
        "Join the waitlist"
      )}
    </button>
  );
}

export function WaitlistForm() {
  const [state, formAction] = useActionState(joinSignpostWaitlist, initialState);

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-gold/40 bg-card p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/15">
          <CheckCircle2 className="h-7 w-7 text-gold" />
        </div>
        <h3 className="font-serif text-2xl font-bold text-foreground">
          You&apos;re on the list
        </h3>
        <p className="max-w-md text-muted-foreground leading-relaxed">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-2xl border-2 border-gold/30 bg-card p-6 shadow-sm md:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" name="name" placeholder="Jane Smith" required />
        <Field label="Work email" name="email" type="email" placeholder="jane@firm.co.uk" required />
        <Field label="Firm name" name="firmName" placeholder="Smith & Co Solicitors" />
        <Field label="Your practice area" name="practiceArea" placeholder="e.g. Family law" />
      </div>
      <div className="mt-5">
        <Field label="Firm website" name="website" placeholder="https://yourfirm.co.uk" />
      </div>
      <div className="mt-5">
        <label htmlFor="message" className="mb-2 block text-sm font-medium text-foreground">
          Anything else? <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          placeholder="Tell us about the referrals you'd like to send or receive."
          className="w-full rounded-xl border-2 border-gold/20 bg-background px-4 py-2.5 text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-gold/60"
        />
      </div>

      {state.status === "error" && (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.message}
        </div>
      )}

      <div className="mt-6">
        <SubmitButton />
        <p className="mt-3 text-center text-xs text-muted-foreground">
          We&apos;ll only use your details to keep you updated about Signpost. We never share your
          details without your consent.
        </p>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-2 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-gold"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-xl border-2 border-gold/20 bg-background px-4 py-2.5 text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-gold/60"
      />
    </div>
  );
}

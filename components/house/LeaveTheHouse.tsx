"use client";

import { forgetEntered } from "@/lib/entry";

/** Forgets the visit and goes back outside, so the intro plays again. */
export function LeaveTheHouse() {
  return (
    <button
      type="button"
      className="editorial text-sm text-wine underline-offset-4 hover:underline"
      onClick={() => {
        forgetEntered();
        window.location.assign("/");
      }}
    >
      Leave the house
    </button>
  );
}

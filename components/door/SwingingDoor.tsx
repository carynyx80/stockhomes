"use client";

import { motion, type AnimationSequence } from "framer-motion";
import type { CSSProperties } from "react";
import { DoorLeaf } from "@/components/intro/DoorLeaf";

/**
 * The Stoxhomes front door: warm light behind, an oxblood leaf on a left hinge, a real <button>.
 * Used by the intro (which drives its own longer timeline through the data-* hooks) and by every door in the
 * Corridor (which uses `swingSequence`). Styling hooks (.door, .door-leaf, .knob-shine) live in globals.css.
 */
export function SwingingDoor({
  label,
  onActivate,
  disabled,
  className = "absolute",
  style,
}: {
  label: string;
  onActivate: () => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className} style={style}>
      <div
        data-glow
        aria-hidden
        className="absolute inset-0 opacity-0"
        style={{ background: "radial-gradient(ellipse at 50% 62%, #F6E7C4 0%, #E9C98A 30%, var(--brass) 55%, var(--wine) 100%)" }}
      />
      <button
        type="button"
        aria-label={label}
        onClick={onActivate}
        aria-disabled={disabled}
        className="door group absolute inset-0 cursor-pointer [perspective:900px]"
      >
        <motion.span data-leaf className="door-leaf absolute inset-0 block origin-left">
          <DoorLeaf />
        </motion.span>
      </button>
    </div>
  );
}

/** The short version of the front-door opening, for rooms off the Corridor (~0.6s). Scope it to one door. */
export const swingSequence = (scope: Element): AnimationSequence => [
  [scope.querySelector("[data-knob]")!, { rotate: [0, -30, 0] }, { duration: 0.2, at: 0 }],
  [scope.querySelector("[data-leaf]")!, { rotateY: 80 }, { duration: 0.5, ease: [0.55, 0.05, 0.35, 1], at: 0.08 }],
  [scope.querySelector("[data-glow]")!, { opacity: 1 }, { duration: 0.4, at: 0.15 }],
];

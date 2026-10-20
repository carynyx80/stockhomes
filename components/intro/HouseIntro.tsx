"use client";

import { motion, useAnimate, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { hasEntered, markEntered } from "@/lib/entry";
import { SwingingDoor } from "@/components/door/SwingingDoor";
import { Facade } from "./Facade";
import { DOOR, DOOR_ORIGIN, SIGN, SPILL } from "./geometry";
import { loadSoundPref, playKnock, saveSoundPref } from "./knock";

/** Facade height: fill the screen on desktop, crop the sides a little on phones. */
const STAGE_HEIGHT = "min(96dvh, 208vw)";

/** Development aid: `/?slowmo=8` plays the walk-in eight times slower. */
function timeScale(): number {
  if (process.env.NODE_ENV === "production") return 1;
  const n = Number(new URLSearchParams(window.location.search).get("slowmo"));
  return n > 0 ? n : 1;
}

function focusInside() {
  requestAnimationFrame(() => {
    // React's effect cleanup also removes `inert`, but possibly after this frame; focus fails inside an inert tree.
    document.querySelector("[data-house]")?.removeAttribute("inert");
    document.getElementById("inside")?.focus({ preventScroll: true });
  });
}

/**
 * The front of the house. Shown on the foyer to first-time visitors; returning visitors are hidden
 * by CSS before paint (see ENTRY_BOOT_SCRIPT) and the component unmounts once it confirms.
 */
export function HouseIntro() {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const [present, setPresent] = useState(true);
  const [entering, setEntering] = useState(false);
  const [sound, setSound] = useState(false);
  const enteringRef = useRef(false);
  const [scope, animate] = useAnimate<HTMLDivElement>();

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 50, damping: 16 });
  const y = useSpring(my, { stiffness: 50, damping: 16 });

  const show = pathname === "/" && present;

  useEffect(() => {
    if (hasEntered()) setPresent(false);
    setSound(loadSoundPref());
  }, []);

  // While the facade is up, the house behind it is unreachable and the page doesn't scroll.
  useEffect(() => {
    if (!show || hasEntered()) return;
    const house = document.querySelector("[data-house]");
    house?.setAttribute("inert", "");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      house?.removeAttribute("inert");
      document.body.style.overflow = overflow;
    };
  }, [show]);

  // Parallax: the facade drifts against the pointer, or with the phone's tilt.
  useEffect(() => {
    if (!show || reduceMotion) return;
    const onMove = (e: PointerEvent) => {
      mx.set((e.clientX / window.innerWidth - 0.5) * -22);
      my.set((e.clientY / window.innerHeight - 0.5) * -12);
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      mx.set(Math.max(-1, Math.min(1, e.gamma / 30)) * -14);
      my.set(Math.max(-1, Math.min(1, (e.beta - 45) / 30)) * -8);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("deviceorientation", onTilt);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
    };
  }, [show, reduceMotion, mx, my]);

  const finish = useCallback(() => {
    setPresent(false);
    focusInside();
  }, []);

  const enter = useCallback(async () => {
    if (enteringRef.current) return;
    enteringRef.current = true;
    setEntering(true);
    markEntered();
    if (sound) playKnock();

    if (reduceMotion) {
      await animate(scope.current, { opacity: 0 }, { duration: 0.4 });
      finish();
      return;
    }

    // ~1.8s: knock, swing, light, walk in, cross-fade.
    const k = timeScale();
    await animate([
      ["[data-knob]", { rotate: [0, -35, 0] }, { duration: 0.28 * k, at: 0 }],
      ["[data-leaf]", { rotateY: 82 }, { duration: 0.75 * k, ease: [0.55, 0.05, 0.35, 1], at: 0.15 * k }],
      ["[data-glow]", { opacity: 1 }, { duration: 0.55 * k, at: 0.28 * k }],
      ["[data-spill]", { opacity: 1 }, { duration: 0.5 * k, at: 0.4 * k }],
      ["[data-stage]", { scale: 11 }, { duration: 0.85 * k, ease: [0.6, 0, 0.85, 0.25], at: 0.72 * k }],
      [scope.current, { opacity: 0 }, { duration: 0.33 * k, at: 1.47 * k }],
    ]);
    finish();
  }, [animate, finish, reduceMotion, scope, sound]);

  const skip = useCallback(() => {
    markEntered();
    finish();
  }, [finish]);

  const toggleSound = useCallback(() => {
    setSound((on) => {
      saveSoundPref(!on);
      return !on;
    });
  }, []);

  if (!show) return null;

  return (
    <div
      ref={scope}
      data-intro
      role="region"
      aria-label="The front of Stoxhomes"
      className="fixed inset-0 z-50 overflow-hidden bg-beige"
    >
      {/* pavement continues past the facade on wide screens */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 bg-sand"
        style={{ height: `calc(${STAGE_HEIGHT} * 0.0246)` }}
      />

      <motion.div
        data-stage
        className="absolute bottom-0 left-1/2 will-change-transform"
        style={{
          x,
          y,
          // Centred with a negative margin, not translate, so it can be wider than the screen
          // without fighting the parallax transform.
          height: STAGE_HEIGHT,
          width: `calc(${STAGE_HEIGHT} * 10 / 13)`,
          marginLeft: `calc(${STAGE_HEIGHT} * -5 / 13)`,
          transformOrigin: DOOR_ORIGIN,
          containerType: "inline-size",
        }}
      >
        <Facade />

        <div
          data-spill
          aria-hidden
          className="absolute opacity-0"
          style={{
            ...SPILL,
            clipPath: "polygon(25% 0, 75% 0, 100% 100%, 0 100%)",
            background: "radial-gradient(ellipse at 50% 0%, rgba(246,217,160,.85), rgba(176,138,74,.35) 55%, transparent 80%)",
          }}
        />

        <SwingingDoor label="Enter Stoxhomes" onActivate={enter} disabled={entering} style={DOOR} />

        <p
          aria-hidden
          className="editorial absolute flex items-center justify-center border border-sand bg-beige text-center leading-tight text-wine shadow-[0_2px_0_rgba(78,10,15,.15)]"
          style={{ ...SIGN, fontSize: "max(10px, 1.9cqw)" }}
        >
          Knock to enter.
        </p>
      </motion.div>

      {/* corner controls, above the stage */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 sm:p-6">
        <a
          href="#inside"
          onClick={(e) => {
            e.preventDefault();
            skip();
          }}
          className="text-sm text-wine underline-offset-4 hover:underline"
        >
          Skip intro
        </a>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          className="numeric rounded-full border border-sand bg-beige/80 px-3 py-1.5 text-xs text-wine hover:border-brass"
        >
          {sound ? "Sound on" : "Sound off"}
        </button>
      </div>

      {/* For screen readers: the sign by the door. */}
      <p className="sr-only">Knock to enter. Activate the door to go inside.</p>
    </div>
  );
}

/** Remembers whether this browser has already walked through the front door. */

export const ENTRY_KEY = "stoxhomes:entered";

/**
 * Runs in <head> before first paint. Marks <html data-entered> for returning visitors so CSS hides
 * the intro immediately instead of flashing it until React hydrates.
 */
export const ENTRY_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  ENTRY_KEY,
)})==="1")document.documentElement.dataset.entered="1"}catch(e){}`;

export function hasEntered(): boolean {
  try {
    return window.localStorage.getItem(ENTRY_KEY) === "1";
  } catch {
    return false;
  }
}

/** Stores the visit only. Doesn't set data-entered, which would hide the intro mid-animation. */
export function markEntered(): void {
  try {
    window.localStorage.setItem(ENTRY_KEY, "1");
  } catch {
    // Storage blocked (private mode, disabled cookies): the intro simply plays again next time.
  }
}

export function forgetEntered(): void {
  delete document.documentElement.dataset.entered;
  try {
    window.localStorage.removeItem(ENTRY_KEY);
  } catch {
    // Nothing stored, nothing to forget.
  }
}

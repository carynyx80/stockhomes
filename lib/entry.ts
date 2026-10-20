/** Remembers whether this browser has already walked through the front door. */

const KEY = "stoxhomes:entered";

export function hasEntered(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markEntered(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Storage blocked (private mode, disabled cookies): the intro simply plays again next time.
  }
}

export function forgetEntered(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to forget.
  }
}

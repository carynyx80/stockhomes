import Image from "next/image";

/** The Stoxhomes lockup: house-and-candles mark above the two-tone wordmark (public/brand). */
export function Logo({ className = "", priority = false }: { className?: string; priority?: boolean }) {
  return <Image src="/brand/logo.png" alt="Stoxhomes" width={851} height={479} priority={priority} className={`h-auto ${className}`} />;
}

/** Horizontal version for tight spaces: the mark beside the wordmark. */
export function LogoInline({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image src="/brand/mark.png" alt="" width={546} height={332} priority className="h-8 w-auto sm:h-9" />
      <Image src="/brand/wordmark.png" alt="Stoxhomes" width={843} height={121} priority className="mt-1 h-4 w-auto sm:h-[19px]" />
    </span>
  );
}

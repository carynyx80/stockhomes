import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "Not available in your region", robots: { index: false } };

export default function Restricted() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-16">
      <Logo className="w-56" priority />
      <h1 className="editorial mt-8 text-4xl text-oxblood">This room is closed to you.</h1>
      <p className="mt-4 leading-relaxed text-ink/80">
        Leveraged derivatives are regulated where you appear to be, so trading and the Vault are not available
        in the United States, the United Kingdom, Canada, or sanctioned countries and regions.
      </p>
      <p className="mt-3 leading-relaxed text-ink/80">
        You can still visit the Fireplace and the Library.
      </p>
      <div className="mt-8 flex gap-6">
        <Link href="/burn" className="btn-oxblood">The Fireplace</Link>
        <Link href="/docs" className="editorial self-center text-wine hover:text-oxblood">The Library</Link>
      </div>
    </main>
  );
}

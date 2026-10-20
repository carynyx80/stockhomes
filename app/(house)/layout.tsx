import { BrassRail } from "@/components/house/BrassRail";
import { Footer } from "@/components/house/Footer";
import { HouseIntro } from "@/components/intro/HouseIntro";

export default function HouseLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HouseIntro />
      {/* data-house: made inert while the intro covers the page. */}
      <div data-house>
        <BrassRail />
        <main id="inside" tabIndex={-1} className="mx-auto max-w-7xl px-4 outline-none sm:px-6">
          {children}
        </main>
        <Footer />
      </div>
    </>
  );
}

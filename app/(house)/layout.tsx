import { BrassRail } from "@/components/house/BrassRail";
import { Footer } from "@/components/house/Footer";

export default function HouseLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrassRail />
      <main className="mx-auto max-w-7xl px-4 sm:px-6">{children}</main>
      <Footer />
    </>
  );
}

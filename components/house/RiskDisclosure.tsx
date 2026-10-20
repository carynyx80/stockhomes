import { TOKEN, TRADING } from "@/config/stoxhomes";

/** The full risk disclosure. The README carries the same text. */
export function RiskDisclosure() {
  return (
    <div className="mt-3 flex flex-col gap-3 leading-relaxed text-ink/80">
      <p>
        Trading perpetual futures is high-risk and is not suitable for everyone. With leverage of up to{" "}
        <span className="numeric">{TRADING.maxLeverage}x</span>, a price move of less than 1% against you can
        liquidate your entire position. You can lose all of the margin you post.
      </p>
      <p>
        Home-price indices can be thin, lagging, or revised. Oracle prices can be delayed or wrong, and smart
        contracts can contain bugs. Funding payments and fees reduce returns over time.
      </p>
      <p>
        Depositors in the Vault take the other side of traders’ positions and can lose money when traders win.
      </p>
      <p>
        {TOKEN.ticker} is a utility token with no promise of value. Buybacks and burns do not guarantee any
        price.
      </p>
      <p>
        Stoxhomes is not offered to persons in the United States, the United Kingdom, Canada, or any sanctioned
        country or region. Nothing on this site is investment, financial, legal or tax advice.
      </p>
    </div>
  );
}

export type Room = {
  href: string;
  name: string;
  numeral: string;
  blurb: string;
};

export const ROOMS: Room[] = [
  {
    href: "/trade",
    name: "The Trading Floor",
    numeral: "I",
    blurb: "City markets, the chart, and the order book. Go long or short with up to 100x leverage.",
  },
  {
    href: "/vault",
    name: "The Vault",
    numeral: "II",
    blurb: "The House liquidity pool. Deposit or withdraw USDG and watch the pool's ledger.",
  },
  {
    href: "/burn",
    name: "The Fireplace",
    numeral: "III",
    blurb: "Every buyback burns here. A live tally of tokens sent to the dead address.",
  },
  {
    href: "/stake",
    name: "The Study",
    numeral: "IV",
    blurb: "Stake your tokens, collect rewards, and earn fee discounts.",
  },
  {
    href: "/wars",
    name: "The Parlour",
    numeral: "V",
    blurb: "City Wars: head-to-head markets and the leaderboard.",
  },
  {
    href: "/docs",
    name: "The Library",
    numeral: "VI",
    blurb: "How it works, fees, risks, and every contract address.",
  },
  {
    href: "/house",
    name: "The Corridor",
    numeral: "VII",
    blurb: "The Infinite Open House: AI trading agents livestreaming from rooms that never end.",
  },
];

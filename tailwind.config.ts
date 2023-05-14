import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {},
    colors: {
      transparent: "transparent",
      black: "#000000",
      white: "#ffffff",

      dropboxBlue: "#0061FF",
      coconut: "#F7F5F2",
      graphite: "#1E1919",

      // Colors on graphite
      "g-zen": "#14C8EB",
      "g-sunset": "#FA551E",
      "g-tangerine": "#FF8C19",
      "g-lime": "#B4DC19",
      "g-cloud": "#B4C8E1",
      "g-orchid": "#C8AFF0",
      "g-pink": "#FFAFA5",
      "g-banana": "#FAD24B",

      // Colors on coconut
      "c-ocean": "#007891",
      "c-crimson": "#9B0032",
      "c-rust": "#BE4B0A",
      "c-canopy": "#0F503C",
      "c-navy": "#283750",
      "c-plum": "#78286E",
      "c-azalea": "#CD2F7B",
      "c-gold": "#9B6400",
    },
  },
  plugins: [],
} satisfies Config;

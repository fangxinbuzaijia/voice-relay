import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F7F5EF",
        ink: "#171A1F",
        online: "#247A52",
        warning: "#B66A12",
        danger: "#B83A3A",
      },
      fontFamily: {
        sans: ["Noto Sans SC", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      boxShadow: {
        hard: "6px 6px 0 #171A1F",
      },
    },
  },
  plugins: [],
} satisfies Config;


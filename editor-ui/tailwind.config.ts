import type { Config } from "tailwindcss";
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: "#6aa9ff",
        warn: "#ffa84a",
      },
    },
  },
  plugins: [],
} satisfies Config;

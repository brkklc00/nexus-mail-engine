import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#09090b",
        card: "#11131a",
        panel: "#171a22",
        border: "#232837",
        accent: "#6e7dff",
        success: "#17c964",
        danger: "#f31260"
      }
    }
  },
  plugins: []
};

export default config;

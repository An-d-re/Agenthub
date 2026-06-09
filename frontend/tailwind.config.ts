import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/components/**/*.{js,ts,jsx,tsx,mdx}","./src/app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: "#FAF8F5",
        foreground: "#1D1B18",
        card: { DEFAULT: "#F2EEEA", foreground: "#1D1B18" },
        muted: { DEFAULT: "#E8E4DF", foreground: "#7B7670" },
        primary: { DEFAULT: "#B8956A", foreground: "#FFFFFF" },
        secondary: { DEFAULT: "#F2EEEA", foreground: "#1D1B18" },
        accent: { DEFAULT: "#B8956A", foreground: "#FFFFFF" },
        destructive: { DEFAULT: "#D14B3D", foreground: "#FFFFFF" },
        border: "rgba(0,0,0,0.06)",
        ring: "#B8956A",
        input: "rgba(0,0,0,0.06)",
        popover: { DEFAULT: "#FAF8F5", foreground: "#1D1B18" },
      },
      borderRadius: {
        lg: "16px", md: "12px", sm: "8px",
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)','-apple-system','BlinkMacSystemFont','"PingFang SC"','"Helvetica Neue"','system-ui','sans-serif'],
        mono: ['var(--font-geist-mono)','"SF Mono"','"JetBrains Mono"','"Fira Code"','ui-monospace','monospace'],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/components/**/*.{js,ts,jsx,tsx,mdx}","./src/app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: "#FFFFFF",
        foreground: "#1D1D1F",
        card: { DEFAULT: "#FFFFFF", foreground: "#1D1D1F" },
        muted: { DEFAULT: "#F5F5F7", foreground: "#86868B" },
        primary: { DEFAULT: "#1D1D1F", foreground: "#FFFFFF" },
        secondary: { DEFAULT: "#F5F5F7", foreground: "#1D1D1F" },
        accent: { DEFAULT: "#007AFF", foreground: "#FFFFFF" },
        destructive: { DEFAULT: "#FF3B30", foreground: "#FFFFFF" },
        border: "#E5E5E7",
        ring: "#007AFF",
        input: "#E5E5E7",
        popover: { DEFAULT: "#FFFFFF", foreground: "#1D1D1F" },
      },
      borderRadius: {
        lg: "16px", md: "12px", sm: "8px",
      },
      fontFamily: {
        sans: ['-apple-system','BlinkMacSystemFont','"SF Pro Display"','"SF Pro Text"','"PingFang SC"','"Helvetica Neue"','system-ui','sans-serif'],
        mono: ['"SF Mono"','"JetBrains Mono"','"Fira Code"','ui-monospace','monospace'],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;

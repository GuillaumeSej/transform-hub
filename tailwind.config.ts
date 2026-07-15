import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Marque BearingPoint : coins droits par défaut (flat, type-led). Les cartes/tables
      // (rounded-lg/xl) deviennent carrées, les inputs/boutons gardent 2-4px, les pills restent.
      borderRadius: {
        none: "0px",
        sm: "2px",
        DEFAULT: "2px",
        md: "4px",
        lg: "0px",
        xl: "0px",
        "2xl": "0px",
        "3xl": "0px",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        background: "var(--bg-app)",
        foreground: "var(--text-primary)",
        bp: {
          "deep-red": "var(--bp-deep-red)",
          coral: "var(--bp-coral)",
          "red-brick": "var(--bp-red-brick)",
          "coral-pink": "var(--bp-coral-pink)",
          "light-pink": "var(--bp-light-pink)",
          "warm-brown": "var(--bp-warm-brown)",
          "warm-taupe": "var(--bp-warm-taupe)",
          "warm-gray": "var(--bp-warm-gray)",
          purple: "var(--bp-purple)",
        },
        neutral: {
          0: "var(--n-0)",
          50: "var(--n-50)",
          100: "var(--n-100)",
          200: "var(--n-200)",
          300: "var(--n-300)",
          400: "var(--n-400)",
          500: "var(--n-500)",
          600: "var(--n-600)",
          700: "var(--n-700)",
          900: "var(--n-900)",
        },
        rag: {
          green: "var(--green)",
          "green-light": "var(--green-light)",
          "green-dark": "var(--green-dark)",
          amber: "var(--amber)",
          "amber-light": "var(--amber-light)",
          red: "var(--red)",
          "red-light": "var(--red-light)",
        },
        info: {
          blue: "var(--blue)",
          "blue-light": "var(--blue-light)",
        },
      },
      textColor: {
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        tertiary: "var(--text-tertiary)",
      },
      borderColor: {
        DEFAULT: "var(--border)",
        strong: "var(--border-strong)",
      },
    },
  },
  plugins: [],
};
export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts}",
  ],
  safelist: [
    "col-span-1",
    "col-span-2",
    "col-span-3",
    "col-span-4",
    "sm:col-span-2",
    "lg:col-span-2",
    "lg:col-span-3",
    "lg:col-span-4",
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
          "deep-red": "rgb(var(--bp-deep-red-rgb) / <alpha-value>)",
          coral: "rgb(var(--bp-coral-rgb) / <alpha-value>)",
          "red-brick": "rgb(var(--bp-red-brick-rgb) / <alpha-value>)",
          "coral-pink": "rgb(var(--bp-coral-pink-rgb) / <alpha-value>)",
          "light-pink": "rgb(var(--bp-light-pink-rgb) / <alpha-value>)",
          "warm-brown": "rgb(var(--bp-warm-brown-rgb) / <alpha-value>)",
          "warm-taupe": "rgb(var(--bp-warm-taupe-rgb) / <alpha-value>)",
          "warm-gray": "rgb(var(--bp-warm-gray-rgb) / <alpha-value>)",
          purple: "rgb(var(--bp-purple-rgb) / <alpha-value>)",
        },
        neutral: {
          0: "rgb(var(--n-0-rgb) / <alpha-value>)",
          50: "rgb(var(--n-50-rgb) / <alpha-value>)",
          100: "rgb(var(--n-100-rgb) / <alpha-value>)",
          200: "rgb(var(--n-200-rgb) / <alpha-value>)",
          300: "rgb(var(--n-300-rgb) / <alpha-value>)",
          400: "rgb(var(--n-400-rgb) / <alpha-value>)",
          500: "rgb(var(--n-500-rgb) / <alpha-value>)",
          600: "rgb(var(--n-600-rgb) / <alpha-value>)",
          700: "rgb(var(--n-700-rgb) / <alpha-value>)",
          900: "rgb(var(--n-900-rgb) / <alpha-value>)",
        },
        rag: {
          green: "rgb(var(--green-rgb) / <alpha-value>)",
          "green-light": "rgb(var(--green-light-rgb) / <alpha-value>)",
          "green-dark": "rgb(var(--green-dark-rgb) / <alpha-value>)",
          amber: "rgb(var(--amber-rgb) / <alpha-value>)",
          "amber-light": "rgb(var(--amber-light-rgb) / <alpha-value>)",
          red: "rgb(var(--red-rgb) / <alpha-value>)",
          "red-light": "rgb(var(--red-light-rgb) / <alpha-value>)",
        },
        info: {
          blue: "rgb(var(--blue-rgb) / <alpha-value>)",
          "blue-light": "rgb(var(--blue-light-rgb) / <alpha-value>)",
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

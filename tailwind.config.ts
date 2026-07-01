import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
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

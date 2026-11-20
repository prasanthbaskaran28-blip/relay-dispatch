/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17212f",
        muted: "#718096",
        line: "#e7ebf0",
        brand: "#246b5c",
        canvas: "#f5f7fa",
      },
      boxShadow: {
        panel: "0 1px 3px rgba(16, 24, 40, 0.05)",
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/renderer/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Pretendard", "system-ui", "sans-serif"]
      },
      keyframes: {
        arrowSweep: {
          "0%, 100%": { transform: "translateX(0)", opacity: "0.72" },
          "50%": { transform: "translateX(10px)", opacity: "1" }
        }
      },
      animation: {
        arrowSweep: "arrowSweep 900ms ease-in-out infinite"
      }
    }
  },
  plugins: []
};

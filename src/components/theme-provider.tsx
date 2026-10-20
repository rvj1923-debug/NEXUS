"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Theme = "light" | "dark";

export interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
  mounted: false,
});

function applyThemeToDocument(t: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (t === "dark") {
    if (!root.classList.contains("dark")) root.classList.add("dark");
    if (root.style.colorScheme !== "dark") root.style.colorScheme = "dark";
  } else {
    if (root.classList.contains("dark")) root.classList.remove("dark");
    if (root.style.colorScheme !== "light") root.style.colorScheme = "light";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    let activeTheme: Theme = "light";

    try {
      const stored = localStorage.getItem("cpt_theme") as Theme | null;
      if (stored === "dark" || stored === "light") {
        activeTheme = stored;
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        activeTheme = "dark";
      }
    } catch {
      // localStorage may be disabled in private mode
    }

    setThemeState((prev) => (prev === activeTheme ? prev : activeTheme));
    applyThemeToDocument(activeTheme);

    // Sync with OS theme changes if user hasn't explicitly set a custom override
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = (e: MediaQueryListEvent) => {
      try {
        const currentStored = localStorage.getItem("cpt_theme");
        if (!currentStored) {
          const sysTheme: Theme = e.matches ? "dark" : "light";
          setThemeState((prev) => (prev === sysTheme ? prev : sysTheme));
          applyThemeToDocument(sysTheme);
        }
      } catch {}
    };
    mediaQuery.addEventListener("change", handleMediaChange);

    // Sync across browser tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "cpt_theme" && (e.newValue === "light" || e.newValue === "dark")) {
        const nextVal = e.newValue as Theme;
        setThemeState((prev) => (prev === nextVal ? prev : nextVal));
        applyThemeToDocument(nextVal);
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      mediaQuery.removeEventListener("change", handleMediaChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState((prev) => (prev === newTheme ? prev : newTheme));
    try {
      if (localStorage.getItem("cpt_theme") !== newTheme) {
        localStorage.setItem("cpt_theme", newTheme);
      }
    } catch {}
    applyThemeToDocument(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const nextTheme: Theme = prev === "light" ? "dark" : "light";
      try {
        localStorage.setItem("cpt_theme", nextTheme);
      } catch {}
      applyThemeToDocument(nextTheme);
      return nextTheme;
    });
  }, []);

  const contextValue = useMemo(
    () => ({ theme, toggleTheme, setTheme, mounted }),
    [theme, toggleTheme, setTheme, mounted]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

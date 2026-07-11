// Owns the rendered viewer's light/dark theme control and its persisted
// preference. The stylesheet remains responsible for following the OS when
// the reader has not chosen a theme explicitly.

const THEME_STORAGE_KEY = "big-plan-theme";

type Theme = "light" | "dark";

const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

const isTheme = (value: string | null): value is Theme =>
  value === "light" || value === "dark";

const systemTheme = (): Theme =>
  systemThemeQuery.matches ? "dark" : "light";

const selectedTheme = (): Theme => {
  const theme = document.documentElement.dataset.theme ?? null;
  return isTheme(theme) ? theme : systemTheme();
};

// Keeps the control's visible label and accessible action in sync with the
// theme currently shown, including the initial OS-selected theme.
const updateButton = (button: HTMLButtonElement): void => {
  const nextTheme = selectedTheme() === "dark" ? "light" : "dark";
  button.textContent = nextTheme === "dark" ? "☾ Dark" : "☀ Light";
  const label = `Use ${nextTheme} theme`;
  button.setAttribute("aria-label", label);
  button.title = label;
};

const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
if (button !== null) {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(storedTheme)) {
      document.documentElement.dataset.theme = storedTheme;
    }
  } catch {
    // Some file:// browser policies disable storage; toggling still works.
  }

  updateButton(button);
  systemThemeQuery.addEventListener("change", () => {
    const explicitTheme = document.documentElement.dataset.theme ?? null;
    if (!isTheme(explicitTheme)) {
      updateButton(button);
    }
  });
  button.addEventListener("click", () => {
    const nextTheme: Theme = selectedTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Keep the in-page choice even when persistence is unavailable.
    }
    updateButton(button);
  });
}

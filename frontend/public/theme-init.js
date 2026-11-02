// Applied before React renders to avoid a flash of the wrong theme (CSP: script-src 'self').
(function () {
  try {
    var t = localStorage.getItem("researchos-theme") || "system";
    var dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();

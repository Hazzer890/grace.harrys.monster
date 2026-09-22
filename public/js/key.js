// Runs before the analytics snippet so Grace's key never leaves the page,
// on first load and on a same-document #key navigation.
function takeKey() {
  try {
    if (location.hash.length > 1) {
      localStorage.setItem("key", location.hash.slice(1));
      history.replaceState(null, "", location.pathname);
    }
  } catch {}
}
takeKey();
addEventListener("hashchange", takeKey);

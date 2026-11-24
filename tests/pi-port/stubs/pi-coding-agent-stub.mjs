/** Subset of @earendil-works/pi-coding-agent used at import time. */

export function getSelectListTheme() {
  return {
    selected: (text) => text,
    text: (text) => text,
    dim: (text) => text,
  };
}

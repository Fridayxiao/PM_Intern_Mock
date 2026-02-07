import { safeJsonParse } from "../util.js";
import { PUBLIC_EMBEDDED } from "./content_embedded.js";

const PUBLIC_SCENES = "/content/public/scenes.zh-CN.json";
const PUBLIC_CARDS = "/content/public/cards.zh-CN.json";

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const err = new Error(`fetch failed: ${url} (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const parsed = safeJsonParse(await res.text());
  if (!parsed) throw new Error(`invalid json: ${url}`);
  return parsed;
}

export async function loadContentBundle() {
  try {
    const [scenes, cards] = await Promise.all([fetchJson(PUBLIC_SCENES), fetchJson(PUBLIC_CARDS)]);
    return { scenes: scenes.scenes ?? [], cards: cards.cards ?? [], meta: { mode: "public" } };
  } catch {
    return { scenes: PUBLIC_EMBEDDED.scenes, cards: PUBLIC_EMBEDDED.cards, meta: { mode: "public", fallback: "embedded" } };
  }
}

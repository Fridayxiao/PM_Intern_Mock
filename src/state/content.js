import { safeJsonParse } from "../util.js";
import { PUBLIC_EMBEDDED } from "./content_embedded.js";

const PUBLIC_SCENES = "/content/public/scenes.zh-CN.json";
const PUBLIC_CARDS = "/content/public/cards.zh-CN.json";
const PRIVATE_SCENES = "/content/private/scenes.zh-CN.json";
const PRIVATE_CARDS = "/content/private/cards.zh-CN.json";

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

export async function loadContentBundle(mode) {
  if (mode === "__probe_private__") {
    try {
      await fetchJson(PRIVATE_SCENES);
      await fetchJson(PRIVATE_CARDS);
      return { privateAvailable: true };
    } catch {
      return { privateAvailable: false };
    }
  }

  if (mode === "private") {
    const [scenes, cards] = await Promise.all([fetchJson(PRIVATE_SCENES), fetchJson(PRIVATE_CARDS)]);
    return { scenes: scenes.scenes ?? [], cards: cards.cards ?? [], meta: { mode } };
  }

  try {
    const [scenes, cards] = await Promise.all([fetchJson(PUBLIC_SCENES), fetchJson(PUBLIC_CARDS)]);
    return { scenes: scenes.scenes ?? [], cards: cards.cards ?? [], meta: { mode: "public" } };
  } catch {
    return { scenes: PUBLIC_EMBEDDED.scenes, cards: PUBLIC_EMBEDDED.cards, meta: { mode: "public", fallback: "embedded" } };
  }
}

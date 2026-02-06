import { readFile } from "node:fs/promises";

const files = [
  "public/content/public/scenes.zh-CN.json",
  "public/content/public/cards.zh-CN.json"
];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function uniqueIds(items, label) {
  const set = new Set();
  for (const it of items) {
    assert(typeof it.id === "string" && it.id.length > 0, `${label}: missing id`);
    assert(!set.has(it.id), `${label}: duplicate id: ${it.id}`);
    set.add(it.id);
  }
}

for (const file of files) {
  const raw = await readFile(file, "utf8");
  const json = JSON.parse(raw);
  if (file.includes("scenes")) {
    assert(Array.isArray(json.scenes), `${file}: scenes must be array`);
    uniqueIds(json.scenes, `${file}: scenes`);
    for (const s of json.scenes) {
      assert(typeof s.title === "string", `${file}: scene ${s.id} missing title`);
      if (s.options) {
        assert(Array.isArray(s.options), `${file}: scene ${s.id} options must be array`);
        uniqueIds(s.options.map((o) => ({ id: o.id })), `${file}: scene ${s.id} options`);
      }
      if (s.task) {
        assert(typeof s.task.type === "string", `${file}: scene ${s.id} task.type missing`);
        assert(typeof s.task.prompt === "string", `${file}: scene ${s.id} task.prompt missing`);
      }
    }
  }
  if (file.includes("cards")) {
    assert(Array.isArray(json.cards), `${file}: cards must be array`);
    uniqueIds(json.cards, `${file}: cards`);
  }
}

console.log("content validation: OK");


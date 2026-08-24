import { mkdir, writeFile } from "node:fs/promises";

const token = process.env.PROFILE_LANGUAGES_TOKEN;
const owner = process.env.PROFILE_OWNER || "LuizPoloni";

if (!token) {
  throw new Error("O secret PROFILE_LANGUAGES_TOKEN não está configurado.");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": `${owner}-profile-stack-updater`,
};

async function request(url) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`A API do GitHub respondeu com status ${response.status}.`);
  }

  return response;
}

async function listOwnedRepositories() {
  const repositories = [];
  let url = "https://api.github.com/user/repos?per_page=100&visibility=all&affiliation=owner&sort=updated";

  while (url) {
    const response = await request(url);
    repositories.push(...(await response.json()));

    const next = response.headers
      .get("link")
      ?.split(",")
      .map((part) => part.match(/<([^>]+)>; rel="([^"]+)"/))
      .find((match) => match?.[2] === "next");

    url = next?.[1] || "";
  }

  return repositories.filter(
    (repository) =>
      repository.owner?.login.toLowerCase() === owner.toLowerCase() &&
      !repository.fork,
  );
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shorten(value, limit = 16) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

const colors = {
  TypeScript: "#3178C6",
  JavaScript: "#F7DF1E",
  HTML: "#E34F26",
  CSS: "#663399",
  PHP: "#777BB4",
  Python: "#3572A5",
  Shell: "#89E051",
  Vue: "#41B883",
  Java: "#B07219",
  Kotlin: "#A97BFF",
  Go: "#00ADD8",
  Ruby: "#701516",
  Swift: "#F05138",
  Dart: "#00B4AB",
  C: "#555555",
  "C++": "#F34B7D",
  "C#": "#178600",
};

function makeTile(language, x, y) {
  const name = escapeXml(shorten(language.name));
  const color = colors[language.name] || "#8B949E";

  return `
  <g transform="translate(${x} ${y})">
    <rect width="143" height="34" rx="8" fill="#161B22" stroke="#30363D"/>
    <circle cx="18" cy="17" r="6" fill="${color}"/>
    <text x="32" y="22" fill="#C9D1D9" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="12" font-weight="600">${name}</text>
  </g>`;
}

function renderCard(languages) {
  const positions = [
    [20, 72],
    [177, 72],
    [20, 114],
    [177, 114],
    [20, 156],
    [177, 156],
  ];

  const tiles = languages
    .slice(0, positions.length)
    .map((language, index) =>
      makeTile(language, positions[index][0], positions[index][1]),
    )
    .join("");

  return `<svg width="340" height="200" viewBox="0 0 340 200" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cardBg" x1="0" y1="0" x2="340" y2="200" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0D1117"/>
      <stop offset="1" stop-color="#111318"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="339" height="199" rx="8" fill="url(#cardBg)" stroke="#30363D"/>
  <text x="20" y="33" fill="#F0F6FC" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="18" font-weight="600">Stacks detectadas</text>
  <text x="20" y="54" fill="#8B949E" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="10">PROJETOS PÚBLICOS E PRIVADOS</text>${tiles}
</svg>
`;
}

const repositories = await listOwnedRepositories();

if (!repositories.some((repository) => repository.private)) {
  throw new Error(
    "O token não possui acesso aos repositórios privados. Edite o token e selecione All repositories.",
  );
}

const languageResponses = await mapWithConcurrency(
  repositories,
  6,
  async (repository) => {
    const response = await request(repository.languages_url);
    return await response.json();
  },
);

const totals = new Map();

for (const languages of languageResponses) {
  for (const [name, bytes] of Object.entries(languages)) {
    const current = totals.get(name) || { name, bytes: 0, repositories: 0 };
    current.bytes += bytes;
    current.repositories += 1;
    totals.set(name, current);
  }
}

const languages = [...totals.values()].sort(
  (a, b) => b.repositories - a.repositories || b.bytes - a.bytes,
);

if (!languages.length) {
  throw new Error("Nenhuma linguagem foi detectada nos repositórios.");
}

await mkdir("assets", { recursive: true });
await writeFile("assets/stack-card.svg", renderCard(languages), "utf8");

console.log(
  `Cartão atualizado com ${languages.length} linguagens detectadas em ${repositories.length} repositórios.`,
);

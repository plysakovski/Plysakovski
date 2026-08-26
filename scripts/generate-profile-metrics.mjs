import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const username = process.env.GITHUB_USER || "plysakovski";
const token = process.env.GITHUB_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "profile-readme-metrics",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function github(endpoint) {
  const response = await fetch(`https://api.github.com${endpoint}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const profile = await github(`/users/${username}`);
const repositories = [];
for (let page = 1; page <= Math.max(1, Math.ceil(profile.public_repos / 100)); page += 1) {
  const batch = await github(`/users/${username}/repos?type=owner&sort=updated&per_page=100&page=${page}`);
  repositories.push(...batch.filter((repository) => !repository.fork));
  if (batch.length < 100) break;
}

const totals = repositories.reduce(
  (result, repository) => ({
    stars: result.stars + repository.stargazers_count,
    forks: result.forks + repository.forks_count,
  }),
  { stars: 0, forks: 0 },
);

const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
const active = repositories.filter((repository) => new Date(repository.pushed_at).getTime() >= cutoff).length;
const languageWeights = new Map();
for (const repository of repositories) {
  if (!repository.language) continue;
  languageWeights.set(repository.language, (languageWeights.get(repository.language) || 0) + Math.max(repository.size, 1));
}
const languages = [...languageWeights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
const languageTotal = languages.reduce((sum, [, weight]) => sum + weight, 0) || 1;
const colors = ["#A78BFA", "#8B5CF6", "#F6C85F", "#67E8F9", "#AAA4B5"];
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
const updatedAt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date());

const statCards = [
  ["REPOSITÓRIOS", profile.public_repos],
  ["SEGUIDORES", profile.followers],
  ["ESTRELAS", totals.stars],
  ["ATIVOS · 90 DIAS", active],
];

const cardsSvg = statCards.map(([label, value], index) => {
  const x = 42 + index * 188;
  return `<g transform="translate(${x} 88)"><rect width="170" height="116" rx="14" fill="#13101C" stroke="#2A2238"/><text x="18" y="35" fill="#AAA4B5" font-family="Consolas,monospace" font-size="11" letter-spacing="1.4">${escapeXml(label)}</text><text x="18" y="88" fill="#FAF9FF" font-family="Arial,sans-serif" font-size="40" font-weight="700">${value}</text></g>`;
}).join("");

const barsSvg = languages.map(([language, weight], index) => {
  const y = 100 + index * 42;
  const percentage = Math.round((weight / languageTotal) * 100);
  const width = Math.max(8, Math.round(250 * (weight / languageTotal)));
  return `<text x="820" y="${y + 8}" fill="#FAF9FF" font-family="Consolas,monospace" font-size="12">${escapeXml(language)}</text><rect x="930" y="${y - 5}" width="250" height="12" rx="6" fill="#20182E"/><rect x="930" y="${y - 5}" width="${width}" height="12" rx="6" fill="${colors[index]}"/><text x="1180" y="${y + 8}" text-anchor="end" fill="#AAA4B5" font-family="Consolas,monospace" font-size="11">${percentage}%</text>`;
}).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360" role="img" aria-labelledby="title desc">
<title id="title">Atividade pública de ${escapeXml(profile.name || profile.login)} no GitHub</title><desc id="desc">Métricas de repositórios públicos atualizadas automaticamente pela API oficial do GitHub.</desc>
<rect width="1200" height="360" rx="24" fill="#09080D"/><rect x="1" y="1" width="1198" height="358" rx="23" fill="none" stroke="#2A2238" stroke-width="2"/>
<text x="42" y="50" fill="#A78BFA" font-family="Consolas,monospace" font-size="13" letter-spacing="3">GITHUB / ATIVIDADE PÚBLICA</text><text x="1158" y="50" text-anchor="end" fill="#AAA4B5" font-family="Consolas,monospace" font-size="11">ATUALIZADO EM ${updatedAt}</text>
${cardsSvg}<path d="M790 88v192" stroke="#2A2238"/><text x="820" y="77" fill="#F6C85F" font-family="Consolas,monospace" font-size="11" letter-spacing="1.4">LINGUAGENS · PESO APROXIMADO</text>${barsSvg}
<rect x="42" y="256" width="8" height="8" fill="#67E8F9"/><text x="64" y="265" fill="#AAA4B5" font-family="Consolas,monospace" font-size="11">DADOS PÚBLICOS · FORKS EXCLUÍDOS DA ANÁLISE DE LINGUAGENS</text>
<text x="42" y="322" fill="#AAA4B5" font-family="Arial,sans-serif" font-size="14">As métricas não representam atividade em repositórios privados ou organizações com acesso restrito.</text>
</svg>`;

const outputDirectory = path.join(process.cwd(), "assets", "readme");
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "metrics.svg"), svg, "utf8");
console.log(`Metrics generated for @${username}: ${repositories.length} owned public repositories, ${totals.stars} stars, ${totals.forks} forks.`);

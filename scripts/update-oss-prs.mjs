// Rewrites the open-source PR section of README.md from live GitHub data.
// Runs in GitHub Actions (see .github/workflows/oss-prs.yml); no dependencies.
//
// PRs are ranked so the strongest work shows first:
//   merged > in review, fix/feat/perf > refactor/test/docs > dependency bumps,
//   and larger projects (by stars) rank above small ones.
import fs from 'node:fs';

const USER = 'arnavsingh0418';
// Team/hackathon repos are not open-source contributions, so they are left out.
const EXCLUDE_REPOS = ['TheMaster3558/Bridgify'];
const SHOW = 5;
const README = new URL('../README.md', import.meta.url);
const START = '<!-- OSS-PRS:START -->';
const END = '<!-- OSS-PRS:END -->';

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'oss-prs-readme',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function get(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub request failed (${res.status}) for ${url}: ${await res.text()}`);
  return res.json();
}

async function search(state) {
  const q = [`is:pr author:${USER} -user:${USER} is:${state}`, ...EXCLUDE_REPOS.map((r) => `-repo:${r}`)].join(' ');
  return (await get(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=100`)).items;
}

// Conventional-commit prefix -> what kind of work it is and how much it counts.
const KINDS = [
  { match: /^(fix|bug|hotfix)\b/i, label: 'Bug fix', weight: 3 },
  { match: /^(feat|feature)\b/i, label: 'Feature', weight: 3 },
  { match: /^perf\b/i, label: 'Performance', weight: 3 },
  { match: /^(refactor|test)\b/i, label: 'Refactor', weight: 2 },
  { match: /^docs?\b/i, label: 'Docs', weight: 1 },
  { match: /^(chore|build|ci|deps)\b|\bbump\b/i, label: 'Maintenance', weight: 1 },
];
const kindOf = (title) => KINDS.find((k) => k.match.test(title)) ?? { label: 'Contribution', weight: 2 };

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const repoOf = (pr) => pr.repository_url.split('/repos/')[1];
// "fix(fonts): load the selected weights" -> "Load the selected weights"
const cleanTitle = (t) => {
  const s = t.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fmtStars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);

const [merged, open] = await Promise.all([search('merged'), search('open')]);
const prs = [...merged.map((pr) => ({ pr, merged: true })), ...open.map((pr) => ({ pr, merged: false }))];

const repos = [...new Set(prs.map(({ pr }) => repoOf(pr)))];
const stars = Object.fromEntries(
  await Promise.all(repos.map(async (r) => [r, (await get(`https://api.github.com/repos/${r}`)).stargazers_count]))
);

// An open PR counts as approved when each reviewer's latest verdict leaves at least
// one approval and no outstanding "changes requested".
async function isApproved(pr) {
  const reviews = await get(`https://api.github.com/repos/${repoOf(pr)}/pulls/${pr.number}/reviews?per_page=100`);
  const latest = new Map();
  for (const r of reviews) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) latest.set(r.user?.login, r.state);
  }
  const verdicts = [...latest.values()];
  return verdicts.includes('APPROVED') && !verdicts.includes('CHANGES_REQUESTED');
}

await Promise.all(
  prs.map(async (item) => {
    item.approved = !item.merged && (await isApproved(item.pr));
    item.kind = kindOf(item.pr.title);
    item.score =
      (item.merged ? 10 : item.approved ? 5 : 0) + item.kind.weight * 2 + Math.log10(stars[repoOf(item.pr)] + 1);
  })
);
prs.sort((a, b) => b.score - a.score);
const approved = prs.filter((p) => p.approved).length;

function row({ pr, merged, approved, kind }) {
  const repo = repoOf(pr);
  const status = merged ? '<b>Merged</b>' : approved ? '<b>Approved</b>' : 'In review';
  return `<tr>
    <td><a href="${pr.html_url}"><b>${repo}</b> #${pr.number}</a><br/><sub>${escape(cleanTitle(pr.title))}</sub></td>
    <td>${kind.label}</td>
    <td>${status}</td>
    <td align="right">${fmtStars(stars[repo])}★</td>
  </tr>`;
}

// Only show counts that are above zero.
const counts = [
  merged.length && `<b>${merged.length}</b> merged`,
  approved && `<b>${approved}</b> approved`,
  open.length - approved && `<b>${open.length - approved}</b> in review`,
].filter(Boolean);
const summary = `${counts.join(' · ')} · across <b>${repos.length}</b> open-source projects`;

const section = prs.length
  ? `${START}
<p>${summary}</p>
<table>
  <tr><th align="left">Pull request</th><th align="left">Type</th><th align="left">Status</th><th align="right">Repo stars</th></tr>
  ${prs.slice(0, SHOW).map(row).join('\n  ')}
</table>
<sub>Ranked by impact and updated automatically from GitHub once a day.</sub>
${END}`
  : `${START}
<p><i>First contributions coming soon.</i></p>
${END}`;

const readme = fs.readFileSync(README, 'utf8');
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) throw new Error(`README.md needs ${START} and ${END} markers`);
const next = readme.slice(0, start) + section + readme.slice(end + END.length);
if (next !== readme) {
  fs.writeFileSync(README, next);
  console.log(`Updated: ${merged.length} merged, ${open.length} open, ${repos.length} projects`);
} else {
  console.log('No change');
}

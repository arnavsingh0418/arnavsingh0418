// Rewrites the open-source PR section of README.md from live GitHub data.
// Runs in GitHub Actions (see .github/workflows/oss-prs.yml); no dependencies.
import fs from 'node:fs';

const USER = 'arnavsingh0418';
// Team/hackathon repos are not open-source contributions, so they are left out.
const EXCLUDE_REPOS = ['TheMaster3558/Bridgify'];
const SHOW = 3;
const README = new URL('../README.md', import.meta.url);
const START = '<!-- OSS-PRS:START -->';
const END = '<!-- OSS-PRS:END -->';

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'oss-prs-readme',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function search(state) {
  const q = [`is:pr author:${USER} -user:${USER} is:${state}`, ...EXCLUDE_REPOS.map((r) => `-repo:${r}`)].join(' ');
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=100`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub search failed (${res.status}): ${await res.text()}`);
  return (await res.json()).items;
}

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const repoOf = (pr) => pr.repository_url.split('/repos/')[1];

function list(prs, empty) {
  if (!prs.length) return `<i>${empty}</i>`;
  return prs
    .map((pr) => `<a href="${pr.html_url}"><b>${repoOf(pr)}</b> #${pr.number}</a><br/><sub>${escape(pr.title)}</sub>`)
    .join('<br/><br/>');
}

const [merged, open] = await Promise.all([search('merged'), search('open')]);
merged.sort((a, b) => b.pull_request.merged_at.localeCompare(a.pull_request.merged_at));
open.sort((a, b) => b.created_at.localeCompare(a.created_at));
const projects = new Set([...merged, ...open].map(repoOf)).size;

const section = `${START}
<p><b>${merged.length}</b> merged · <b>${open.length}</b> in review · across <b>${projects}</b> open-source projects</p>
<table>
  <tr><th width="50%">✅ Recently merged</th><th width="50%">⏳ In review</th></tr>
  <tr>
    <td valign="top">${list(merged.slice(0, SHOW), 'None merged yet: the first ones are in review.')}</td>
    <td valign="top">${list(open.slice(0, SHOW), 'Nothing in review right now.')}</td>
  </tr>
</table>
<sub>Updated automatically from GitHub once a day.</sub>
${END}`;

const readme = fs.readFileSync(README, 'utf8');
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) throw new Error(`README.md needs ${START} and ${END} markers`);
const next = readme.slice(0, start) + section + readme.slice(end + END.length);
if (next !== readme) {
  fs.writeFileSync(README, next);
  console.log(`Updated: ${merged.length} merged, ${open.length} open, ${projects} projects`);
} else {
  console.log('No change');
}

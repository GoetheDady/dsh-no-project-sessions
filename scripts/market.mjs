#!/usr/bin/env node
// Regenerate market/index.json — the DSH plugin market index (format 1) that lists this plugin.
//
//   node scripts/market.mjs            rewrite the index for the current HEAD commit
//   node scripts/market.mjs --check    validate the committed index without rewriting it
//   MARKET_COMMIT=<sha> node scripts/market.mjs   pin a release commit other than HEAD
//
// The index is validated with @deepseek-ai/dsh-plugin-market-index, the same validator DSH
// uses when it reads a market, so a broken index fails here instead of in someone's Discover tab.

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const root = fileURLToPath(new URL('..', import.meta.url))
const indexPath = join(root, 'market', 'index.json')
const check = process.argv.includes('--check')

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const commit = process.env.MARKET_COMMIT ?? git('rev-parse', 'HEAD')
const publishTimestamp = Number(git('show', '-s', '--format=%ct', commit))

const repoUrl = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '')
const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/u.exec(repoUrl)
if (match === null) throw new Error(`package.json repository.url must be https://github.com/<owner>/<repo>, got ${repoUrl}`)
const [, owner, repo] = match
const indexUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/market/index.json`

const existing = check ? JSON.parse(await readFile(indexPath, 'utf8')) : undefined

const index = {
  format: 1,
  title: { en: `${owner} · DSH plugins`, zh: `${owner} · DSH 插件` },
  description: {
    en: `DeepSeek Harness plugins published by ${owner}.`,
    zh: `${owner} 发布的 DeepSeek Harness 插件。`,
  },
  metadata: {
    categories: { session: { title: { en: 'Sessions', zh: '会话' } } },
    labels: {
      'web-ui': { title: { en: 'Web UI', zh: 'Web 界面' } },
      'no-project': { title: { en: 'No project', zh: '无项目' } },
    },
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: 'No-project Sessions', zh: '无项目会话' },
      description: {
        en: 'Create a private working directory for sessions that do not belong to a project, and list them under Recent.',
        zh: '为不属于任何项目的会话自动创建独立工作目录，并在侧栏“最近”中集中展示。',
      },
      icon: `https://raw.githubusercontent.com/${owner}/${repo}/main/icon.svg`,
      author: owner,
      homepage: `https://github.com/${owner}/${repo}#readme`,
      repository: { url: repoUrl },
      metadata: {
        category: 'session',
        keywords: ['no-project', 'sessions', 'recent', 'workspace', 'scratch'],
        labels: ['web-ui', 'no-project'],
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp,
          source: { type: 'git', url: repoUrl, commit },
          engines: { dsh: '>=0.2.0 <0.3.0' },
        },
      ],
    },
  ],
}

const parsed = parseMarketIndex(index, indexUrl)
if (check && JSON.stringify(parsed) !== JSON.stringify(parseMarketIndex(existing, indexUrl))) {
  throw new Error('market/index.json is stale; run `npm run market` and commit the result')
}

if (!check) {
  await mkdir(dirname(indexPath), { recursive: true })
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`)
}

const [plugin] = parsed.plugins
const [version] = plugin.versions
const target = marketInstallTarget(plugin.name, version)
console.log(`${check ? 'valid' : 'wrote'} market/index.json  ${indexUrl}`)
console.log(`  ${plugin.name}@${version.version}  ${version.publishTimestamp}  ${commit.slice(0, 12)}`)
console.log(`  install: ${target.spec}${target.registry === undefined ? '' : ` (registry ${target.registry})`}`)

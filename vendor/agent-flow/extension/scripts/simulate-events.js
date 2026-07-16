#!/usr/bin/env node
/**
 * Simulates a live agent session by writing events to a JSONL file incrementally.
 * Usage: node scripts/simulate-events.js [output-file]
 *
 * The visualizer extension watches this file and streams events to the webview.
 */

const fs = require('fs')
const path = require('path')

const outputFile = process.argv[2] || path.join(__dirname, '..', 'live-events.jsonl')

const events = [
  { time: 0.0, type: 'agent_spawn', payload: { name: 'orchestrator', isMain: true, task: 'Refactor database module' } },
  { time: 0.5, type: 'context_update', payload: { agent: 'orchestrator', tokens: 1500, breakdown: { systemPrompt: 1200, userMessages: 300, toolResults: 0, reasoning: 0, subagentResults: 0 } } },
  { time: 1.0, type: 'message', payload: { agent: 'orchestrator', content: 'Analyzing database module structure...' } },
  { time: 2.0, type: 'tool_call_start', payload: { agent: 'orchestrator', tool: 'Glob', args: 'src/db/**/*.ts', preview: 'Finding database files...' } },
  { time: 3.0, type: 'tool_call_end', payload: { agent: 'orchestrator', tool: 'Glob', result: '12 files found', tokenCost: 200 } },
  { time: 3.5, type: 'tool_call_start', payload: { agent: 'orchestrator', tool: 'Read', args: 'src/db/connection.ts', preview: 'Reading connection pool...' } },
  { time: 4.5, type: 'tool_call_end', payload: { agent: 'orchestrator', tool: 'Read', result: 'Connection pool — 200 lines', tokenCost: 3000, discovery: { type: 'file', label: 'src/db/connection.ts', content: 'Connection pool manager\n200 lines, retry logic' } } },
  { time: 5.0, type: 'context_update', payload: { agent: 'orchestrator', tokens: 8000, breakdown: { systemPrompt: 1200, userMessages: 300, toolResults: 3200, reasoning: 3300, subagentResults: 0 } } },
  { time: 6.0, type: 'subagent_dispatch', payload: { parent: 'orchestrator', child: 'migration-agent', task: 'Check migration history' } },
  { time: 6.5, type: 'agent_spawn', payload: { name: 'migration-agent', parent: 'orchestrator', task: 'Check migration history' } },
  { time: 7.0, type: 'tool_call_start', payload: { agent: 'migration-agent', tool: 'Bash', args: 'npx prisma migrate status', preview: 'Checking migration status...' } },
  { time: 8.5, type: 'tool_call_end', payload: { agent: 'migration-agent', tool: 'Bash', result: '5 migrations applied, 0 pending', tokenCost: 300, discovery: { type: 'finding', label: 'Migrations OK', content: '5 applied, 0 pending\nLast: add_user_roles' } } },
  { time: 9.0, type: 'subagent_return', payload: { child: 'migration-agent', parent: 'orchestrator', summary: 'All migrations up to date' } },
  { time: 9.0, type: 'agent_complete', payload: { name: 'migration-agent' } },
  { time: 10.0, type: 'tool_call_start', payload: { agent: 'orchestrator', tool: 'Edit', args: 'src/db/connection.ts — refactor pool', preview: 'Refactoring connection pool...' } },
  { time: 12.0, type: 'tool_call_end', payload: { agent: 'orchestrator', tool: 'Edit', result: 'Refactored connection pool with retry backoff', tokenCost: 200 } },
  { time: 13.0, type: 'message', payload: { agent: 'orchestrator', content: 'Database module refactored. Connection pool now uses exponential backoff.' } },
  { time: 13.5, type: 'agent_complete', payload: { name: 'orchestrator' } },
]

// Clear the file
fs.writeFileSync(outputFile, '')
console.log(`Writing events to: ${outputFile}`)
console.log(`${events.length} events, simulating over ${events[events.length - 1].time}s\n`)

let index = 0
const startTime = Date.now()

function writeNext() {
  if (index >= events.length) {
    console.log('\nDone! All events written.')
    process.exit(0)
  }

  const event = events[index]
  const elapsed = (Date.now() - startTime) / 1000
  const delay = Math.max(0, (event.time - elapsed) * 1000)

  setTimeout(() => {
    fs.appendFileSync(outputFile, JSON.stringify(event) + '\n')
    console.log(`[${event.time.toFixed(1)}s] ${event.type}: ${JSON.stringify(event.payload).slice(0, 80)}...`)
    index++
    writeNext()
  }, delay)
}

writeNext()

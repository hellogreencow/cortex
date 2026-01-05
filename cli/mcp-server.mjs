import path from 'node:path';
import fs from 'node:fs/promises';

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const DATA_DIR = process.env.CORTEX_DATA_DIR || path.join(process.cwd(), '.cortex');
const CAPSULES_DIR = path.join(DATA_DIR, 'capsules');
const DIAGNOSES_DIR = path.join(DATA_DIR, 'diagnoses');

async function ensureDirs() {
  await fs.mkdir(CAPSULES_DIR, { recursive: true });
  await fs.mkdir(DIAGNOSES_DIR, { recursive: true });
}

function textResult(text, isError = false) {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function listCapsuleIds(limit = 20) {
  await ensureDirs();
  const entries = await fs.readdir(CAPSULES_DIR, { withFileTypes: true });
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name);

  const withTimes = await Promise.all(
    jsonFiles.map(async (name) => {
      const fullPath = path.join(CAPSULES_DIR, name);
      const st = await fs.stat(fullPath);
      return { name, mtimeMs: st.mtimeMs };
    })
  );

  return withTimes
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((x) => x.name.replace(/\.json$/, ''));
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function getCapsule(id) {
  await ensureDirs();
  const filePath = path.join(CAPSULES_DIR, `${id}.json`);
  return await readJsonFile(filePath);
}

async function getDiagnosis(id) {
  await ensureDirs();
  const filePath = path.join(DIAGNOSES_DIR, `${id}.txt`);
  return await fs.readFile(filePath, 'utf8');
}

const server = new McpServer(
  { name: 'cortex', version: '0.1.0' },
  {
    instructions:
      'CORTEX MCP exposes browser-captured bug capsules (runtime evidence) for use by coding agents (Claude Code, Cursor, etc.).\n' +
      'Typical flow: call cortex_get_last_capsule, then reason over it and propose a patch in the repo.\n' +
      'Capsules/diagnoses are stored under ./.cortex by default.',
  }
);

server.registerTool(
  'cortex_list_capsules',
  {
    description: 'List captured bug capsule IDs (newest first).',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(200).optional(),
    }),
  },
  async ({ limit }) => {
    try {
      const ids = await listCapsuleIds(limit ?? 20);
      return textResult(JSON.stringify({ ids }, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return textResult(`Failed to list capsules: ${msg}`, true);
    }
  }
);

server.registerTool(
  'cortex_get_capsule',
  {
    description: 'Get a captured bug capsule by ID (JSON).',
    inputSchema: z.object({
      id: z.string().min(1),
    }),
  },
  async ({ id }) => {
    try {
      const capsule = await getCapsule(id);
      return textResult(JSON.stringify(capsule, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return textResult(`Failed to read capsule ${id}: ${msg}`, true);
    }
  }
);

server.registerTool(
  'cortex_get_last_capsule',
  {
    description: 'Get the most recent bug capsule (JSON).',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const [id] = await listCapsuleIds(1);
      if (!id) return textResult('No capsules found.', true);
      const capsule = await getCapsule(id);
      return textResult(JSON.stringify(capsule, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return textResult(`Failed to read last capsule: ${msg}`, true);
    }
  }
);

server.registerTool(
  'cortex_get_diagnosis',
  {
    description: 'Get the diagnosis text for a capsule ID (if present).',
    inputSchema: z.object({
      id: z.string().min(1),
    }),
  },
  async ({ id }) => {
    try {
      const text = await getDiagnosis(id);
      return textResult(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return textResult(`Failed to read diagnosis ${id}: ${msg}`, true);
    }
  }
);

server.registerTool(
  'cortex_get_last_diagnosis',
  {
    description: 'Get the most recent diagnosis text (if present).',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const [id] = await listCapsuleIds(1);
      if (!id) return textResult('No capsules found.', true);
      const text = await getDiagnosis(id);
      return textResult(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return textResult(`Failed to read last diagnosis: ${msg}`, true);
    }
  }
);

// Start stdio transport (for Claude Code / Cursor MCP integrations).
await ensureDirs();
await server.connect(new StdioServerTransport());


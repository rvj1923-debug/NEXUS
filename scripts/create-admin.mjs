#!/usr/bin/env node
/**
 * CLI Tool for Creating Administrator Users
 * Usage:
 *   node scripts/create-admin.mjs --email=<email> --name="<Full Name>" --password-file=<path>
 *   echo <password> | node scripts/create-admin.mjs --email=<email> --name="<Full Name>" --password-stdin
 *   node scripts/create-admin.mjs <email> <password> "<Full Name>"
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import readline from "node:readline";
import { loadEnvIfNeeded } from "./backup-db.mjs";

loadEnvIfNeeded();

const prisma = new PrismaClient();

async function promptInteractive(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function readAllStdinLines() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s, idx, arr) => idx < arr.length - 1 || s.length > 0);
}

function parseCliArgs(argv) {
  let email = "";
  let password = "";
  let fullName = "";
  let passwordFile = process.env.ADMIN_PASSWORD_FILE || "";
  let passwordStdin = false;
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--password-stdin") {
      passwordStdin = true;
    } else if (arg.startsWith("--password-file=")) {
      passwordFile = arg.slice("--password-file=".length).trim();
    } else if (arg === "--password-file" && i + 1 < argv.length) {
      passwordFile = argv[++i].trim();
    } else if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length).trim();
    } else if (arg === "--email" && i + 1 < argv.length) {
      email = argv[++i].trim();
    } else if (arg.startsWith("--name=")) {
      fullName = arg.slice("--name=".length).trim();
    } else if (arg === "--name" && i + 1 < argv.length) {
      fullName = argv[++i].trim();
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  if (passwordFile || passwordStdin) {
    if (!email && positional[0]) email = positional[0];
    if (!fullName && positional[1]) fullName = positional[1];
  } else {
    if (!email && positional[0]) email = positional[0];
    if (!password && positional[1]) password = positional[1];
    if (!fullName && positional[2]) fullName = positional[2];
  }

  return { email, password, fullName, passwordFile, passwordStdin };
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  let { email, password, fullName } = parsed;
  const { passwordFile, passwordStdin } = parsed;

  console.log("=================================================");
  console.log("   Company Phone Tracker - Administrator Provisioning");
  console.log("=================================================\n");

  if (passwordFile) {
    if (!fs.existsSync(passwordFile)) {
      console.error(`Error: Password file not found: ${passwordFile}`);
      process.exit(1);
    }
    password = fs.readFileSync(passwordFile, "utf8").replace(/^\uFEFF/, "").trim();
  } else if (passwordStdin || (!process.stdin.isTTY && (!email || !password || !fullName))) {
    const lines = await readAllStdinLines();
    let idx = 0;
    if (passwordStdin) {
      password = lines[idx++] || "";
      if (!email && lines[idx]) email = lines[idx++];
      if (!fullName && lines[idx]) fullName = lines[idx++];
    } else {
      if (!email && lines[idx]) email = lines[idx++];
      if (!password && lines[idx]) password = lines[idx++];
      if (!fullName && lines[idx]) fullName = lines[idx++];
    }
  }

  if (!email && process.stdin.isTTY) {
    email = await promptInteractive("Enter Administrator Email: ");
  }
  if (!password && process.stdin.isTTY) {
    password = await promptInteractive("Enter Administrator Password (min 8 chars): ");
  }
  if (!fullName && process.stdin.isTTY) {
    fullName = await promptInteractive("Enter Administrator Full Name: ");
  }
  if (!fullName) {
    fullName = "System Administrator";
  }

  if (!email || !password || !fullName) {
    console.error("Error: Email, password, and full name are required.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Error: Password must be at least 8 characters long.");
    process.exit(1);
  }

  console.log(`\nProvisioning administrator account for: ${email}...`);

  const adminRole = await prisma.role.upsert({
    where: { code: "SYSTEM_ADMIN" },
    update: {},
    create: {
      code: "SYSTEM_ADMIN",
      name: "System Administrator",
      description: "Full administrative access across all modules and settings",
      isSystem: true,
    },
  });

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      fullName,
      passwordHash,
      isActive: true,
    },
    create: {
      email,
      fullName,
      passwordHash,
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: adminRole.id,
    },
  });

  // Log in audit log
  await prisma.auditLog.create({
    data: {
      action: "ADMIN_PROVISIONED",
      entityType: "USER",
      entityId: user.id,
      userEmail: email,
      userRole: "SYSTEM_ADMIN",
      changes: JSON.stringify({ email, fullName, role: "SYSTEM_ADMIN" }),
    },
  });

  console.log(`\nSUCCESS: Administrator account '${email}' created/updated successfully.`);
  console.log(`Role assigned: SYSTEM_ADMIN`);
  console.log(`Audit log recorded.\n`);
}

main()
  .catch((err) => {
    console.error("Failed to provision administrator:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


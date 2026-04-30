import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { encryptSmtpSecret } from "@nexus/security";

const prisma = new PrismaClient();

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  if (process.env.ENABLE_SEED !== "true") {
    console.log("Seed skipped (ENABLE_SEED=false)");
    return;
  }

  const adminEmail = (process.env.ADMIN_EMAIL ?? "admin@nexus.local").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      name: "Nexus Admin",
      role: "admin",
      passwordHash: hashPassword(adminPassword),
      isActive: true
    },
    update: {
      name: "Nexus Admin",
      role: "admin",
      isActive: true
    }
  });

  const smtp = await prisma.smtpAccount.upsert({
    where: { id: "00000000-0000-0000-0000-000000000111" },
    create: {
      id: "00000000-0000-0000-0000-000000000111",
      name: "Alibaba Primary",
      host: "smtpdm.aliyun.com",
      port: 465,
      encryption: "ssl",
      username: "user@example.com",
      passwordEncrypted: encryptSmtpSecret(process.env.SEED_SMTP_PASSWORD ?? "replace-me"),
      fromEmail: "ops@nexus.local",
      fromName: "Nexus Ops",
      providerLabel: "alibaba",
      isActive: true,
      targetRatePerSecond: 15,
      alibabaRateCap: 12,
      maxRatePerSecond: 30,
      alibabaWarmupMaxRatePerSecond: 10
    },
    update: {
      isActive: true,
      providerLabel: "alibaba",
      passwordEncrypted: encryptSmtpSecret(process.env.SEED_SMTP_PASSWORD ?? "replace-me")
    }
  });

  const templateA = await prisma.mailTemplate.upsert({
    where: { id: "00000000-0000-0000-0000-000000000201" },
    create: {
      id: "00000000-0000-0000-0000-000000000201",
      title: "Welcome Pulse",
      subject: "Welcome to Nexus",
      htmlBody:
        "<html><body><h1>Hello {{first_name}}</h1><p>Welcome aboard.</p><p><a href='https://example.com/start'>Start</a></p>{{tracking_pixel}}</body></html>",
      plainTextBody: "Hello {{first_name}}. Welcome aboard.",
      status: "active"
    },
    update: { status: "active" }
  });

  const templateB = await prisma.mailTemplate.upsert({
    where: { id: "00000000-0000-0000-0000-000000000202" },
    create: {
      id: "00000000-0000-0000-0000-000000000202",
      title: "Retention Trigger",
      subject: "We Miss You",
      htmlBody:
        "<html><body><h1>Hi {{name}}</h1><p>Come back for new features.</p><p><a href='https://example.com/return'>Return</a></p>{{tracking_pixel}}</body></html>",
      plainTextBody: "Hi {{name}}, come back for new features.",
      status: "active"
    },
    update: { status: "active" }
  });

  const list = await prisma.recipientList.upsert({
    where: { id: "00000000-0000-0000-0000-000000000301" },
    create: {
      id: "00000000-0000-0000-0000-000000000301",
      name: "Seed List",
      tags: ["seed", "ops"],
      maxSize: 500
    },
    update: {}
  });

  const seedRecipients = [
    {
      id: "00000000-0000-0000-0000-000000000401",
      email: "alice@example.com",
      firstName: "Alice",
      lastName: "Sender"
    },
    {
      id: "00000000-0000-0000-0000-000000000402",
      email: "bob@example.com",
      firstName: "Bob",
      lastName: "Receiver"
    },
    {
      id: "00000000-0000-0000-0000-000000000403",
      email: "carol@example.com",
      firstName: "Carol",
      lastName: "Operator"
    }
  ];

  for (const item of seedRecipients) {
    const recipient = await prisma.recipient.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        email: item.email,
        emailNormalized: item.email.toLowerCase(),
        name: `${item.firstName} ${item.lastName}`,
        firstName: item.firstName,
        lastName: item.lastName,
        tags: ["seed"],
        status: "active"
      },
      update: {
        email: item.email,
        emailNormalized: item.email.toLowerCase(),
        status: "active"
      }
    });

    await prisma.recipientListMembership.upsert({
      where: {
        listId_recipientId: { listId: list.id, recipientId: recipient.id }
      },
      create: {
        listId: list.id,
        recipientId: recipient.id
      },
      update: {}
    });
  }

  await prisma.rateLimitConfig.upsert({
    where: { id: "00000000-0000-0000-0000-000000000901" },
    create: {
      id: "00000000-0000-0000-0000-000000000901",
      globalMaxRatePerSecond: 50,
      smtpDefaultTargetRatePerSecond: 8
    },
    update: {
      globalMaxRatePerSecond: 50
    }
  });

  console.log("Seed complete", {
    adminEmail,
    adminPasswordHint: "from ADMIN_PASSWORD env",
    smtp: smtp.name,
    templates: [templateA.title, templateB.title],
    list: list.name
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

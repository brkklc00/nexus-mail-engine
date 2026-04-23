import { PrismaClient } from "@prisma/client";
import {
  decryptSmtpSecret,
  encryptSmtpSecret,
  getCurrentSecretVersion,
  getSecretVersion
} from "@nexus/security";

const prisma = new PrismaClient();

type RotationMode = "dry-run" | "apply";

function parseMode(): RotationMode {
  return process.argv.includes("--apply") ? "apply" : "dry-run";
}

async function main() {
  const mode = parseMode();
  const currentVersion = getCurrentSecretVersion();
  const rows = await prisma.smtpAccount.findMany({
    select: {
      id: true,
      name: true,
      passwordEncrypted: true
    },
    orderBy: { createdAt: "asc" }
  });

  const plan = rows.map((row) => {
    const oldVersion = getSecretVersion(row.passwordEncrypted);
    const plain = decryptSmtpSecret(row.passwordEncrypted);
    const rotated = encryptSmtpSecret(plain);
    const newVersion = getSecretVersion(rotated);
    const needsRotation = oldVersion !== currentVersion || !oldVersion;

    return {
      id: row.id,
      name: row.name,
      oldVersion: oldVersion ?? "legacy-plain",
      newVersion: newVersion ?? "unknown",
      needsRotation,
      rotated
    };
  });

  const targets = plan.filter((item) => item.needsRotation);
  if (mode === "dry-run") {
    console.log(
      JSON.stringify(
        {
          mode,
          currentVersion,
          total: rows.length,
          toRotate: targets.length,
          targets: targets.map((t) => ({
            id: t.id,
            name: t.name,
            oldVersion: t.oldVersion,
            newVersion: t.newVersion
          }))
        },
        null,
        2
      )
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const target of targets) {
      const result = await tx.smtpAccount.updateMany({
        where: {
          id: target.id,
          passwordEncrypted: {
            equals: rows.find((row) => row.id === target.id)?.passwordEncrypted
          }
        },
        data: {
          passwordEncrypted: target.rotated
        }
      });
      if (result.count !== 1) {
        throw new Error(`rotation_conflict:${target.id}`);
      }
      await tx.auditLog.create({
        data: {
          action: "smtp.secret.rotation",
          resource: "smtp_account",
          resourceId: target.id,
          metadata: {
            oldVersion: target.oldVersion,
            newVersion: target.newVersion
          }
        }
      });
    }
  });

  console.log(
    JSON.stringify(
      {
        mode,
        currentVersion,
        rotated: targets.length,
        rotatedIds: targets.map((item) => item.id)
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

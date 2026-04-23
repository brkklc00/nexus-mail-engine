import { PrismaClient } from "@prisma/client";
import { decryptSmtpSecret, getCurrentSecretVersion, getSecretVersion } from "@nexus/security";

const prisma = new PrismaClient();

async function main() {
  const currentVersion = getCurrentSecretVersion();
  const rows = await prisma.smtpAccount.findMany({
    select: { id: true, name: true, passwordEncrypted: true }
  });

  const report = rows.map((row) => {
    let decryptOk = false;
    try {
      const plain = decryptSmtpSecret(row.passwordEncrypted);
      decryptOk = plain.length > 0;
    } catch {
      decryptOk = false;
    }
    const version = getSecretVersion(row.passwordEncrypted) ?? "legacy-plain";
    return {
      id: row.id,
      name: row.name,
      decryptOk,
      version,
      onCurrentVersion: version === currentVersion
    };
  });

  const failures = report.filter((item) => !item.decryptOk);
  const stale = report.filter((item) => item.decryptOk && !item.onCurrentVersion);

  console.log(
    JSON.stringify(
      {
        currentVersion,
        total: report.length,
        decryptFailures: failures.length,
        staleVersionCount: stale.length,
        details: report
      },
      null,
      2
    )
  );

  if (failures.length > 0) {
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { prisma } from "@nexus/db";
import { getEffectiveRateForSmtp } from "../rate/effective-rate-runtime.service.js";

async function run() {
  const smtpId = process.argv[2];
  if (!smtpId) {
    throw new Error("Usage: pnpm --filter @nexus/worker test:rate <smtpId>");
  }

  const before = await getEffectiveRateForSmtp(smtpId);
  await prisma.smtpWarmupStat.upsert({
    where: {
      smtpAccountId_date: {
        smtpAccountId: smtpId,
        date: new Date(new Date().setHours(0, 0, 0, 0))
      }
    },
    create: {
      smtpAccountId: smtpId,
      date: new Date(new Date().setHours(0, 0, 0, 0)),
      successfulDeliveries: 600000
    },
    update: {
      successfulDeliveries: 600000
    }
  });
  const afterWarmup = await getEffectiveRateForSmtp(smtpId);

  await prisma.smtpAccount.update({
    where: { id: smtpId },
    data: { isThrottled: true, throttleReason: "runtime_test" }
  });
  const throttled = await getEffectiveRateForSmtp(smtpId);
  await prisma.smtpAccount.update({
    where: { id: smtpId },
    data: { isThrottled: false, throttleReason: null }
  });

  console.log(
    JSON.stringify(
      {
        before,
        afterWarmup,
        throttled,
        assertions: {
          warmupIncreasedOrEqual: afterWarmup.effectiveRatePerSecond >= before.effectiveRatePerSecond,
          throttleReduced: throttled.effectiveRatePerSecond < afterWarmup.effectiveRatePerSecond
        }
      },
      null,
      2
    )
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

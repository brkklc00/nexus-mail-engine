import { z } from "zod";

export const recipientImportRowSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.unknown()).optional()
});

export const campaignSendSchema = z.object({
  campaignId: z.string().uuid(),
  templateId: z.string().uuid(),
  smtpAccountId: z.string().uuid(),
  sendMode: z.enum(["classic", "live"]),
  scheduleAt: z.coerce.date().optional()
});

export const smtpAccountSchema = z.object({
  name: z.string().min(2),
  host: z.string().min(3),
  port: z.number().int().positive(),
  encryption: z.enum(["ssl", "tls", "none"]),
  username: z.string(),
  password: z.string().min(6),
  fromEmail: z.string().email(),
  fromName: z.string().optional(),
  providerLabel: z.string().optional(),
  maxConnections: z.number().int().positive().optional(),
  maxMessages: z.number().int().positive().optional(),
  dailyCap: z.number().int().positive().optional(),
  hourlyCap: z.number().int().positive().optional(),
  targetRatePerSecond: z.number().positive().optional()
});

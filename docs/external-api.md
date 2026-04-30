# Nexus External API

External API base URL:

- `https://mail.hub-nexus.com/api/external/v1`

## Authentication

- Header is required on every external endpoint:
  - `Authorization: Bearer <EXTERNAL_API_KEY>`
- Env:
  - `EXTERNAL_API_KEY=strong_random_key`

If auth fails:

```json
{ "ok": false, "error": "unauthorized" }
```

## CORS

- Env:
  - `EXTERNAL_API_ALLOWED_ORIGINS=https://other-panel.com,https://admin.other.com`
- If `Origin` header exists and is not in allow-list:

```json
{ "ok": false, "error": "forbidden_origin" }
```

- `OPTIONS` preflight is supported.

## Rate Limit

- 60 requests/minute per API key + IP.
- On limit:
  - HTTP `429`

```json
{ "ok": false, "error": "rate_limited" }
```

## Endpoints

### GET `/health`

Response:

```json
{
  "ok": true,
  "service": "nexus-mail-engine-external-api",
  "version": "v1",
  "timestamp": "2026-04-30T19:00:00.000Z"
}
```

### GET `/bootstrap`

Response fields:

- `templates`: `id`, `name`, `subject`, `status`
- `recipientLists`: `id`, `name`, `totalCount`, `validCount`, `suppressedCount`
- `smtpPool`: `total`, `active`, `healthy`, `throttled`, `estimatedTotalRps`, `usableCount`
- `poolSettings`: `mode`, `rotateEvery`, `parallelSmtpCount`
- `defaults`

### GET `/lists`

Returns:

- `recipientLists` only

### GET `/templates`

Returns:

- active templates only

### GET `/smtp-pool`

Safe SMTP pool summary (no credentials):

- `activeSmtpCount`
- `selectedUsableSmtpCount`
- `healthCounts`
- `estimatedThroughput`
- `poolSettings`

### POST `/campaigns/dry-run`

Request body:

```json
{
  "name": "Campaign name",
  "templateId": "uuid",
  "targetType": "list",
  "targetId": "uuid",
  "smtpMode": "pool",
  "strategy": "round_robin",
  "rotateEvery": 500,
  "parallelSmtpCount": 1,
  "smtpAccountIds": []
}
```

Response:

```json
{
  "ok": true,
  "estimatedTargetCount": 123,
  "selectedSmtpCount": 2,
  "estimatedThroughput": 18.5,
  "warnings": []
}
```

### POST `/campaigns/start`

Same request body as `dry-run`.

Response:

```json
{
  "ok": true,
  "campaignId": "uuid",
  "status": "running",
  "estimatedTargetCount": 123,
  "selectedSmtpCount": 2,
  "rotateEvery": 500,
  "parallelSmtpCount": 1
}
```

## Error Codes

- `unauthorized`
- `forbidden_origin`
- `validation_failed`
- `template_not_found`
- `target_not_found`
- `no_recipients`
- `no_smtp_accounts`
- `campaign_start_failed`

## cURL Examples

```bash
curl -s "https://mail.hub-nexus.com/api/external/v1/bootstrap" \
  -H "Authorization: Bearer $EXTERNAL_API_KEY"
```

```bash
curl -s "https://mail.hub-nexus.com/api/external/v1/campaigns/dry-run" \
  -H "Authorization: Bearer $EXTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"External Dry Run",
    "templateId":"00000000-0000-0000-0000-000000000201",
    "targetType":"list",
    "targetId":"00000000-0000-0000-0000-000000000301",
    "smtpMode":"pool",
    "strategy":"round_robin",
    "rotateEvery":500,
    "parallelSmtpCount":1,
    "smtpAccountIds":[]
  }'
```

```bash
curl -s "https://mail.hub-nexus.com/api/external/v1/campaigns/start" \
  -H "Authorization: Bearer $EXTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"External Start",
    "templateId":"00000000-0000-0000-0000-000000000201",
    "targetType":"list",
    "targetId":"00000000-0000-0000-0000-000000000301",
    "smtpMode":"pool",
    "strategy":"round_robin",
    "rotateEvery":500,
    "parallelSmtpCount":1,
    "smtpAccountIds":[]
  }'
```


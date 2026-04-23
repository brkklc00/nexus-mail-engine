type RenderInput = {
  htmlBody: string;
  plainTextBody?: string | null;
  variables: Record<string, string | number | boolean | null | undefined>;
};

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z0-9_]+)\}\}/g;

export class MailTemplateRenderer {
  render(input: RenderInput): { html: string; text: string } {
    const html = input.htmlBody.replace(PLACEHOLDER_PATTERN, (_, key: string) => {
      const value = input.variables[key];
      return value === null || value === undefined ? "" : String(value);
    });

    const textSource = input.plainTextBody ?? input.htmlBody.replace(/<[^>]+>/g, " ");
    const text = textSource.replace(PLACEHOLDER_PATTERN, (_, key: string) => {
      const value = input.variables[key];
      return value === null || value === undefined ? "" : String(value);
    });

    return { html, text };
  }
}

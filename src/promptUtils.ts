export function fillPrompt(template: string, settings: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (token, key: string) =>
    Object.prototype.hasOwnProperty.call(settings, key) ? settings[key].trim() || '未提供' : token);
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

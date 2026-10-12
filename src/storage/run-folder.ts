/** Local date and time as a sortable, path-safe folder name, for example `2026-10-13_014502`. */
export function runFolderName(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

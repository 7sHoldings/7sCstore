/** Translate list-page query params into a Prisma date/where clause. */
export interface ListParams {
  from?: string;
  to?: string;
  [key: string]: string | undefined;
}

export function dateWhere(params: ListParams) {
  const where: Record<string, unknown> = {};
  const date: { gte?: Date; lt?: Date } = {};
  if (params.from) date.gte = new Date(params.from + "T00:00:00");
  if (params.to) {
    const d = new Date(params.to + "T00:00:00");
    d.setDate(d.getDate() + 1);
    date.lt = d;
  }
  if (date.gte || date.lt) where.date = date;
  return where;
}
